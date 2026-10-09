import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

export const CHANGE_TYPES=Object.freeze(['WORKFLOW_PUBLISH','RESPONSE_POLICY_PUBLISH','FEATURE_FLAG_CHANGE','RETENTION_POLICY_PUBLISH','TENANT_CONFIG_ACTIVATE']);
const TYPE_SET=new Set(CHANGE_TYPES);
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/;
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const SHA256=/^[a-f0-9]{64}$/;
const clone=v=>structuredClone(v);
const digest=v=>crypto.createHash('sha256').update(canonicalAuditPayload(v)).digest('hex');
function safeId(v,code,max=256){if(typeof v!=='string'||!v.trim()||v.length>max||!SAFE_ID.test(v.trim()))throw new Error(code);return v.trim();}
function safeCode(v,code){if(typeof v!=='string'||!CODE.test(v))throw new Error(code);return v;}
function safeHash(v,code='CHANGE_TARGET_HASH_INVALID'){if(typeof v!=='string'||!SHA256.test(v))throw new Error(code);return v;}
function isoFuture(value,now){const ms=Date.parse(value);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==value||ms<=now+60_000||ms>now+7*86_400_000)throw new Error('CHANGE_EXPIRY_INVALID');return value;}
export const hashChangeTarget=value=>digest(value);

export class ChangeControlRegistry {
  #now;#authorize;#changes=new Map();#idempotency=new Map();#events=[];
  constructor({authorizeChange,now=()=>Date.now()}={}){if(typeof authorizeChange!=='function')throw new Error('CHANGE_CONTROL_AUTHORIZATION_REQUIRED');if(typeof now!=='function')throw new Error('CHANGE_CONTROL_CLOCK_INVALID');this.#authorize=authorizeChange;this.#now=now;}
  propose({tenantId,changeType,targetRef,targetHash,requestedBy,traceId,reasonCode,idempotencyKey,expiresAt}){
    tenantId=safeId(tenantId,'CHANGE_TENANT_REQUIRED');if(!TYPE_SET.has(changeType))throw new Error('CHANGE_TYPE_INVALID');targetRef=safeId(targetRef,'CHANGE_TARGET_REF_INVALID');targetHash=safeHash(targetHash);requestedBy=safeId(requestedBy,'CHANGE_REQUESTER_REQUIRED');traceId=safeId(traceId,'CHANGE_TRACE_REQUIRED');reasonCode=safeCode(reasonCode,'CHANGE_REASON_INVALID');idempotencyKey=safeId(idempotencyKey,'CHANGE_IDEMPOTENCY_INVALID');expiresAt=isoFuture(expiresAt,this.#now());
    this.#assertAuthorized({phase:'REQUEST',tenantId,changeType,targetRef,targetHash,actorId:requestedBy,traceId});
    const fingerprint=digest({changeType,targetRef,targetHash,reasonCode,expiresAt}),idem=`${tenantId}:${idempotencyKey}`,prior=this.#idempotency.get(idem);
    if(prior){if(prior.fingerprint!==fingerprint)throw new Error('CHANGE_IDEMPOTENCY_CONFLICT');const existing=this.#changes.get(`${tenantId}:${prior.changeId}`);if(!existing)throw new Error('CHANGE_IDEMPOTENCY_UNAVAILABLE');return Object.freeze({...clone(existing),replayed:true});}
    const row={id:`chg_${crypto.randomUUID()}`,tenantId,changeType,targetRef,targetHash,status:'PENDING_APPROVAL',reasonCode,requestedBy,requestedAt:this.#at(),expiresAt,approvedBy:null,approvedAt:null,rejectedBy:null,rejectedAt:null,rejectionCode:null,cancelledBy:null,cancelledAt:null,cancelCode:null,consumedBy:null,consumedAt:null};
    this.#changes.set(`${tenantId}:${row.id}`,row);this.#idempotency.set(idem,{fingerprint,changeId:row.id});this.#event(row,'CHANGE_REQUESTED',requestedBy,traceId,{changeType,targetRef,targetHash});return Object.freeze({...clone(row),replayed:false});
  }
  approve({tenantId,changeId,actorId,traceId}){actorId=safeId(actorId,'CHANGE_APPROVER_REQUIRED');traceId=safeId(traceId,'CHANGE_TRACE_REQUIRED');const row=this.#getOpen(tenantId,changeId,'PENDING_APPROVAL');this.#assertFresh(row);if(row.requestedBy===actorId)throw new Error('CHANGE_DUAL_CONTROL_REQUIRED');this.#assertAuthorized({phase:'APPROVE',tenantId:row.tenantId,changeType:row.changeType,targetRef:row.targetRef,targetHash:row.targetHash,actorId,traceId});row.status='APPROVED';row.approvedBy=actorId;row.approvedAt=this.#at();this.#event(row,'CHANGE_APPROVED',actorId,traceId,{changeType:row.changeType,targetRef:row.targetRef,targetHash:row.targetHash});return Object.freeze(clone(row));}
  reject({tenantId,changeId,actorId,traceId,rejectionCode}){actorId=safeId(actorId,'CHANGE_APPROVER_REQUIRED');traceId=safeId(traceId,'CHANGE_TRACE_REQUIRED');rejectionCode=safeCode(rejectionCode,'CHANGE_REJECTION_CODE_INVALID');const row=this.#getOpen(tenantId,changeId,'PENDING_APPROVAL');if(row.requestedBy===actorId)throw new Error('CHANGE_DUAL_CONTROL_REQUIRED');this.#assertAuthorized({phase:'APPROVE',tenantId:row.tenantId,changeType:row.changeType,targetRef:row.targetRef,targetHash:row.targetHash,actorId,traceId});row.status='REJECTED';row.rejectedBy=actorId;row.rejectedAt=this.#at();row.rejectionCode=rejectionCode;this.#event(row,'CHANGE_REJECTED',actorId,traceId,{rejectionCode});return Object.freeze(clone(row));}
  cancel({tenantId,changeId,actorId,traceId,cancelCode}){actorId=safeId(actorId,'CHANGE_ACTOR_REQUIRED');traceId=safeId(traceId,'CHANGE_TRACE_REQUIRED');cancelCode=safeCode(cancelCode,'CHANGE_CANCEL_CODE_INVALID');const row=this.#find(tenantId,changeId);if(!row||!['PENDING_APPROVAL','APPROVED'].includes(row.status))throw new Error('CHANGE_REQUEST_UNAVAILABLE');this.#assertAuthorized({phase:'CANCEL',tenantId:row.tenantId,changeType:row.changeType,targetRef:row.targetRef,targetHash:row.targetHash,actorId,traceId});row.status='CANCELLED';row.cancelledBy=actorId;row.cancelledAt=this.#at();row.cancelCode=cancelCode;this.#event(row,'CHANGE_CANCELLED',actorId,traceId,{cancelCode});return Object.freeze(clone(row));}
  executeApproved({tenantId,changeId,changeType,targetRef,targetHash,actorId,traceId},action){if(typeof action!=='function')throw new Error('CHANGE_ACTION_REQUIRED');actorId=safeId(actorId,'CHANGE_ACTOR_REQUIRED');traceId=safeId(traceId,'CHANGE_TRACE_REQUIRED');targetRef=safeId(targetRef,'CHANGE_TARGET_REF_INVALID');targetHash=safeHash(targetHash);if(!TYPE_SET.has(changeType))throw new Error('CHANGE_TYPE_INVALID');const row=this.#getOpen(tenantId,changeId,'APPROVED');this.#assertFresh(row);if(row.changeType!==changeType||row.targetRef!==targetRef||row.targetHash!==targetHash)throw new Error('CHANGE_APPROVAL_TARGET_MISMATCH');this.#assertAuthorized({phase:'EXECUTE',tenantId:row.tenantId,changeType,targetRef,targetHash,actorId,traceId});row.status='EXECUTING';let result;try{result=action();if(result&&typeof result.then==='function')throw new Error('CHANGE_ACTION_ASYNC_UNSUPPORTED');}catch(error){row.status='APPROVED';this.#event(row,'CHANGE_EXECUTION_FAILED',actorId,traceId,{errorCode:'ACTION_FAILED'});throw error;}row.status='CONSUMED';row.consumedBy=actorId;row.consumedAt=this.#at();this.#event(row,'CHANGE_CONSUMED',actorId,traceId,{changeType,targetRef,targetHash});return result;}
  get(tenantId,changeId){const row=this.#find(tenantId,changeId);return row?Object.freeze(clone(row)):null;}
  listEvents(tenantId){return Object.freeze(this.#events.filter(e=>e.tenantId===tenantId).map(e=>Object.freeze(clone(e))));}
  #find(tenantId,changeId){if(typeof tenantId!=='string'||typeof changeId!=='string')return null;return this.#changes.get(`${tenantId}:${changeId}`)??null;}
  #getOpen(tenantId,changeId,status){const row=this.#find(tenantId,changeId);if(!row||row.status!==status)throw new Error('CHANGE_REQUEST_UNAVAILABLE');return row;}
  #assertFresh(row){if(this.#now()>=Date.parse(row.expiresAt))throw new Error('CHANGE_APPROVAL_EXPIRED');}
  #assertAuthorized(context){let allowed=false;try{allowed=this.#authorize(Object.freeze(clone(context)))===true;}catch{throw new Error('CHANGE_CONTROL_AUTHORIZATION_UNAVAILABLE');}if(!allowed)throw new Error('CHANGE_CONTROL_FORBIDDEN');}
  #event(row,eventType,actorId,traceId,evidence){this.#events.push(Object.freeze({id:`che_${crypto.randomUUID()}`,tenantId:row.tenantId,changeId:row.id,eventType,actorId,traceId,occurredAt:this.#at(),evidence:Object.freeze(clone(evidence))}));}
  #at(){return new Date(this.#now()).toISOString();}
}
