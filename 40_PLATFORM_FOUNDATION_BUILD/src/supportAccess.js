import crypto from 'node:crypto';
import {normalizeSession,requireCapability,requireRecentStepUp} from './auth.js';

const SCOPES=new Set(['MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ']);
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA=/^[a-f0-9]{64}$/;
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function id(value,code){if(typeof value!=='string'||!ID.test(value))throw new Error(code);return value;}
function text(value,code,{min=8,max=500}={}){if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new Error(code);return value.trim();}
function clone(value){return Object.freeze({...value});}

/**
 * Reference JIT support-access authority.
 *
 * Capabilities only allow an operator to request/approve/revoke a grant; they never
 * grant client-data access on their own. Effective access is tenant + actor + exact
 * resource + scope bound, short lived, step-up authenticated and dual controlled.
 * Persistence in production is expected to use migration 025, not these Maps.
 */
export class JitSupportAccessRegistry {
  #now; #ttlMs; #requests=new Map(); #approvals=new Map(); #revocations=new Map(); #events=[]; #audit;
  constructor({now=()=>Date.now(),ttlSeconds=600,auditEvent=()=>{}}={}){
    if(typeof now!=='function'||typeof auditEvent!=='function'||!Number.isInteger(ttlSeconds)||ttlSeconds<60||ttlSeconds>900)throw new Error('SUPPORT_ACCESS_CONFIGURATION_INVALID');
    this.#now=now;this.#ttlMs=ttlSeconds*1000;this.#audit=auditEvent;
  }
  #event(row){const event=Object.freeze({id:`sae_${crypto.randomUUID()}`,at:new Date(this.#now()).toISOString(),...row});const result=this.#audit(event);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw new Error('SUPPORT_ACCESS_SYNC_AUDIT_REQUIRED');}this.#events.push(event);return event;}
  #key(tenantId,requestId){return `${tenantId}\0${requestId}`;}
  request({session,scope,matterId,documentRef=null,ticketRef,purpose,traceId}){
    const s=normalizeSession(session);requireCapability(s,'support:access:request');requireRecentStepUp(s,{now:this.#now()});
    if(!SCOPES.has(scope))throw new Error('SUPPORT_ACCESS_SCOPE_INVALID');
    matterId=id(matterId,'SUPPORT_ACCESS_MATTER_INVALID');traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');
    if(scope==='DOCUMENT_READ')documentRef=id(documentRef,'SUPPORT_ACCESS_DOCUMENT_INVALID');
    else if(documentRef!==null)throw new Error('SUPPORT_ACCESS_DOCUMENT_SCOPE_INVALID');
    const ticket=text(ticketRef,'SUPPORT_ACCESS_TICKET_INVALID',{min:3,max:200}),why=text(purpose,'SUPPORT_ACCESS_PURPOSE_INVALID');
    const createdAt=new Date(this.#now()).toISOString(),expiresAt=new Date(this.#now()+this.#ttlMs).toISOString(),requestId=`sar_${crypto.randomUUID()}`;
    const row=Object.freeze({requestId,tenantId:s.tenantId,requesterId:s.actorId,scope,matterId,documentRef,createdAt,expiresAt,ticketRefHash:sha(ticket),purposeHash:sha(why),traceId});
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId,scope,matterId,documentRefHash:documentRef?sha(documentRef):null,traceId,action:'SUPPORT_ACCESS_REQUESTED',outcome:'SUCCESS'});
    this.#requests.set(this.#key(s.tenantId,requestId),row);
    return clone(row);
  }
  approve({session,requestId,traceId}){
    const s=normalizeSession(session);requireCapability(s,'support:access:approve');requireRecentStepUp(s,{now:this.#now()});traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');requestId=id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');
    const key=this.#key(s.tenantId,requestId),row=this.#requests.get(key);if(!row)throw new Error('SUPPORT_ACCESS_REQUEST_UNAVAILABLE');
    if(row.requesterId===s.actorId)throw new Error('SUPPORT_ACCESS_DUAL_CONTROL_REQUIRED');
    if(this.#now()>=Date.parse(row.expiresAt))throw new Error('SUPPORT_ACCESS_REQUEST_EXPIRED');
    if(this.#approvals.has(key))throw new Error('SUPPORT_ACCESS_ALREADY_APPROVED');
    const approval=Object.freeze({approvalId:`saa_${crypto.randomUUID()}`,tenantId:s.tenantId,requestId,approverId:s.actorId,approvedAt:new Date(this.#now()).toISOString(),traceId});
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId,scope:row.scope,matterId:row.matterId,documentRefHash:row.documentRef?sha(row.documentRef):null,traceId,action:'SUPPORT_ACCESS_APPROVED',outcome:'SUCCESS'});
    if(this.#revocations.has(key)||this.#now()>=Date.parse(row.expiresAt))throw new Error('SUPPORT_ACCESS_UNAVAILABLE');
    this.#approvals.set(key,approval);
    return Object.freeze({...clone(row),approvalId:approval.approvalId,approverId:approval.approverId,approvedAt:approval.approvedAt,status:'ACTIVE'});
  }
  revoke({session,requestId,traceId,reason}){
    const s=normalizeSession(session);requireCapability(s,'support:access:revoke');requireRecentStepUp(s,{now:this.#now()});traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');requestId=id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');
    const key=this.#key(s.tenantId,requestId),row=this.#requests.get(key);if(!row)throw new Error('SUPPORT_ACCESS_REQUEST_UNAVAILABLE');if(this.#revocations.has(key))throw new Error('SUPPORT_ACCESS_ALREADY_REVOKED');
    const why=text(reason,'SUPPORT_ACCESS_REVOCATION_REASON_INVALID'),rev=Object.freeze({revocationId:`sav_${crypto.randomUUID()}`,tenantId:s.tenantId,requestId,revokedBy:s.actorId,revokedAt:new Date(this.#now()).toISOString(),reasonHash:sha(why),traceId});this.#revocations.set(key,rev);
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId,scope:row.scope,matterId:row.matterId,documentRefHash:row.documentRef?sha(row.documentRef):null,traceId,action:'SUPPORT_ACCESS_REVOKED',outcome:'SUCCESS'});return clone(rev);
  }
  #active(session,{matterId,documentRef=null,scopes}){
    const s=normalizeSession(session);requireRecentStepUp(s,{now:this.#now()});matterId=id(matterId,'SUPPORT_ACCESS_MATTER_INVALID');
    if(documentRef!==null)documentRef=id(documentRef,'SUPPORT_ACCESS_DOCUMENT_INVALID');
    for(const row of this.#requests.values()){
      if(row.tenantId!==s.tenantId||row.requesterId!==s.actorId||row.matterId!==matterId||!scopes.has(row.scope))continue;
      if(row.scope==='DOCUMENT_READ'&&row.documentRef!==documentRef)continue;
      const key=this.#key(row.tenantId,row.requestId);if(!this.#approvals.has(key)||this.#revocations.has(key)||this.#now()<Date.parse(row.createdAt)||this.#now()>=Date.parse(row.expiresAt))continue;
      return row;
    }
    throw new Error('SUPPORT_ACCESS_UNAVAILABLE');
  }
  assertMatterRead(session,{matterId,traceId}){
    traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');const row=this.#active(session,{matterId,scopes:new Set(['MATTER_READ'])});const s=normalizeSession(session);
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId:row.requestId,scope:row.scope,matterId:row.matterId,documentRefHash:null,traceId,action:'SUPPORT_MATTER_READ',outcome:'SUCCESS'});return clone(row);
  }
  assertDiagnosticRead(session,{matterId,traceId}){
    traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');const row=this.#active(session,{matterId,scopes:new Set(['DIAGNOSTIC_READ'])});const s=normalizeSession(session);
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId:row.requestId,scope:row.scope,matterId:row.matterId,documentRefHash:null,traceId,action:'SUPPORT_DIAGNOSTIC_READ',outcome:'SUCCESS'});return clone(row);
  }
  assertDocumentRead(session,{matterId,documentRef,traceId}){
    traceId=id(traceId,'SUPPORT_ACCESS_TRACE_INVALID');const row=this.#active(session,{matterId,documentRef,scopes:new Set(['DOCUMENT_READ'])});const s=normalizeSession(session);
    this.#event({tenantId:s.tenantId,actorId:s.actorId,requestId:row.requestId,scope:row.scope,matterId:row.matterId,documentRefHash:sha(documentRef),traceId,action:'SUPPORT_DOCUMENT_READ',outcome:'SUCCESS'});return clone(row);
  }
  status({tenantId,requestId}){
    tenantId=id(tenantId,'SUPPORT_ACCESS_TENANT_INVALID');requestId=id(requestId,'SUPPORT_ACCESS_REQUEST_INVALID');const key=this.#key(tenantId,requestId),row=this.#requests.get(key);if(!row)return null;
    const status=this.#revocations.has(key)?'REVOKED':this.#now()>=Date.parse(row.expiresAt)?'EXPIRED':this.#approvals.has(key)?'ACTIVE':'PENDING';return Object.freeze({requestId,tenantId,status,expiresAt:row.expiresAt});
  }
  events(tenantId){tenantId=id(tenantId,'SUPPORT_ACCESS_TENANT_INVALID');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(clone));}
}
