import crypto from 'node:crypto';
import {normalizeSession} from './auth.js';
import {LifecycleTransitionGuard,discardLifecyclePromise} from './lifecycleTransition.js';

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
function plain(value,code,required,optional=[]){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||required.some(k=>!Object.hasOwn(value,k))
    ||Reflect.ownKeys(value).some(k=>![...required,...optional].includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw new Error(code);return value;
}
function synchronous(value,code){discardLifecyclePromise(value);if(value&&(typeof value==='object'||typeof value==='function')&&typeof value.then==='function')throw new Error(code);return value;}


function normalizeRelease(value){plain(value,'SUPPORT_DIAGNOSTIC_RELEASE_INVALID',['applicationVersion','releaseFingerprint','configFingerprint','schemaState']);return Object.freeze({
  applicationVersion:id(value.applicationVersion,'SUPPORT_DIAGNOSTIC_VERSION_INVALID'),
  releaseFingerprint:sha(value.releaseFingerprint,'SUPPORT_DIAGNOSTIC_RELEASE_FINGERPRINT_INVALID'),
  configFingerprint:sha(value.configFingerprint,'SUPPORT_DIAGNOSTIC_CONFIG_FINGERPRINT_INVALID'),
  schemaState:state(value.schemaState,'SUPPORT_DIAGNOSTIC_SCHEMA_STATE_INVALID'),
});}
function normalizeDependencies(value){if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>32||Reflect.ownKeys(value).length!==value.length+1)throw new Error('SUPPORT_DIAGNOSTIC_DEPENDENCIES_INVALID');for(let i=0;i<value.length;i++)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(value,String(i))??{},'value'))throw new Error('SUPPORT_DIAGNOSTIC_DEPENDENCIES_INVALID');const out=[];const seen=new Set();for(const item of value){plain(item,'SUPPORT_DIAGNOSTIC_DEPENDENCY_INVALID',['kind','state'],['failureCount']);if(!DEPENDENCIES.has(item.kind)||seen.has(item.kind))throw new Error('SUPPORT_DIAGNOSTIC_DEPENDENCY_INVALID');seen.add(item.kind);out.push(Object.freeze({kind:item.kind,state:state(item.state,'SUPPORT_DIAGNOSTIC_DEPENDENCY_STATE_INVALID'),failureCount:count(item.failureCount??0,'SUPPORT_DIAGNOSTIC_DEPENDENCY_COUNT_INVALID')}));}return Object.freeze(out.sort((a,b)=>a.kind.localeCompare(b.kind)));}
function normalizeQueues(value){plain(value,'SUPPORT_DIAGNOSTIC_QUEUES_INVALID',[],['pending','claimed','failed','oldestAgeSeconds']);const keys=['pending','claimed','failed','oldestAgeSeconds'];const out={};for(const key of keys)out[key]=count(value[key]??0,'SUPPORT_DIAGNOSTIC_QUEUE_COUNT_INVALID');if(out.oldestAgeSeconds>31_536_000)throw new Error('SUPPORT_DIAGNOSTIC_QUEUE_AGE_INVALID');return Object.freeze(out);}
function normalizeSnapshot(value){plain(value,'SUPPORT_DIAGNOSTIC_FIELD_FORBIDDEN',['release','readinessState','tenantLifecycleState'],['dependencies','queues','activeIncidentCount']);const lifecycle=id(value.tenantLifecycleState,'SUPPORT_DIAGNOSTIC_TENANT_STATE_INVALID');if(!['PROVISIONING','ACTIVE','SUSPENDED','OFFBOARDING','OFFBOARDED','UNKNOWN'].includes(lifecycle))throw new Error('SUPPORT_DIAGNOSTIC_TENANT_STATE_INVALID');return Object.freeze({release:normalizeRelease(value.release),readinessState:state(value.readinessState,'SUPPORT_DIAGNOSTIC_READINESS_INVALID'),dependencies:normalizeDependencies(value.dependencies??[]),queues:normalizeQueues(value.queues??{}),activeIncidentCount:count(value.activeIncidentCount??0,'SUPPORT_DIAGNOSTIC_INCIDENT_COUNT_INVALID'),tenantLifecycleState:lifecycle});}


/** Reference operational-only diagnostics. Durable adoption/current server-session
 * revocation remain upstream requirements; this adds no support administration API. */
export class SupportDiagnosticService{
  #supportAccess;#provider;#audit;#clock;#events=[];#timeoutMs;#maxConcurrent;#pending=new Map();
  constructor({supportAccess,provider,auditEvent=()=>{},now=()=>Date.now(),timeoutMs=5000,maxConcurrent=4}={}){
    if(!supportAccess||typeof supportAccess.assertDiagnosticRead!=='function'||typeof supportAccess.assertGrantCurrent!=='function'||typeof provider!=='function'||typeof auditEvent!=='function'||typeof now!=='function'
      ||!Number.isInteger(timeoutMs)||timeoutMs<50||timeoutMs>10000||!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>16)throw new Error('SUPPORT_DIAGNOSTIC_CONFIGURATION_INVALID');
    this.#supportAccess=supportAccess;this.#provider=provider;this.#audit=auditEvent;this.#clock=new LifecycleTransitionGuard(now,'SUPPORT_DIAGNOSTIC');this.#timeoutMs=timeoutMs;this.#maxConcurrent=maxConcurrent;
  }
  #current(session,matterId,requestId){
    const result=this.#supportAccess.assertGrantCurrent(session,{matterId,requestId,scope:'DIAGNOSTIC_READ'});synchronous(result,'SUPPORT_DIAGNOSTIC_AUTHORITY_UNAVAILABLE');if(result!==true)throw new Error('SUPPORT_DIAGNOSTIC_AUTHORITY_UNAVAILABLE');
  }
  async snapshot(input){
    plain(input,'SUPPORT_DIAGNOSTIC_REQUEST_INVALID',['session','matterId','traceId']);const s=normalizeSession(input.session),matterId=id(input.matterId,'SUPPORT_DIAGNOSTIC_MATTER_INVALID'),traceId=id(input.traceId,'SUPPORT_DIAGNOSTIC_TRACE_INVALID');this.#clock.observeClock();
    const grant=synchronous(this.#supportAccess.assertDiagnosticRead(s,{matterId,traceId}),'SUPPORT_DIAGNOSTIC_AUTHORITY_UNAVAILABLE');
    if(!grant||Object.getOwnPropertyDescriptor(grant,'tenantId')?.value!==s.tenantId||Object.getOwnPropertyDescriptor(grant,'requesterId')?.value!==s.actorId||Object.getOwnPropertyDescriptor(grant,'matterId')?.value!==matterId||Object.getOwnPropertyDescriptor(grant,'scope')?.value!=='DIAGNOSTIC_READ')throw new Error('SUPPORT_DIAGNOSTIC_AUTHORITY_UNAVAILABLE');
    const requestId=id(Object.getOwnPropertyDescriptor(grant,'requestId')?.value,'SUPPORT_DIAGNOSTIC_AUTHORITY_UNAVAILABLE');this.#current(s,matterId,requestId);
    const key=JSON.stringify([s.tenantId,s.actorId,matterId,requestId]);if(this.#pending.has(key)||this.#pending.size>=this.#maxConcurrent)throw new Error('SUPPORT_DIAGNOSTIC_BUSY');
    const entry={settled:false,returned:false};this.#pending.set(key,entry);const controller=new AbortController();let timer;
    const release=()=>{if(entry.settled&&entry.returned&&this.#pending.get(key)===entry)this.#pending.delete(key);};
    const provider=Promise.resolve().then(()=>this.#provider(Object.freeze({tenantId:s.tenantId,matterId,traceId,signal:controller.signal}))).then(value=>{entry.settled=true;release();return value;},()=>{entry.settled=true;release();throw new Error('SUPPORT_DIAGNOSTIC_UNAVAILABLE');});
    try{
      const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('SUPPORT_DIAGNOSTIC_UNAVAILABLE'));},this.#timeoutMs);});
      const raw=await Promise.race([provider,deadline]);if(timer)clearTimeout(timer);this.#clock.observeClock();this.#current(s,matterId,requestId);
      const snapshot=normalizeSnapshot(raw),snapshotHash=digest(snapshot),event=Object.freeze({id:`sde_${crypto.randomUUID()}`,tenantId:s.tenantId,requestId,actorHash:digest(s.actorId),matterHash:digest(matterId),snapshotHash,generatedAt:new Date(this.#clock.observeClock()).toISOString(),traceId});
      try{synchronous(this.#audit(event),'SUPPORT_DIAGNOSTIC_SYNC_AUDIT_REQUIRED');}catch{throw new Error('SUPPORT_DIAGNOSTIC_AUDIT_UNAVAILABLE');}
      this.#clock.observeClock();this.#current(s,matterId,requestId);this.#events.push(event);
      return Object.freeze({snapshotId:event.id,snapshotHash,generatedAt:event.generatedAt,...snapshot});
    }finally{if(timer)clearTimeout(timer);entry.returned=true;release();}
  }
  evidence(tenantId){tenantId=id(tenantId,'SUPPORT_DIAGNOSTIC_TENANT_INVALID');return Object.freeze(this.#events.filter(x=>x.tenantId===tenantId).map(clone));}
}
