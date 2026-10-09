import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

const POLICY_STATUS=new Set(['DRAFT','PUBLISHED','RETIRED']);
const INTENT_STATUS=new Set(['PENDING_APPROVAL','APPROVED','CANCELLED']);
const SCOPE_KIND=new Set(['RESOURCE','MATTER']);
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const SAFE_ID=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$/;
const clone=v=>structuredClone(v);
const hash=v=>crypto.createHash('sha256').update(canonicalAuditPayload(v)).digest('hex');
function id(value,code){if(typeof value!=='string'||!SAFE_ID.test(value))throw new Error(code);return value;}
function code(value,error){if(typeof value!=='string'||!CODE.test(value))throw new Error(error);return value;}
function iso(value,error){const ms=Date.parse(value);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==value)throw new Error(error);return value;}
function days(value){const n=Number(value);if(!Number.isInteger(n)||n<1||n>36500)throw new Error('LIFECYCLE_RETENTION_DAYS_INVALID');return n;}
function key(...parts){return parts.join(':');}
function safeScope(scope){
  if(!scope||typeof scope!=='object'||Array.isArray(scope)||!SCOPE_KIND.has(scope.kind))throw new Error('LEGAL_HOLD_SCOPE_INVALID');
  if(scope.kind==='MATTER'){if(Object.keys(scope).some(k=>!['kind','matterId'].includes(k)))throw new Error('LEGAL_HOLD_SCOPE_INVALID');return Object.freeze({kind:'MATTER',matterId:id(scope.matterId,'LEGAL_HOLD_SCOPE_INVALID')});}
  if(Object.keys(scope).some(k=>!['kind','resourceClass','resourceRef'].includes(k)))throw new Error('LEGAL_HOLD_SCOPE_INVALID');
  return Object.freeze({kind:'RESOURCE',resourceClass:code(scope.resourceClass,'LEGAL_HOLD_SCOPE_INVALID'),resourceRef:id(scope.resourceRef,'LEGAL_HOLD_SCOPE_INVALID')});
}

export class DataLifecycleRegistry {
  #now;#changeControl;#policies=new Map();#holds=new Map();#intents=new Map();#idempotency=new Map();#events=[];
  constructor({now=()=>Date.now(),changeControl=null}={}){if(typeof now!=='function')throw new Error('LIFECYCLE_CLOCK_INVALID');if(changeControl!=null&&typeof changeControl.executeApproved!=='function')throw new Error('LIFECYCLE_CHANGE_CONTROL_INVALID');this.#now=now;this.#changeControl=changeControl;}
  createPolicyDraft({tenantId,policyKey,resourceClass,retentionDays,actorId}){
    tenantId=id(tenantId,'LIFECYCLE_TENANT_REQUIRED');policyKey=code(policyKey,'LIFECYCLE_POLICY_KEY_INVALID');resourceClass=code(resourceClass,'LIFECYCLE_RESOURCE_CLASS_INVALID');actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');const retention=days(retentionDays);
    const versions=this.#policyVersions(tenantId,policyKey),version=(versions.at(-1)?.version??0)+1,definition={resourceClass,retentionDays:retention};
    const row={id:`lcp_${crypto.randomUUID()}`,tenantId,policyKey,version,status:'DRAFT',resourceClass,retentionDays:retention,definitionHash:hash(definition),createdBy:actorId,createdAt:this.#at(),publishedAt:null,retiredAt:null};
    this.#policies.set(key(tenantId,policyKey,version),row);this.#event(tenantId,'POLICY_DRAFT_CREATED',actorId,row.id,{policyKey,version});return Object.freeze(clone(row));
  }
  publishPolicy({tenantId,policyKey,version,actorId,traceId=null,changeId=null}){
    actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');const row=this.#policy(tenantId,policyKey,version);if(!row||row.status!=='DRAFT')throw new Error('LIFECYCLE_POLICY_DRAFT_UNAVAILABLE');const targetRef=`${policyKey}@${version}`;
    const execute=()=>{const fresh=this.#policy(tenantId,policyKey,version);if(!fresh||fresh.status!=='DRAFT'||fresh.definitionHash!==row.definitionHash)throw new Error('LIFECYCLE_POLICY_DRAFT_UNAVAILABLE');for(const prior of this.#policyVersions(tenantId,policyKey))if(prior.status==='PUBLISHED'){prior.status='RETIRED';prior.retiredAt=this.#at();this.#event(tenantId,'POLICY_RETIRED',actorId,prior.id,{policyKey,version:prior.version});}fresh.status='PUBLISHED';fresh.publishedAt=this.#at();this.#event(tenantId,'POLICY_PUBLISHED',actorId,fresh.id,{policyKey,version});return Object.freeze(clone(fresh));};
    if(!this.#changeControl)return execute();if(!changeId)throw new Error('LIFECYCLE_POLICY_CHANGE_APPROVAL_REQUIRED');traceId=id(traceId,'LIFECYCLE_TRACE_REQUIRED');return this.#changeControl.executeApproved({tenantId,changeId,changeType:'RETENTION_POLICY_PUBLISH',targetRef,targetHash:row.definitionHash,actorId,traceId},execute);
  }
  retirePolicy({tenantId,policyKey,version,actorId}){actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');const row=this.#policy(tenantId,policyKey,version);if(!row||row.status!=='PUBLISHED')throw new Error('LIFECYCLE_POLICY_PUBLISHED_UNAVAILABLE');row.status='RETIRED';row.retiredAt=this.#at();this.#event(tenantId,'POLICY_RETIRED',actorId,row.id,{policyKey,version});return Object.freeze(clone(row));}
  placeHold({tenantId,scope,reasonCode,actorId}){
    tenantId=id(tenantId,'LIFECYCLE_TENANT_REQUIRED');scope=safeScope(scope);reasonCode=code(reasonCode,'LEGAL_HOLD_REASON_INVALID');actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');
    const existing=[...this.#holds.values()].find(h=>h.tenantId===tenantId&&h.status==='ACTIVE'&&canonicalAuditPayload(h.scope)===canonicalAuditPayload(scope));if(existing)return Object.freeze({...clone(existing),replayed:true});
    const row={id:`lgh_${crypto.randomUUID()}`,tenantId,scope,status:'ACTIVE',reasonCode,createdBy:actorId,createdAt:this.#at(),releasedBy:null,releasedAt:null,releaseReasonCode:null};this.#holds.set(key(tenantId,row.id),row);this.#event(tenantId,'LEGAL_HOLD_PLACED',actorId,row.id,{scope});return Object.freeze({...clone(row),replayed:false});
  }
  releaseHold({tenantId,holdId,reasonCode,actorId}){actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');reasonCode=code(reasonCode,'LEGAL_HOLD_RELEASE_REASON_INVALID');const row=this.#holds.get(key(tenantId,holdId));if(!row)throw new Error('LEGAL_HOLD_UNAVAILABLE');if(row.status==='RELEASED')return Object.freeze(clone(row));row.status='RELEASED';row.releasedBy=actorId;row.releasedAt=this.#at();row.releaseReasonCode=reasonCode;this.#event(tenantId,'LEGAL_HOLD_RELEASED',actorId,row.id,{reasonCode});return Object.freeze(clone(row));}
  planDisposition({tenantId,policyKey,resourceClass,resourceRef,matterId=null,createdAt,actorId,idempotencyKey}){
    tenantId=id(tenantId,'LIFECYCLE_TENANT_REQUIRED');policyKey=code(policyKey,'LIFECYCLE_POLICY_KEY_INVALID');resourceClass=code(resourceClass,'LIFECYCLE_RESOURCE_CLASS_INVALID');resourceRef=id(resourceRef,'LIFECYCLE_RESOURCE_REF_INVALID');if(matterId!=null)matterId=id(matterId,'LIFECYCLE_MATTER_ID_INVALID');createdAt=iso(createdAt,'LIFECYCLE_CREATED_AT_INVALID');actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');idempotencyKey=id(idempotencyKey,'LIFECYCLE_IDEMPOTENCY_INVALID');
    const request={policyKey,resourceClass,resourceRef,matterId,createdAt},fingerprint=hash(request),idemKey=key(tenantId,idempotencyKey),prior=this.#idempotency.get(idemKey);if(prior){if(prior.fingerprint!==fingerprint)throw new Error('LIFECYCLE_IDEMPOTENCY_CONFLICT');const old=this.#intents.get(key(tenantId,prior.intentId));if(!old)throw new Error('LIFECYCLE_IDEMPOTENCY_UNAVAILABLE');return Object.freeze({...clone(old),replayed:true});}
    const policy=this.#latestPublished(tenantId,policyKey);if(!policy||policy.resourceClass!==resourceClass)throw new Error('LIFECYCLE_POLICY_UNAVAILABLE');const createdMs=Date.parse(createdAt),now=this.#now();if(createdMs>now)throw new Error('LIFECYCLE_CREATED_AT_INVALID');const eligibleAtMs=createdMs+policy.retentionDays*86400000;if(now<eligibleAtMs)throw new Error('LIFECYCLE_NOT_ELIGIBLE');this.#assertNoHold({tenantId,resourceClass,resourceRef,matterId});
    const row={id:`dpi_${crypto.randomUUID()}`,tenantId,policyKey,policyVersion:policy.version,policyHash:policy.definitionHash,resourceClass,resourceRef,matterId,createdAt,eligibleAt:new Date(eligibleAtMs).toISOString(),status:'PENDING_APPROVAL',requestedBy:actorId,requestedAt:this.#at(),approvedBy:null,approvedAt:null,cancelledBy:null,cancelledAt:null,cancelReasonCode:null};this.#intents.set(key(tenantId,row.id),row);this.#idempotency.set(idemKey,{fingerprint,intentId:row.id});this.#event(tenantId,'DISPOSITION_PLANNED',actorId,row.id,{policyKey,policyVersion:policy.version,resourceClass,matterId});return Object.freeze({...clone(row),replayed:false});
  }
  approveDisposition({tenantId,intentId,actorId}){actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');const row=this.#intents.get(key(tenantId,intentId));if(!row)throw new Error('LIFECYCLE_INTENT_UNAVAILABLE');if(row.status==='APPROVED')return Object.freeze(clone(row));if(row.status!=='PENDING_APPROVAL')throw new Error('LIFECYCLE_INTENT_CLOSED');if(row.requestedBy===actorId)throw new Error('LIFECYCLE_DUAL_CONTROL_REQUIRED');this.#assertNoHold(row);const policy=this.#latestPublished(tenantId,row.policyKey);if(!policy||policy.version!==row.policyVersion||policy.definitionHash!==row.policyHash)throw new Error('LIFECYCLE_POLICY_SUPERSEDED');row.status='APPROVED';row.approvedBy=actorId;row.approvedAt=this.#at();this.#event(tenantId,'DISPOSITION_APPROVED',actorId,row.id,{policyKey:row.policyKey,policyVersion:row.policyVersion});return Object.freeze(clone(row));}
  cancelDisposition({tenantId,intentId,actorId,reasonCode}){actorId=id(actorId,'LIFECYCLE_ACTOR_REQUIRED');reasonCode=code(reasonCode,'LIFECYCLE_CANCEL_REASON_INVALID');const row=this.#intents.get(key(tenantId,intentId));if(!row)throw new Error('LIFECYCLE_INTENT_UNAVAILABLE');if(row.status==='CANCELLED')return Object.freeze(clone(row));if(!INTENT_STATUS.has(row.status)||row.status==='APPROVED')throw new Error('LIFECYCLE_INTENT_CLOSED');row.status='CANCELLED';row.cancelledBy=actorId;row.cancelledAt=this.#at();row.cancelReasonCode=reasonCode;this.#event(tenantId,'DISPOSITION_CANCELLED',actorId,row.id,{reasonCode});return Object.freeze(clone(row));}
  getIntent(tenantId,intentId){const row=this.#intents.get(key(tenantId,intentId));return row?Object.freeze(clone(row)):null;}
  listEvents(tenantId){return Object.freeze(this.#events.filter(e=>e.tenantId===tenantId).map(e=>Object.freeze(clone(e))));}
  #policy(tenantId,policyKey,version){return this.#policies.get(key(tenantId,policyKey,version))??null;}
  #policyVersions(tenantId,policyKey){return [...this.#policies.values()].filter(p=>p.tenantId===tenantId&&p.policyKey===policyKey).sort((a,b)=>a.version-b.version);}
  #latestPublished(tenantId,policyKey){return this.#policyVersions(tenantId,policyKey).filter(p=>p.status==='PUBLISHED').at(-1)??null;}
  #assertNoHold({tenantId,resourceClass,resourceRef,matterId}){for(const hold of this.#holds.values()){if(hold.tenantId!==tenantId||hold.status!=='ACTIVE')continue;if(hold.scope.kind==='RESOURCE'&&hold.scope.resourceClass===resourceClass&&hold.scope.resourceRef===resourceRef)throw new Error('LEGAL_HOLD_ACTIVE');if(hold.scope.kind==='MATTER'&&matterId&&hold.scope.matterId===matterId)throw new Error('LEGAL_HOLD_ACTIVE');}}
  #event(tenantId,type,actorId,objectId,evidence){this.#events.push(Object.freeze({id:`dle_${crypto.randomUUID()}`,tenantId,type,actorId,objectId,occurredAt:this.#at(),evidence:clone(evidence)}));}
  #at(){return new Date(this.#now()).toISOString();}
}
