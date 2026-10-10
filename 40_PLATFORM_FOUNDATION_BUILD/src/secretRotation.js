import crypto from 'node:crypto';
import {LifecycleTransitionGuard,exactLifecycleRecord} from './lifecycleTransition.js';
import {parseManagedSecretRef} from './secretManagement.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA=/^[a-f0-9]{64}$/;
const clone=v=>structuredClone(v);
const digest=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
function id(v,c){if(typeof v!=='string'||!ID.test(v))throw new Error(c);return v;}
function sha(v,c){if(typeof v!=='string'||!SHA.test(v))throw new Error(c);return v;}
function gen(v){if(!Number.isSafeInteger(v)||v<1||v>2_147_483_647)throw new Error('SECRET_ROTATION_GENERATION_INVALID');return v;}
function key(tenantId,purpose,refFingerprint){return `${tenantId}\0${purpose}\0${refFingerprint}`;}

/**
 * Secret lifecycle evidence contains fingerprints and external evidence hashes only.
 * Secret values and raw managed-secret references are never retained by this registry.
 */
export class ManagedSecretRotationRegistry{
  #rows=new Map();#events=[];#guard;#transitionAt=null;
  constructor({now=()=>Date.now()}={}){if(typeof now!=='function')throw new Error('SECRET_ROTATION_CONFIGURATION_INVALID');this.#guard=new LifecycleTransitionGuard(now,'SECRET_ROTATION');}
  #at(){return this.#transitionAt;}
  #ref(ref){return digest(parseManagedSecretRef(ref).canonical);}
  #event(row){const ev=Object.freeze({id:`sre_${crypto.randomUUID()}`,at:this.#at(),...row});this.#events.push(ev);return ev;}
  #list(tenantId,purpose,refFingerprint){return this.#rows.get(key(tenantId,purpose,refFingerprint))??[];}
  stage(input){
    return this.#change(()=>{
      let {tenantId,purpose,secretRef,generation,validationEvidenceHash,actorId,traceId}=exactLifecycleRecord(input,['tenantId', 'purpose', 'secretRef', 'generation', 'validationEvidenceHash', 'actorId', 'traceId'],'SECRET_ROTATION_REQUEST_INVALID');
      tenantId=id(tenantId,'SECRET_ROTATION_TENANT_REQUIRED');purpose=id(purpose,'SECRET_ROTATION_PURPOSE_INVALID');actorId=id(actorId,'SECRET_ROTATION_ACTOR_INVALID');traceId=id(traceId,'SECRET_ROTATION_TRACE_INVALID');generation=gen(generation);validationEvidenceHash=sha(validationEvidenceHash,'SECRET_ROTATION_EVIDENCE_INVALID');const refFingerprint=this.#ref(secretRef),k=key(tenantId,purpose,refFingerprint),rows=this.#rows.get(k)??[],highest=rows.reduce((m,x)=>Math.max(m,x.generation),0);if(generation!==highest+1)throw new Error('SECRET_ROTATION_SEQUENCE_INVALID');if(rows.some(x=>x.state==='STAGED'))throw new Error('SECRET_ROTATION_STAGE_EXISTS');const row=Object.freeze({tenantId,purpose,refFingerprint,generation,state:'STAGED',validationEvidenceHash,stagedByHash:digest(actorId),stagedAt:this.#at(),activatedByHash:null,activatedAt:null,activationEvidenceHash:null,revokedByHash:null,revokedAt:null,revocationEvidenceHash:null});rows.push(row);this.#rows.set(k,rows);this.#event({tenantId,purposeHash:digest(purpose),refFingerprint,generation,eventType:'STAGED',actorHash:digest(actorId),evidenceHash:validationEvidenceHash,traceId});return clone(row);
    });
  }
  activate(input){
    return this.#change(()=>{
      let {tenantId,purpose,secretRef,generation,activationEvidenceHash,actorId,traceId}=exactLifecycleRecord(input,['tenantId', 'purpose', 'secretRef', 'generation', 'activationEvidenceHash', 'actorId', 'traceId'],'SECRET_ROTATION_REQUEST_INVALID');
      tenantId=id(tenantId,'SECRET_ROTATION_TENANT_REQUIRED');purpose=id(purpose,'SECRET_ROTATION_PURPOSE_INVALID');actorId=id(actorId,'SECRET_ROTATION_ACTOR_INVALID');traceId=id(traceId,'SECRET_ROTATION_TRACE_INVALID');generation=gen(generation);activationEvidenceHash=sha(activationEvidenceHash,'SECRET_ROTATION_EVIDENCE_INVALID');const refFingerprint=this.#ref(secretRef),rows=this.#list(tenantId,purpose,refFingerprint),idx=rows.findIndex(x=>x.generation===generation);if(idx<0||rows[idx].state!=='STAGED')throw new Error('SECRET_ROTATION_STAGE_UNAVAILABLE');if(rows[idx].stagedByHash===digest(actorId))throw new Error('SECRET_ROTATION_DUAL_CONTROL_REQUIRED');if(generation!==rows.reduce((m,x)=>Math.max(m,x.generation),0))throw new Error('SECRET_ROTATION_NOT_LATEST');for(let i=0;i<rows.length;i++)if(rows[i].state==='ACTIVE')rows[i]=Object.freeze({...rows[i],state:'RETIRING'});const row=Object.freeze({...rows[idx],state:'ACTIVE',activatedByHash:digest(actorId),activatedAt:this.#at(),activationEvidenceHash});rows[idx]=row;this.#event({tenantId,purposeHash:digest(purpose),refFingerprint,generation,eventType:'ACTIVATED',actorHash:digest(actorId),evidenceHash:activationEvidenceHash,traceId});return clone(row);
    });
  }
  revoke(input){
    return this.#change(()=>{
      let {tenantId,purpose,secretRef,generation,revocationEvidenceHash,actorId,traceId}=exactLifecycleRecord(input,['tenantId', 'purpose', 'secretRef', 'generation', 'revocationEvidenceHash', 'actorId', 'traceId'],'SECRET_ROTATION_REQUEST_INVALID');
      tenantId=id(tenantId,'SECRET_ROTATION_TENANT_REQUIRED');purpose=id(purpose,'SECRET_ROTATION_PURPOSE_INVALID');actorId=id(actorId,'SECRET_ROTATION_ACTOR_INVALID');traceId=id(traceId,'SECRET_ROTATION_TRACE_INVALID');generation=gen(generation);revocationEvidenceHash=sha(revocationEvidenceHash,'SECRET_ROTATION_EVIDENCE_INVALID');const refFingerprint=this.#ref(secretRef),rows=this.#list(tenantId,purpose,refFingerprint),idx=rows.findIndex(x=>x.generation===generation);if(idx<0||rows[idx].state!=='RETIRING')throw new Error('SECRET_ROTATION_REVOKE_STATE_INVALID');const row=Object.freeze({...rows[idx],state:'REVOKED',revokedByHash:digest(actorId),revokedAt:this.#at(),revocationEvidenceHash});rows[idx]=row;this.#event({tenantId,purposeHash:digest(purpose),refFingerprint,generation,eventType:'REVOKED',actorHash:digest(actorId),evidenceHash:revocationEvidenceHash,traceId});return clone(row);
    });
  }
  cancelStaged(input){
    return this.#change(()=>{
      let {tenantId,purpose,secretRef,generation,evidenceHash,actorId,traceId}=exactLifecycleRecord(input,['tenantId', 'purpose', 'secretRef', 'generation', 'evidenceHash', 'actorId', 'traceId'],'SECRET_ROTATION_REQUEST_INVALID');
      tenantId=id(tenantId,'SECRET_ROTATION_TENANT_REQUIRED');purpose=id(purpose,'SECRET_ROTATION_PURPOSE_INVALID');actorId=id(actorId,'SECRET_ROTATION_ACTOR_INVALID');traceId=id(traceId,'SECRET_ROTATION_TRACE_INVALID');generation=gen(generation);evidenceHash=sha(evidenceHash,'SECRET_ROTATION_EVIDENCE_INVALID');const refFingerprint=this.#ref(secretRef),rows=this.#list(tenantId,purpose,refFingerprint),idx=rows.findIndex(x=>x.generation===generation);if(idx<0||rows[idx].state!=='STAGED')throw new Error('SECRET_ROTATION_STAGE_UNAVAILABLE');const row=Object.freeze({...rows[idx],state:'CANCELLED'});rows[idx]=row;this.#event({tenantId,purposeHash:digest(purpose),refFingerprint,generation,eventType:'CANCELLED',actorHash:digest(actorId),evidenceHash,traceId});return clone(row);
    });
  }
  #change(work){
    const priorRows=this.#rows,priorEvents=this.#events,priorAt=this.#transitionAt;
    try{return this.#guard.run(at=>{
      this.#transitionAt=at;this.#rows=new Map([...priorRows].map(([k,rows])=>[k,[...rows]]));this.#events=[...priorEvents];return work();
    });}catch(error){this.#rows=priorRows;this.#events=priorEvents;throw error;}
    finally{this.#transitionAt=priorAt;}
  }
  assertUsable({tenantId,purpose,secretRef,generation}){tenantId=id(tenantId,'SECRET_ROTATION_TENANT_REQUIRED');purpose=id(purpose,'SECRET_ROTATION_PURPOSE_INVALID');generation=gen(generation);const refFingerprint=this.#ref(secretRef),rows=this.#list(tenantId,purpose,refFingerprint),row=rows.find(x=>x.generation===generation);if(!row||row.state!=='ACTIVE')throw new Error('SECRET_ROTATION_GENERATION_NOT_ACTIVE');return true;}
  state({tenantId,purpose,secretRef}){tenantId=id(tenantId,'SECRET_ROTATION_TENANT_REQUIRED');purpose=id(purpose,'SECRET_ROTATION_PURPOSE_INVALID');const fp=this.#ref(secretRef);return Object.freeze(this.#list(tenantId,purpose,fp).map(clone));}
  events(tenantId){tenantId=id(tenantId,'SECRET_ROTATION_TENANT_REQUIRED');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(clone));}
}
