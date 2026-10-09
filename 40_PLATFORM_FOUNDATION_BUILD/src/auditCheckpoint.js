import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const SAFE=/^[A-Za-z0-9._:/-]{1,256}$/;
const id=(v,c,max=256)=>{if(typeof v!=='string'||!v||v.length>max||!SAFE.test(v))throw new Error(c);return v;};
const sha=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const clone=v=>structuredClone(v);
const safeAnchorRef=v=>{if(typeof v!=='string'||!SAFE.test(v)||v.length>256)throw new Error('AUDIT_CHECKPOINT_ANCHOR_INVALID');return v;};

export class MemoryAuditAnchor {
  #anchors=new Map();
  async anchor(descriptor){const ref=`anchor_${crypto.randomUUID()}`;this.#anchors.set(descriptor.checkpointHash,clone(descriptor));return {anchorRef:ref};}
  async verify(descriptor){const found=this.#anchors.get(descriptor.checkpointHash);return Boolean(found&&found.tenantId===descriptor.tenantId&&found.auditCount===descriptor.auditCount&&found.headHash===descriptor.headHash);}
}

export class AuditCheckpointService {
  #store;#anchorSink;#anchorVerifier;#requireAnchor;#now;
  constructor({store,anchorSink=null,anchorVerifier=null,requireAnchor=false,now=()=>Date.now()}={}){if(!store||typeof store.verifyAuditChain!=='function'||typeof store.auditHead!=='function'||typeof store.auditHashAtPosition!=='function'||typeof store.putAuditCheckpoint!=='function'||typeof store.latestAuditCheckpoint!=='function'||typeof store.getIdempotent!=='function'||typeof store.setIdempotent!=='function')throw new Error('AUDIT_CHECKPOINT_STORE_REQUIRED');if(anchorSink!==null&&typeof anchorSink?.anchor!=='function')throw new Error('AUDIT_CHECKPOINT_ANCHOR_INVALID');if(anchorVerifier!==null&&typeof anchorVerifier?.verify!=='function')throw new Error('AUDIT_CHECKPOINT_VERIFIER_INVALID');if(requireAnchor&&!anchorSink)throw new Error('AUDIT_CHECKPOINT_ANCHOR_REQUIRED');this.#store=store;this.#anchorSink=anchorSink;this.#anchorVerifier=anchorVerifier;this.#requireAnchor=requireAnchor===true;this.#now=now;}
  async create({tenantId,actorId,traceId,idempotencyKey}={}){tenantId=id(tenantId,'AUDIT_CHECKPOINT_TENANT_REQUIRED',200);actorId=id(actorId,'AUDIT_CHECKPOINT_ACTOR_REQUIRED',200);traceId=id(traceId,'AUDIT_CHECKPOINT_TRACE_REQUIRED');idempotencyKey=id(idempotencyKey,'AUDIT_CHECKPOINT_IDEMPOTENCY_REQUIRED');const scope=`audit-checkpoint:${tenantId}:${idempotencyKey}`,prior=this.#store.getIdempotent(scope);if(prior){const old=this.#store.getAuditCheckpoint(tenantId,prior.checkpointId);if(!old)throw new Error('AUDIT_CHECKPOINT_REPLAY_UNAVAILABLE');return Object.freeze({...clone(old),replayed:true});}if(!this.#store.verifyAuditChain(tenantId))throw new Error('AUDIT_CHAIN_INVALID');const head=this.#store.auditHead(tenantId);if(head.auditCount<1)throw new Error('AUDIT_CHECKPOINT_EMPTY');const createdAt=new Date(this.#now()).toISOString(),descriptor={version:1,tenantId,auditCount:head.auditCount,headHash:head.headHash,createdAt},checkpointHash=sha(canonicalAuditPayload(descriptor));let anchorRefHash=null;if(this.#anchorSink){const response=await this.#anchorSink.anchor(Object.freeze({...descriptor,checkpointHash}));if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).some(k=>k!=='anchorRef'))throw new Error('AUDIT_CHECKPOINT_ANCHOR_INVALID');anchorRefHash=sha(safeAnchorRef(response.anchorRef));}else if(this.#requireAnchor)throw new Error('AUDIT_CHECKPOINT_ANCHOR_REQUIRED');return this.#store.transaction(()=>{const replay=this.#store.getIdempotent(scope);if(replay){const old=this.#store.getAuditCheckpoint(tenantId,replay.checkpointId);if(!old)throw new Error('AUDIT_CHECKPOINT_REPLAY_UNAVAILABLE');return Object.freeze({...clone(old),replayed:true});}if(!this.#store.verifyAuditChain(tenantId)||this.#store.auditHashAtPosition(tenantId,head.auditCount)!==head.headHash)throw new Error('AUDIT_CHECKPOINT_CHAIN_CHANGED');const row={id:this.#store.uid('acp'),tenantId,auditCount:head.auditCount,headHash:head.headHash,checkpointHash,anchorRefHash,createdBy:actorId,createdAt};this.#store.putAuditCheckpoint(row);this.#store.setIdempotent(scope,{checkpointId:row.id,checkpointHash});this.#store.audit({tenantId,traceId,actorId,action:'AUDIT_CHECKPOINT_CREATED',objectId:row.id,outcome:'SUCCESS',reason:anchorRefHash?'EXTERNAL_ANCHOR':'LOCAL_REFERENCE'});return Object.freeze({...clone(row),replayed:false});});}
  async verifyLatest({tenantId}={}){tenantId=id(tenantId,'AUDIT_CHECKPOINT_TENANT_REQUIRED',200);const checkpoint=this.#store.latestAuditCheckpoint(tenantId);if(!checkpoint)return Object.freeze({status:'NO_CHECKPOINT',checkpointId:null,anchorVerified:null});if(!this.#store.verifyAuditChain(tenantId))return Object.freeze({status:'CHAIN_INVALID',checkpointId:checkpoint.id,anchorVerified:false});const head=this.#store.auditHead(tenantId);let status='EXTENDED';if(head.auditCount<checkpoint.auditCount)status='ROLLBACK';else if(this.#store.auditHashAtPosition(tenantId,checkpoint.auditCount)!==checkpoint.headHash)status='FORKED';let anchorVerified=null;if(this.#anchorVerifier){try{anchorVerified=await this.#anchorVerifier.verify(Object.freeze({version:1,tenantId:checkpoint.tenantId,auditCount:checkpoint.auditCount,headHash:checkpoint.headHash,createdAt:checkpoint.createdAt,checkpointHash:checkpoint.checkpointHash}));}catch{anchorVerified=false;}if(anchorVerified!==true)status='ANCHOR_INVALID';}else if(this.#requireAnchor){anchorVerified=false;status='ANCHOR_UNVERIFIED';}return Object.freeze({status,checkpointId:checkpoint.id,auditCount:head.auditCount,checkpointAuditCount:checkpoint.auditCount,anchorVerified});}
}

export function createAuditCheckpointReadinessProbe({service,tenantId}={}){
  if(!service||typeof service.verifyLatest!=='function')throw new Error('AUDIT_CHECKPOINT_SERVICE_REQUIRED');
  id(tenantId,'AUDIT_CHECKPOINT_TENANT_REQUIRED',200);
  return async()=>{
    try{
      const result=await service.verifyLatest({tenantId});
      if(result.status==='EXTENDED'&&result.anchorVerified===true)return {ok:true,code:'AUDIT_CHECKPOINT_CURRENT'};
      if(result.status==='NO_CHECKPOINT')return {ok:false,code:'AUDIT_CHECKPOINT_MISSING'};
      if(result.status==='ROLLBACK')return {ok:false,code:'AUDIT_ROLLBACK_DETECTED'};
      if(result.status==='FORKED')return {ok:false,code:'AUDIT_FORK_DETECTED'};
      if(result.status==='CHAIN_INVALID')return {ok:false,code:'AUDIT_CHAIN_INVALID'};
      if(result.status==='ANCHOR_INVALID'||result.status==='ANCHOR_UNVERIFIED')return {ok:false,code:'AUDIT_ANCHOR_INVALID'};
      return {ok:false,code:'AUDIT_CHECKPOINT_INVALID'};
    }catch{return {ok:false,code:'AUDIT_CHECKPOINT_UNAVAILABLE'};}
  };
}

