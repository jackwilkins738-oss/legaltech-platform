import crypto from 'node:crypto';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const CODE=/^[A-Z0-9][A-Z0-9_.:/-]{0,99}$/;
const SHA=/^[a-f0-9]{64}$/;
const SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const CATEGORIES=new Set(['CREDENTIAL','MALWARE','DATA_EXFILTRATION','UNAUTHORIZED_ACCESS','AVAILABILITY','INTEGRITY','OTHER']);
const EVIDENCE_TYPES=new Set(['SECURITY_ALERT','AUDIT','LOG','DOCUMENT_HASH','EXTERNAL_REFERENCE','FORENSIC_SNAPSHOT']);
const STATES=new Set(['OPEN','CONTAINING','CONTAINED','RECOVERING','CLOSED']);
const clone=v=>structuredClone(v);
function id(v,c){if(typeof v!=='string'||!ID.test(v))throw new Error(c);return v;}
function code(v,c){if(typeof v!=='string'||!CODE.test(v))throw new Error(c);return v;}
function hash(v,c){if(typeof v!=='string'||!SHA.test(v))throw new Error(c);return v;}
function iso(v,c){const ms=Date.parse(v);if(!Number.isFinite(ms)||new Date(ms).toISOString()!==v)throw new Error(c);return v;}
function exact(v,allowed,c){if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new Error(c);for(const k of Object.keys(v))if(!allowed.includes(k))throw new Error(c);return v;}

export class IncidentResponseRegistry {
  #now;#authorize;#interlocks;#incidents=new Map();#evidence=new Map();#events=[];#audit;
  constructor({authorize,interlocks,now=()=>Date.now(),auditEvent=()=>{}}={}){
    if(typeof authorize!=='function'||!interlocks||typeof interlocks.activate!=='function'||typeof interlocks.release!=='function'||typeof interlocks.status!=='function'||typeof now!=='function'||typeof auditEvent!=='function')throw new Error('INCIDENT_RESPONSE_CONFIGURATION_INVALID');
    this.#authorize=authorize;this.#interlocks=interlocks;this.#now=now;this.#audit=auditEvent;
  }
  open(input){
    exact(input,['tenantId','severity','category','reasonCode','actorId','traceId','sourceRefHash'],'INCIDENT_REQUEST_INVALID');
    const tenantId=id(input.tenantId,'INCIDENT_TENANT_REQUIRED'),actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),reasonCode=code(input.reasonCode,'INCIDENT_REASON_INVALID');
    if(!SEVERITIES.has(input.severity))throw new Error('INCIDENT_SEVERITY_INVALID');if(!CATEGORIES.has(input.category))throw new Error('INCIDENT_CATEGORY_INVALID');
    const sourceRefHash=input.sourceRefHash==null?null:hash(input.sourceRefHash,'INCIDENT_SOURCE_HASH_INVALID');
    this.#assert({phase:'OPEN',tenantId,actorId,severity:input.severity,category:input.category});
    const row={id:`inc_${crypto.randomUUID()}`,tenantId,severity:input.severity,category:input.category,status:'OPEN',reasonCode,openedBy:actorId,openedAt:this.#at(),containedAt:null,recoveringAt:null,closedAt:null,closedBy:null,rootCauseHash:null,recoveryEvidenceHash:null,lessonsHash:null,sourceRefHash};
    this.#incidents.set(`${tenantId}:${row.id}`,row);this.#event(row,'INCIDENT_OPENED',actorId,traceId,{severity:row.severity,category:row.category,reasonCode,sourceRefHash});return Object.freeze(clone(row));
  }
  addEvidence(input){
    exact(input,['tenantId','incidentId','evidenceType','evidenceHash','sourceRefHash','observedAt','actorId','traceId'],'INCIDENT_EVIDENCE_REQUEST_INVALID');
    const row=this.#get(input.tenantId,input.incidentId);if(row.status==='CLOSED')throw new Error('INCIDENT_CLOSED');
    if(!EVIDENCE_TYPES.has(input.evidenceType))throw new Error('INCIDENT_EVIDENCE_TYPE_INVALID');
    const evidenceHash=hash(input.evidenceHash,'INCIDENT_EVIDENCE_HASH_INVALID'),sourceRefHash=input.sourceRefHash==null?null:hash(input.sourceRefHash,'INCIDENT_SOURCE_HASH_INVALID'),actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),observedAt=iso(input.observedAt,'INCIDENT_EVIDENCE_TIME_INVALID');
    if(Date.parse(observedAt)>this.#now()+300_000)throw new Error('INCIDENT_EVIDENCE_TIME_INVALID');
    this.#assert({phase:'EVIDENCE',tenantId:row.tenantId,actorId,incidentId:row.id,evidenceType:input.evidenceType});
    const item=Object.freeze({id:`ine_${crypto.randomUUID()}`,tenantId:row.tenantId,incidentId:row.id,evidenceType:input.evidenceType,evidenceHash,sourceRefHash,observedAt,recordedAt:this.#at(),actorId,traceId});
    const key=`${row.tenantId}:${row.id}`;const list=this.#evidence.get(key)??[];list.push(item);this.#evidence.set(key,list);this.#event(row,'INCIDENT_EVIDENCE_RECORDED',actorId,traceId,{evidenceType:input.evidenceType,evidenceHash,sourceRefHash,observedAt});return item;
  }
  contain(input){
    exact(input,['tenantId','incidentId','controls','actorId','traceId','reasonCode'],'INCIDENT_CONTAIN_REQUEST_INVALID');
    const row=this.#get(input.tenantId,input.incidentId);if(!['OPEN','CONTAINING'].includes(row.status))throw new Error('INCIDENT_CONTAINMENT_UNAVAILABLE');
    const actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),reasonCode=code(input.reasonCode,'INCIDENT_REASON_INVALID');
    if(!Array.isArray(input.controls)||input.controls.length<1||input.controls.length>8||new Set(input.controls).size!==input.controls.length)throw new Error('INCIDENT_CONTROLS_INVALID');
    this.#assert({phase:'CONTAIN',tenantId:row.tenantId,actorId,incidentId:row.id,controls:[...input.controls]});row.status='CONTAINING';
    const activated=[];try{for(const control of input.controls){const result=this.#interlocks.activate({tenantId:row.tenantId,control,actorId,traceId,incidentId:row.id,reasonCode});activated.push(result.control);}}catch(error){this.#event(row,'INCIDENT_CONTAINMENT_PARTIAL',actorId,traceId,{controls:activated,errorCode:'INTERLOCK_ACTIVATION_FAILED'});throw error;}
    row.status='CONTAINED';row.containedAt=this.#at();this.#event(row,'INCIDENT_CONTAINED',actorId,traceId,{controls:[...activated].sort()});return Object.freeze(clone(row));
  }
  beginRecovery(input){
    exact(input,['tenantId','incidentId','actorId','traceId','recoveryEvidenceHash'],'INCIDENT_RECOVERY_REQUEST_INVALID');const row=this.#get(input.tenantId,input.incidentId);if(row.status!=='CONTAINED')throw new Error('INCIDENT_RECOVERY_UNAVAILABLE');
    const actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),recoveryEvidenceHash=hash(input.recoveryEvidenceHash,'INCIDENT_RECOVERY_HASH_INVALID');
    this.#assert({phase:'RECOVER',tenantId:row.tenantId,actorId,incidentId:row.id});const status=this.#interlocks.status(row.tenantId);if(!status||!Array.isArray(status.activeControls))throw new Error('INCIDENT_INTERLOCK_STATUS_UNAVAILABLE');
    row.status='RECOVERING';row.recoveringAt=this.#at();row.recoveryEvidenceHash=recoveryEvidenceHash;this.#event(row,'INCIDENT_RECOVERY_STARTED',actorId,traceId,{recoveryEvidenceHash,activeControlCount:status.activeControls.length});return Object.freeze(clone(row));
  }
  close(input){
    exact(input,['tenantId','incidentId','actorId','traceId','rootCauseHash','lessonsHash'],'INCIDENT_CLOSE_REQUEST_INVALID');const row=this.#get(input.tenantId,input.incidentId);if(row.status!=='RECOVERING')throw new Error('INCIDENT_CLOSE_UNAVAILABLE');
    const actorId=id(input.actorId,'INCIDENT_ACTOR_REQUIRED'),traceId=id(input.traceId,'INCIDENT_TRACE_REQUIRED'),rootCauseHash=hash(input.rootCauseHash,'INCIDENT_ROOT_CAUSE_HASH_INVALID'),lessonsHash=hash(input.lessonsHash,'INCIDENT_LESSONS_HASH_INVALID');
    if(row.openedBy===actorId)throw new Error('INCIDENT_CLOSE_DUAL_CONTROL_REQUIRED');this.#assert({phase:'CLOSE',tenantId:row.tenantId,actorId,incidentId:row.id});
    const active=this.#interlocks.status(row.tenantId)?.activeControls;if(!Array.isArray(active))throw new Error('INCIDENT_INTERLOCK_STATUS_UNAVAILABLE');if(active.length)throw new Error('INCIDENT_INTERLOCKS_STILL_ACTIVE');
    row.status='CLOSED';row.closedBy=actorId;row.closedAt=this.#at();row.rootCauseHash=rootCauseHash;row.lessonsHash=lessonsHash;this.#event(row,'INCIDENT_CLOSED',actorId,traceId,{rootCauseHash,lessonsHash,recoveryEvidenceHash:row.recoveryEvidenceHash});return Object.freeze(clone(row));
  }
  get(tenantId,incidentId){const row=this.#incidents.get(`${tenantId}:${incidentId}`);return row?Object.freeze(clone(row)):null;}
  evidence(tenantId,incidentId){this.#get(tenantId,incidentId);return Object.freeze((this.#evidence.get(`${tenantId}:${incidentId}`)??[]).map(x=>Object.freeze(clone(x))));}
  events(tenantId,incidentId=null){return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId&&(incidentId==null||x.incidentId===incidentId)).map(x=>Object.freeze(clone(x))));}
  #get(tenantId,incidentId){tenantId=id(tenantId,'INCIDENT_TENANT_REQUIRED');incidentId=id(incidentId,'INCIDENT_ID_INVALID');const row=this.#incidents.get(`${tenantId}:${incidentId}`);if(!row)throw new Error('INCIDENT_UNAVAILABLE');return row;}
  #assert(context){let allowed=false;try{allowed=this.#authorize(Object.freeze(clone(context)))===true;}catch{throw new Error('INCIDENT_AUTHORIZATION_UNAVAILABLE');}if(!allowed)throw new Error('INCIDENT_FORBIDDEN');}
  #event(row,eventType,actorId,traceId,evidence){const event=Object.freeze({id:`inev_${crypto.randomUUID()}`,tenantId:row.tenantId,incidentId:row.id,eventType,actorId,traceId,occurredAt:this.#at(),evidence:Object.freeze(clone(evidence))});this.#events.push(event);this.#audit(event);}
  #at(){return new Date(this.#now()).toISOString();}
}

export const INCIDENT_RESPONSE_SEVERITIES=Object.freeze([...SEVERITIES]);
export const INCIDENT_RESPONSE_CATEGORIES=Object.freeze([...CATEGORIES]);
export const INCIDENT_RESPONSE_STATES=Object.freeze([...STATES]);
