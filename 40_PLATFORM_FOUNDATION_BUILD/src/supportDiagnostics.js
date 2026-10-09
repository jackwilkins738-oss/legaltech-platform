import crypto from 'node:crypto';
import {normalizeSession} from './auth.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA=/^[a-f0-9]{64}$/;
const STATES=new Set(['HEALTHY','DEGRADED','UNREADY','UNKNOWN']);
const DEPENDENCIES=new Set(['DATABASE','QUEUE','OBJECT_STORAGE','AUDIT','GRAPH','PROCLAIM','IDENTITY','SECRETS']);
const clone=value=>structuredClone(value);
const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function id(value,code){if(typeof value!=='string'||!ID.test(value))throw new Error(code);return value;}
function sha(value,code){if(typeof value!=='string'||!SHA.test(value))throw new Error(code);return value;}
function count(value,code){if(!Number.isSafeInteger(value)||value<0||value>1_000_000_000)throw new Error(code);return value;}
function state(value,code){if(!STATES.has(value))throw new Error(code);return value;}
function plain(value,code){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error(code);return value;}

function normalizeRelease(value){plain(value,'SUPPORT_DIAGNOSTIC_RELEASE_INVALID');return Object.freeze({
  applicationVersion:id(value.applicationVersion,'SUPPORT_DIAGNOSTIC_VERSION_INVALID'),
  releaseFingerprint:sha(value.releaseFingerprint,'SUPPORT_DIAGNOSTIC_RELEASE_FINGERPRINT_INVALID'),
  configFingerprint:sha(value.configFingerprint,'SUPPORT_DIAGNOSTIC_CONFIG_FINGERPRINT_INVALID'),
  schemaState:state(value.schemaState,'SUPPORT_DIAGNOSTIC_SCHEMA_STATE_INVALID'),
});}
function normalizeDependencies(value){if(!Array.isArray(value)||value.length>32)throw new Error('SUPPORT_DIAGNOSTIC_DEPENDENCIES_INVALID');const out=[];const seen=new Set();for(const item of value){plain(item,'SUPPORT_DIAGNOSTIC_DEPENDENCY_INVALID');if(!DEPENDENCIES.has(item.kind)||seen.has(item.kind))throw new Error('SUPPORT_DIAGNOSTIC_DEPENDENCY_INVALID');seen.add(item.kind);out.push(Object.freeze({kind:item.kind,state:state(item.state,'SUPPORT_DIAGNOSTIC_DEPENDENCY_STATE_INVALID'),failureCount:count(item.failureCount??0,'SUPPORT_DIAGNOSTIC_DEPENDENCY_COUNT_INVALID')}));}return Object.freeze(out.sort((a,b)=>a.kind.localeCompare(b.kind)));}
function normalizeQueues(value){plain(value,'SUPPORT_DIAGNOSTIC_QUEUES_INVALID');const keys=['pending','claimed','failed','oldestAgeSeconds'];const out={};for(const key of keys)out[key]=count(value[key]??0,'SUPPORT_DIAGNOSTIC_QUEUE_COUNT_INVALID');if(out.oldestAgeSeconds>31_536_000)throw new Error('SUPPORT_DIAGNOSTIC_QUEUE_AGE_INVALID');return Object.freeze(out);}
function normalizeSnapshot(value){plain(value,'SUPPORT_DIAGNOSTIC_SNAPSHOT_INVALID');const allowed=new Set(['release','readinessState','dependencies','queues','activeIncidentCount','tenantLifecycleState']);for(const key of Object.keys(value))if(!allowed.has(key))throw new Error('SUPPORT_DIAGNOSTIC_FIELD_FORBIDDEN');const lifecycle=id(value.tenantLifecycleState,'SUPPORT_DIAGNOSTIC_TENANT_STATE_INVALID');if(!['PROVISIONING','ACTIVE','SUSPENDED','OFFBOARDING','OFFBOARDED','UNKNOWN'].includes(lifecycle))throw new Error('SUPPORT_DIAGNOSTIC_TENANT_STATE_INVALID');return Object.freeze({release:normalizeRelease(value.release),readinessState:state(value.readinessState,'SUPPORT_DIAGNOSTIC_READINESS_INVALID'),dependencies:normalizeDependencies(value.dependencies??[]),queues:normalizeQueues(value.queues??{}),activeIncidentCount:count(value.activeIncidentCount??0,'SUPPORT_DIAGNOSTIC_INCIDENT_COUNT_INVALID'),tenantLifecycleState:lifecycle});}

/**
 * Reference diagnostic snapshot boundary. Providers must return bounded operational
 * state only. Arbitrary error strings, hostnames, client content, identifiers and
 * secret material are structurally impossible in the returned snapshot shape.
 */
export class SupportDiagnosticService{
  #supportAccess;#provider;#audit;#now;#events=[];
  constructor({supportAccess,provider,auditEvent=()=>{},now=()=>Date.now()}={}){
    if(!supportAccess||typeof supportAccess.assertDiagnosticRead!=='function'||typeof provider!=='function'||typeof auditEvent!=='function'||typeof now!=='function')throw new Error('SUPPORT_DIAGNOSTIC_CONFIGURATION_INVALID');
    this.#supportAccess=supportAccess;this.#provider=provider;this.#audit=auditEvent;this.#now=now;
  }
  async snapshot({session,matterId,traceId}){
    const s=normalizeSession(session);matterId=id(matterId,'SUPPORT_DIAGNOSTIC_MATTER_INVALID');traceId=id(traceId,'SUPPORT_DIAGNOSTIC_TRACE_INVALID');
    const grant=this.#supportAccess.assertDiagnosticRead(session,{matterId,traceId});
    let raw;try{raw=await this.#provider(Object.freeze({tenantId:s.tenantId,matterId,traceId}));}catch{throw new Error('SUPPORT_DIAGNOSTIC_UNAVAILABLE');}
    const snapshot=normalizeSnapshot(raw),snapshotHash=digest(snapshot),event=Object.freeze({id:`sde_${crypto.randomUUID()}`,tenantId:s.tenantId,requestId:grant.requestId,actorHash:digest(s.actorId),matterHash:digest(matterId),snapshotHash,generatedAt:new Date(this.#now()).toISOString(),traceId});
    this.#events.push(event);this.#audit(event);
    return Object.freeze({snapshotId:event.id,snapshotHash,generatedAt:event.generatedAt,...clone(snapshot)});
  }
  evidence(tenantId){tenantId=id(tenantId,'SUPPORT_DIAGNOSTIC_TENANT_INVALID');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(clone));}
}
