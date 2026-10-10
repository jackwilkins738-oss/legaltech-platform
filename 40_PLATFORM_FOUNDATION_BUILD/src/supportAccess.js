import crypto from 'node:crypto';
import {normalizeSession,requireCapability,requireRecentStepUp} from './auth.js';
import {LifecycleTransitionGuard,discardLifecyclePromise} from './lifecycleTransition.js';
const SCOPES=new Set(['MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function id(value,code){if(typeof value!=='string'||!ID.test(value))throw new Error(code);return value;}
function text(value,code,{min=8,max=500}={}){if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error(code);return value.trim();}
const clone=value=>Object.freeze({...value});
function exact(value,required,optional=[]){
  const keys=[...required,...optional];if(!value||Object.getPrototypeOf(value)!==Object.prototype||required.some(k=>!Object.hasOwn(value,k))
    ||Reflect.ownKeys(value).some(k=>!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw new Error('SUPPORT_ACCESS_REQUEST_INVALID');return value;
}

// Process-local reference authority. No key/material or production administration endpoint.
export class JitSupportAccessRegistry {
  #guard;#time=null;#ttlMs;#requests=new Map();#approvals=new Map();#revocations=new Map();#events=[];#audit;#revocationAttempt=null;
  constructor({now=()=>Date.now(),ttlSeconds=600,auditEvent=()=>{}}={}){
    if(typeof now!=='function'||typeof auditEvent!=='function'||!Number.isInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>900)throw new Error('SUPPORT_ACCESS_CONFIGURATION_INVALID');
    this.#guard=new LifecycleTransitionGuard(now,'SUPPORT_ACCESS');this.#ttlMs=ttlSeconds*1000;this.#audit=auditEvent;
  }
  #event(row){
    this.#guard.assertUninterrupted();const event=Object.freeze({id:`sae_${crypto.randomUUID()}`,at:new Date(this.#time).toISOString(),...row});let result;
    try{result=this.#audit(clone(event));}catch{throw new Error('SUPPORT_ACCESS_AUDIT_UNAVAILABLE');}
    discardLifecyclePromise(result);if(result&&(typeof result==='object'||typeof result==='function')&&typeof result.then==='function')throw new Error('SUPPORT_ACCESS_SYNC_AUDIT_REQUIRED');
    this.#guard.assertUninterrupted();this.#time=this.#guard.observeClock();this.#events.push(event);return event;
  }
  #key(tenantId,requestId){return JSON.stringify([tenantId,requestId]);}
  request(input){return this.#change(()=>{
    let {session,scope,matterId,documentRef=null,ticketRef,purpose,traceId}=exact(input,['session','scope','matterId','ticketRef','purpose','traceId'],['documentRef']);
    const s=normalizeSession(session);requireCapability(s,'support:access:request');requireRecentStepUp(s,{now:this.#time});
    if(!SCOPES.has(scope))throw new Error('SUPPORT_ACCESS_SCOPE_INVALID');matterId=id(matterId,'SUPPORT_ACCESS_MATTER_INVALID');traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');
    if(scope==='DOCUMENT_READ')documentRef=id(documentRef,'SUPPORT_ACCESS_DOCUMENT_INVALID');else if(documentRef!==null)throw new Error('SUPPORT_ACCESS_DOCUMENT_SCOPE_INVALID');
    const ticket=text(ticketRef,'SUPPORT_ACCESS_TICKET_INVALID',{min:3,max:200}),why=text(purpose,'SUPPORT_ACCESS_PURPOSE_INVALID');
    const createdAt=new Date(this.#time).toISOString(),expiresAt=new Date(this.#time+this.#ttlMs).toISOString(),requestId=`sar_${crypto.randomUUID()}`;
    const row=Object.freeze({requestId,tenantId:s.tenantId,requesterId:s.actorId,scope,matterId,documentRef,createdAt,expiresAt,ticketRefHash:sha(ticket),purposeHash:sha(why),traceId});
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId,scope,matterId,documentRefHash:documentRef?sha(documentRef):null,traceId,action:'SUPPORT_ACCESS_REQUESTED',outcome:'SUCCESS'});
    requireRecentStepUp(s,{now:this.#time});if(this.#time>=Date.parse(expiresAt))throw new Error('SUPPORT_ACCESS_REQUEST_EXPIRED');this.#requests.set(this.#key(s.tenantId,requestId),row);return clone(row);
  });}
  approve(input){return this.#change(()=>{
    let {session,requestId,traceId}=exact(input,['session','requestId','traceId']);const s=normalizeSession(session);requireCapability(s,'support:access:approve');requireRecentStepUp(s,{now:this.#time});
    traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');requestId=id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');const key=this.#key(s.tenantId,requestId),row=this.#requests.get(key);
    if(!row)throw new Error('SUPPORT_ACCESS_REQUEST_UNAVAILABLE');if(row.requesterId===s.actorId)throw new Error('SUPPORT_ACCESS_DUAL_CONTROL_REQUIRED');
    if(this.#time>=Date.parse(row.expiresAt))throw new Error('SUPPORT_ACCESS_REQUEST_EXPIRED');if(this.#revocations.has(key))throw new Error('SUPPORT_ACCESS_UNAVAILABLE');if(this.#approvals.has(key))throw new Error('SUPPORT_ACCESS_ALREADY_APPROVED');
    const approval=Object.freeze({approvalId:`saa_${crypto.randomUUID()}`,tenantId:s.tenantId,requestId,approverId:s.actorId,approvedAt:new Date(this.#time).toISOString(),traceId});
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId,scope:row.scope,matterId:row.matterId,documentRefHash:row.documentRef?sha(row.documentRef):null,traceId,action:'SUPPORT_ACCESS_APPROVED',outcome:'SUCCESS'});
    requireRecentStepUp(s,{now:this.#time});if(this.#revocations.has(key)||this.#time>=Date.parse(row.expiresAt))throw new Error('SUPPORT_ACCESS_UNAVAILABLE');this.#approvals.set(key,approval);
    return Object.freeze({...row,approvalId:approval.approvalId,approverId:approval.approverId,approvedAt:approval.approvedAt,status:'ACTIVE'});
  });}
  revoke(input){return this.#change(()=>{
    let {session,requestId,traceId,reason}=exact(input,['session','requestId','traceId','reason']);const s=normalizeSession(session);requireCapability(s,'support:access:revoke');requireRecentStepUp(s,{now:this.#time});
    traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');requestId=id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');const key=this.#key(s.tenantId,requestId),row=this.#requests.get(key);if(!row)throw new Error('SUPPORT_ACCESS_REQUEST_UNAVAILABLE');
    const reasonHash=sha(text(reason,'SUPPORT_ACCESS_REVOCATION_REASON_INVALID')),prior=this.#revocations.get(key);
    if(prior?.auditConfirmed)throw new Error('SUPPORT_ACCESS_ALREADY_REVOKED');if(prior&&(prior.revokedBy!==s.actorId||prior.reasonHash!==reasonHash))throw new Error('SUPPORT_ACCESS_REVOCATION_RETRY_MISMATCH');
    const rev=prior??Object.freeze({revocationId:`sav_${crypto.randomUUID()}`,tenantId:s.tenantId,requestId,revokedBy:s.actorId,revokedAt:new Date(this.#time).toISOString(),reasonHash,traceId,auditConfirmed:false,auditConfirmedAt:null});
    // Denial survives an unavailable/uncertain audit; it must never restore access.
    this.#revocationAttempt={key,row:rev};this.#revocations.set(key,rev);
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId,scope:row.scope,matterId:row.matterId,documentRefHash:row.documentRef?sha(row.documentRef):null,traceId,action:'SUPPORT_ACCESS_REVOKED',outcome:'SUCCESS'});
    requireRecentStepUp(s,{now:this.#time});const confirmed=Object.freeze({...rev,auditConfirmed:true,auditConfirmedAt:new Date(this.#time).toISOString()});this.#revocations.set(key,confirmed);return clone(confirmed);
  });}
  #active(session,{matterId,documentRef=null,scopes,requestId=null}){
    const s=normalizeSession(session);requireRecentStepUp(s,{now:this.#time});matterId=id(matterId,'SUPPORT_ACCESS_MATTER_INVALID');if(documentRef!==null)documentRef=id(documentRef,'SUPPORT_ACCESS_DOCUMENT_INVALID');if(requestId!==null)requestId=id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');
    for(const row of this.#requests.values()){
      if(row.tenantId!==s.tenantId||row.requesterId!==s.actorId||row.matterId!==matterId||!scopes.has(row.scope)||requestId!==null&&row.requestId!==requestId)continue;
      if(row.scope==='DOCUMENT_READ'&&row.documentRef!==documentRef)continue;const key=this.#key(row.tenantId,row.requestId);
      if(!this.#approvals.has(key)||this.#revocations.has(key)||this.#time<Date.parse(row.createdAt)||this.#time>=Date.parse(row.expiresAt))continue;return row;
    }throw new Error('SUPPORT_ACCESS_UNAVAILABLE');
  }
  #read(session,input,scope,action){return this.#change(()=>{
    let {matterId,documentRef=null,traceId,requestId=null}=exact(input,scope==='DOCUMENT_READ'?['matterId','documentRef','traceId']:['matterId','traceId'],['requestId']);
    const s=normalizeSession(session);traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');const binding={matterId,documentRef,scopes:new Set([scope]),requestId},row=this.#active(s,binding);
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId:row.requestId,scope:row.scope,matterId:row.matterId,documentRefHash:scope==='DOCUMENT_READ'?sha(documentRef):null,traceId,action,outcome:'SUCCESS'});
    this.#active(s,{...binding,requestId:row.requestId});return clone(row);
  });}
  assertMatterRead(session,input){return this.#read(session,input,'MATTER_READ','SUPPORT_MATTER_READ');}
  assertDiagnosticRead(session,input){return this.#read(session,input,'DIAGNOSTIC_READ','SUPPORT_DIAGNOSTIC_READ');}
  assertDocumentRead(session,input){return this.#read(session,input,'DOCUMENT_READ','SUPPORT_DOCUMENT_READ');}
  assertGrantCurrent(session,input){return this.#change(()=>{const {requestId,matterId,documentRef=null,scope}=exact(input,['requestId','matterId','scope'],['documentRef']);if(!SCOPES.has(scope))throw new Error('SUPPORT_ACCESS_SCOPE_INVALID');if(scope!=='DOCUMENT_READ'&&documentRef!==null)throw new Error('SUPPORT_ACCESS_DOCUMENT_SCOPE_INVALID');id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');this.#active(session,{requestId,matterId,documentRef,scopes:new Set([scope])});return true;});}
  status(input){return this.#change(()=>{let {tenantId,requestId}=exact(input,['tenantId','requestId']);tenantId=id(tenantId,'SUPPORT_ACCESS_TENANT_INVALID');requestId=id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');const key=this.#key(tenantId,requestId),row=this.#requests.get(key);if(!row)return null;const rev=this.#revocations.get(key),status=rev?'REVOKED':this.#time>=Date.parse(row.expiresAt)?'EXPIRED':this.#approvals.has(key)?'ACTIVE':'PENDING';return Object.freeze({requestId,tenantId,status,expiresAt:row.expiresAt,...(rev?{auditConfirmed:rev.auditConfirmed}:{})});});}
  events(tenantId){tenantId=id(tenantId,'SUPPORT_ACCESS_TENANT_INVALID');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(clone));}
  #change(work){
    const previous={requests:this.#requests,approvals:this.#approvals,revocations:this.#revocations,events:this.#events,time:this.#time,attempt:this.#revocationAttempt};
    try{return this.#guard.run(at=>{this.#time=Date.parse(at);this.#revocationAttempt=null;this.#requests=new Map(previous.requests);this.#approvals=new Map(previous.approvals);this.#revocations=new Map(previous.revocations);this.#events=[...previous.events];return work();});}
    catch(error){const attempted=this.#revocationAttempt;this.#requests=previous.requests;this.#approvals=previous.approvals;this.#revocations=previous.revocations;this.#events=previous.events;if(attempted&&attempted!==previous.attempt){this.#revocations=new Map(previous.revocations);this.#revocations.set(attempted.key,attempted.row);}throw error;}
    finally{this.#time=previous.time;this.#revocationAttempt=previous.attempt;}
  }
}
