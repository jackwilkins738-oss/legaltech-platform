import crypto from 'node:crypto';
import {LifecycleTransitionGuard,discardLifecyclePromise} from './lifecycleTransition.js';
import {SECURITY_INTERLOCK_CONTROLS} from './securityInterlock.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const SHA=/^[a-f0-9]{64}$/;
const CONTROLS=new Set(SECURITY_INTERLOCK_CONTROLS);
const SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const CATEGORIES=new Set(['CREDENTIAL','MALWARE','DATA_EXFILTRATION','UNAUTHORIZED_ACCESS','AVAILABILITY','INTEGRITY','OTHER']);
const EVIDENCE_TYPES=new Set(['SECURITY_ALERT','AUDIT','LOG','DOCUMENT_HASH','EXTERNAL_REFERENCE','FORENSIC_SNAPSHOT']);
const STATES=new Set(['OPEN','CONTAINING','CONTAINED','RECOVERING','CLOSED']);
const clone=v=>structuredClone(v);
const key=(tenantId,incidentId)=>JSON.stringify([tenantId,incidentId]);
function id(v,c){if(typeof v!=='string'||!ID.test(v))throw new Error(c);return v;}
function code(v,c){if(typeof v!=='string'||!CODE.test(v))throw new Error(c);return v;}
function hash(v,c){if(typeof v!=='string'||!SHA.test(v))throw new Error(c);return v;}
function iso(v,c){if(typeof v!=='string')throw new Error(c);const ms=Date.parse(v);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==v)throw new Error(c);return v;}
function exact(v,allowed,c){
  if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).some(k=>!allowed.includes(k))
    ||allowed.some(k=>k!=='sourceRefHash'&&!Object.hasOwn(v,k))
    ||Reflect.ownKeys(v).some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value')))throw new Error(c);
  return v;
}
function controls(value,error){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>8||Reflect.ownKeys(value).length!==value.length+1)throw new Error(error);
  for(let i=0;i<value.length;i++)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(value,String(i))??{},'value')||!CONTROLS.has(value[i]))throw new Error(error);
  if(new Set(value).size!==value.length)throw new Error(error);return [...value].sort();
}
function synchronous(value,error){discardLifecyclePromise(value);if(value&&(typeof value==='object'||typeof value==='function')&&typeof value.then==='function')throw new Error(error);return value;}
function statusResult(value,tenantId){
  synchronous(value,'INCIDENT_INTERLOCK_STATUS_UNAVAILABLE');exact(value,['tenantId','activeControls'],'INCIDENT_INTERLOCK_STATUS_UNAVAILABLE');
  if(value.tenantId!==tenantId)throw new Error('INCIDENT_INTERLOCK_STATUS_UNAVAILABLE');
  return controls(value.activeControls,'INCIDENT_INTERLOCK_STATUS_UNAVAILABLE');
}
function activationResult(value,{tenantId,control,incidentId,reasonCode}){
  synchronous(value,'INCIDENT_INTERLOCK_ACTIVATION_UNAVAILABLE');
  if(!value||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('INCIDENT_INTERLOCK_ACTIVATION_UNAVAILABLE');
  for(const [field,expected] of Object.entries({tenantId,control,incidentId,reasonCode,status:'ACTIVE'}))if(Object.getOwnPropertyDescriptor(value,field)?.value!==expected)throw new Error('INCIDENT_INTERLOCK_ACTIVATION_UNAVAILABLE');
}

export class IncidentResponseRegistry {
  #guard;#transitionAt=null;#authorize;#interlocks;#incidents=new Map();#evidence=new Map();#events=[];#audit;#containmentAttempt=null;
  constructor({authorize,interlocks,now=()=>Date.now(),auditEvent=()=>{}}={}){
    if(typeof authorize!=='function'||!interlocks||typeof interlocks.activate!=='function'||typeof interlocks.release!=='function'||typeof interlocks.status!=='function'||typeof now!=='function'||typeof auditEvent!=='function')throw new Error('INCIDENT_RESPONSE_CONFIGURATION_INVALID');
    this.#authorize=authorize;this.#interlocks=interlocks;this.#guard=new LifecycleTransitionGuard(now,'INCIDENT');this.#audit=auditEvent;
  }
  open(input){return this.#change(()=>{
    exact(input,['tenantId','severity','category','reasonCode','actorId','traceId','sourceRefHash'],'INCIDENT_REQUEST_INVALID');
    const tenantId=id(input.tenantId,'INCIDENT_TENANT_REQUIRED'),actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),reasonCode=code(input.reasonCode,'INCIDENT_REASON_INVALID');
    if(!SEVERITIES.has(input.severity))throw new Error('INCIDENT_SEVERITY_INVALID');if(!CATEGORIES.has(input.category))throw new Error('INCIDENT_CATEGORY_INVALID');
    const sourceRefHash=input.sourceRefHash==null?null:hash(input.sourceRefHash,'INCIDENT_SOURCE_HASH_INVALID');
    this.#assert({phase:'OPEN',tenantId,actorId,severity:input.severity,category:input.category});
    const row={id:`inc_${crypto.randomUUID()}`,tenantId,severity:input.severity,category:input.category,status:'OPEN',reasonCode,openedBy:actorId,openedAt:this.#at(),containedAt:null,recoveringAt:null,closedAt:null,closedBy:null,rootCauseHash:null,recoveryEvidenceHash:null,lessonsHash:null,sourceRefHash,containmentControls:null,containmentReasonCode:null,containmentUncertain:false,containmentFailureCode:null};
    this.#event(row,'INCIDENT_OPENED',actorId,traceId,{severity:row.severity,category:row.category,reasonCode,sourceRefHash});this.#incidents.set(key(tenantId,row.id),row);return Object.freeze(clone(row));
  });}
  addEvidence(input){return this.#change(()=>{
    exact(input,['tenantId','incidentId','evidenceType','evidenceHash','sourceRefHash','observedAt','actorId','traceId'],'INCIDENT_EVIDENCE_REQUEST_INVALID');
    const row=this.#get(input.tenantId,input.incidentId);if(row.status==='CLOSED')throw new Error('INCIDENT_CLOSED');
    if(!EVIDENCE_TYPES.has(input.evidenceType))throw new Error('INCIDENT_EVIDENCE_TYPE_INVALID');
    const evidenceHash=hash(input.evidenceHash,'INCIDENT_EVIDENCE_HASH_INVALID'),sourceRefHash=input.sourceRefHash==null?null:hash(input.sourceRefHash,'INCIDENT_SOURCE_HASH_INVALID'),actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),observedAt=iso(input.observedAt,'INCIDENT_EVIDENCE_TIME_INVALID');
    if(Date.parse(observedAt)>Date.parse(this.#at())+300_000)throw new Error('INCIDENT_EVIDENCE_TIME_INVALID');
    this.#assert({phase:'EVIDENCE',tenantId:row.tenantId,actorId,incidentId:row.id,evidenceType:input.evidenceType});
    const item=Object.freeze({id:`ine_${crypto.randomUUID()}`,tenantId:row.tenantId,incidentId:row.id,evidenceType:input.evidenceType,evidenceHash,sourceRefHash,observedAt,recordedAt:this.#at(),actorId,traceId});
    this.#event(row,'INCIDENT_EVIDENCE_RECORDED',actorId,traceId,{evidenceType:input.evidenceType,evidenceHash,sourceRefHash,observedAt});const k=key(row.tenantId,row.id),list=this.#evidence.get(k)??[];list.push(item);this.#evidence.set(k,list);return item;
  });}
  contain(input){return this.#change(()=>{
    exact(input,['tenantId','incidentId','controls','actorId','traceId','reasonCode'],'INCIDENT_CONTAIN_REQUEST_INVALID');
    const row=this.#get(input.tenantId,input.incidentId);if(!['OPEN','CONTAINING'].includes(row.status))throw new Error('INCIDENT_CONTAINMENT_UNAVAILABLE');
    const actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),reasonCode=code(input.reasonCode,'INCIDENT_REASON_INVALID');
    const requested=controls(input.controls,'SECURITY_INTERLOCK_CONTROL_INVALID');if(!requested.length)throw new Error('INCIDENT_CONTROLS_INVALID');
    if(row.containmentControls&&(JSON.stringify(row.containmentControls)!==JSON.stringify(requested)||row.containmentReasonCode!==reasonCode))throw new Error('INCIDENT_CONTAINMENT_SCOPE_MISMATCH');
    this.#assert({phase:'CONTAIN',tenantId:row.tenantId,actorId,incidentId:row.id,controls:requested});
    row.status='CONTAINING';row.containmentControls=requested;row.containmentReasonCode=reasonCode;row.containmentUncertain=true;row.containmentFailureCode='INCIDENT_CONTAINMENT_UNCERTAIN';
    // Provider effects cannot be rolled back. Keep the exact pending plan on any
    // subsequent failure, including uncertain provider/audit outcomes.
    this.#containmentAttempt={row:clone(row)};
    for(const control of requested){const request={tenantId:row.tenantId,control,actorId,traceId,incidentId:row.id,reasonCode};let result;
      try{result=this.#interlocks.activate(Object.freeze(request));activationResult(result,request);}catch{throw new Error('INCIDENT_INTERLOCK_ACTIVATION_UNAVAILABLE');}
      this.#guard.assertUninterrupted();
    }
    const active=this.#status(row.tenantId);if(requested.some(control=>!active.includes(control)))throw new Error('INCIDENT_CONTAINMENT_NOT_CONFIRMED');
    row.status='CONTAINED';row.containedAt=this.#at();row.containmentUncertain=false;row.containmentFailureCode=null;this.#event(row,'INCIDENT_CONTAINED',actorId,traceId,{controls:requested});return Object.freeze(clone(row));
  });}
  beginRecovery(input){return this.#change(()=>{
    exact(input,['tenantId','incidentId','actorId','traceId','recoveryEvidenceHash'],'INCIDENT_RECOVERY_REQUEST_INVALID');const row=this.#get(input.tenantId,input.incidentId);if(row.status!=='CONTAINED'||row.containmentUncertain)throw new Error('INCIDENT_RECOVERY_UNAVAILABLE');
    const actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),recoveryEvidenceHash=hash(input.recoveryEvidenceHash,'INCIDENT_RECOVERY_HASH_INVALID');
    this.#assert({phase:'RECOVER',tenantId:row.tenantId,actorId,incidentId:row.id});const active=this.#status(row.tenantId);
    if(row.containmentControls.some(control=>!active.includes(control)))throw new Error('INCIDENT_CONTAINMENT_NOT_CONFIRMED');
    row.status='RECOVERING';row.recoveringAt=this.#at();row.recoveryEvidenceHash=recoveryEvidenceHash;this.#event(row,'INCIDENT_RECOVERY_STARTED',actorId,traceId,{recoveryEvidenceHash,activeControlCount:active.length});return Object.freeze(clone(row));
  });}
  close(input){return this.#change(()=>{
    exact(input,['tenantId','incidentId','actorId','traceId','rootCauseHash','lessonsHash'],'INCIDENT_CLOSE_REQUEST_INVALID');const row=this.#get(input.tenantId,input.incidentId);if(row.status!=='RECOVERING')throw new Error('INCIDENT_CLOSE_UNAVAILABLE');
    const actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),rootCauseHash=hash(input.rootCauseHash,'INCIDENT_ROOT_CAUSE_HASH_INVALID'),lessonsHash=hash(input.lessonsHash,'INCIDENT_LESSONS_HASH_INVALID');
    if(row.openedBy===actorId)throw new Error('INCIDENT_CLOSE_DUAL_CONTROL_REQUIRED');this.#assert({phase:'CLOSE',tenantId:row.tenantId,actorId,incidentId:row.id});
    if(this.#status(row.tenantId).length)throw new Error('INCIDENT_INTERLOCKS_STILL_ACTIVE');
    row.status='CLOSED';row.closedBy=actorId;row.closedAt=this.#at();row.rootCauseHash=rootCauseHash;row.lessonsHash=lessonsHash;this.#event(row,'INCIDENT_CLOSED',actorId,traceId,{rootCauseHash,lessonsHash,recoveryEvidenceHash:row.recoveryEvidenceHash});return Object.freeze(clone(row));
  });}
  get(tenantId,incidentId){id(tenantId,'INCIDENT_TENANT_REQUIRED');id(incidentId,'INCIDENT_ID_INVALID');const row=this.#incidents.get(key(tenantId,incidentId));return row?Object.freeze(clone(row)):null;}
  evidence(tenantId,incidentId){this.#get(tenantId,incidentId);return Object.freeze((this.#evidence.get(key(tenantId,incidentId))??[]).map(x=>Object.freeze(clone(x))));}
  events(tenantId,incidentId=null){id(tenantId,'INCIDENT_TENANT_REQUIRED');if(incidentId!==null)id(incidentId,'INCIDENT_ID_INVALID');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId&&(incidentId===null||x.incidentId===incidentId)).map(x=>Object.freeze(clone(x))));}
  #get(tenantId,incidentId){tenantId=id(tenantId,'INCIDENT_TENANT_REQUIRED');incidentId=id(incidentId,'INCIDENT_ID_INVALID');const row=this.#incidents.get(key(tenantId,incidentId));if(!row)throw new Error('INCIDENT_UNAVAILABLE');return row;}
  #assert(context){let allowed=false;try{const result=this.#authorize(Object.freeze(clone(context)));discardLifecyclePromise(result);allowed=result===true;}catch{throw new Error('INCIDENT_AUTHORIZATION_UNAVAILABLE');}if(!allowed)throw new Error('INCIDENT_FORBIDDEN');this.#guard.assertUninterrupted();}
  #status(tenantId){try{const active=statusResult(this.#interlocks.status(tenantId),tenantId);this.#guard.assertUninterrupted();return active;}catch{throw new Error('INCIDENT_INTERLOCK_STATUS_UNAVAILABLE');}}
  #event(row,eventType,actorId,traceId,evidence){
    this.#guard.assertUninterrupted();const event=Object.freeze({id:`inev_${crypto.randomUUID()}`,tenantId:row.tenantId,incidentId:row.id,eventType,actorId,traceId,occurredAt:this.#at(),evidence:Object.freeze(clone(evidence))});
    try{synchronous(this.#audit(Object.freeze({...clone(event),evidence:Object.freeze(clone(event.evidence))})),'INCIDENT_SYNC_AUDIT_REQUIRED');}catch{throw new Error('INCIDENT_AUDIT_UNAVAILABLE');}
    this.#guard.assertUninterrupted();this.#events.push(event);
  }
  #at(){return this.#transitionAt;}
  #change(work){
    const priorIncidents=this.#incidents,priorEvidence=this.#evidence,priorEvents=this.#events,priorAt=this.#transitionAt,priorAttempt=this.#containmentAttempt;
    try{return this.#guard.run(at=>{
      this.#transitionAt=at;this.#containmentAttempt=null;this.#incidents=new Map([...priorIncidents].map(([k,row])=>[k,clone(row)]));this.#evidence=new Map([...priorEvidence].map(([k,rows])=>[k,[...rows]]));this.#events=[...priorEvents];return work();
    });}catch(error){
      const attempted=this.#containmentAttempt;this.#incidents=priorIncidents;this.#evidence=priorEvidence;this.#events=priorEvents;
      if(attempted&&attempted!==priorAttempt){this.#incidents=new Map(priorIncidents);this.#incidents.set(key(attempted.row.tenantId,attempted.row.id),attempted.row);}
      throw error;
    }finally{this.#transitionAt=priorAt;this.#containmentAttempt=priorAttempt;}
  }
}
export const INCIDENT_RESPONSE_SEVERITIES=Object.freeze([...SEVERITIES]);
export const INCIDENT_RESPONSE_CATEGORIES=Object.freeze([...CATEGORIES]);
export const INCIDENT_RESPONSE_STATES=Object.freeze([...STATES]);
