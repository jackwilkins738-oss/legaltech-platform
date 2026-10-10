import crypto from 'node:crypto';
import {PostgresDomainJobHandlers} from './postgresDomainHandlers.js';
import {isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {isProductionReadiness,boundedReadinessStatus} from './productionAdmission.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
const registered=new WeakSet();
const failure=code=>new Error(`PROCESSING_INGRESS_${code}`);
function shape(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length
    ||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw failure('INPUT_INVALID');
}
function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw failure('INPUT_INVALID');return value;}
function digest(value){if(typeof value!=='string'||!HEX.test(value))throw failure('INPUT_INVALID');return value;}
function stableId(namespace,tenant,source,key,purpose){
  const hex=crypto.createHash('sha256').update(JSON.stringify(['processing-ingress-v129',namespace,tenant,source,key,purpose])).digest('hex').slice(0,32).split('');
  hex[12]='8';hex[16]=((parseInt(hex[16],16)&3)|8).toString(16);
  const v=hex.join('');return `${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20)}`;
}
const payloadFields=['tenantId','actorId','sourceKey','payloadId','payloadHash','versionId','evidenceHash','revision','state'];
function extract(input,keys){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).some(k=>!keys.includes(k)&&k!=='signal')
    ||Reflect.ownKeys(input).some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)??{},'value')))throw failure('INPUT_INVALID');
  return {signal:Object.getOwnPropertyDescriptor(input,'signal')?.value,value:Object.fromEntries(keys.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]))};
}
const policyFields=['tenantId','actorId','sourceKey','matterId','policyVersionId','policyVersionHash','versionId','evidenceHash','revision','state'];

// Resolves already-approved managed references; no upload bytes, arbitrary
// resource URL, webhook claims or business approval enter this interface.
export class ManagedProcessingIngress {
  #handlers;#drain;#readiness;#namespace;#resolve;#authorize;#verify;#audit;#sourceProbe;
  #timeout;#maxPending;#pending=new Set();#probePending=false;#uncertain=false;
  constructor({handlers,drain,readiness,namespace,resolveUpload,resolveGraph,resolvePolicy,
    authorizeIngress,verifySourceEvidence,audit,probeSources,timeoutMs=10000,maxPending=16}={}){
    if(!(handlers instanceof PostgresDomainJobHandlers)||!isManagedDeploymentDrain(drain)||!isProductionReadiness(readiness)
      ||[resolveUpload,resolveGraph,resolvePolicy,authorizeIngress,verifySourceEvidence,audit,probeSources].some(v=>typeof v!=='function')
      ||typeof namespace!=='string'||!UUID.test(namespace)||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000
      ||!Number.isInteger(maxPending)||maxPending<1||maxPending>100)throw failure('CONFIGURATION_INVALID');
    this.#handlers=Object.freeze({registerInbound:handlers.registerInbound.bind(handlers),requestPolicyEvaluation:handlers.requestPolicyEvaluation.bind(handlers)});
    this.#drain=drain;this.#readiness=readiness;this.#namespace=namespace;
    this.#resolve=Object.freeze({UPLOAD:resolveUpload,GRAPH:resolveGraph,POLICY:resolvePolicy});
    this.#authorize=authorizeIngress;this.#verify=verifySourceEvidence;this.#audit=audit;this.#sourceProbe=probeSources;
    this.#timeout=timeoutMs;this.#maxPending=maxPending;registered.add(this);Object.freeze(this);
  }
  submitUpload(input){
    const {signal,value}=extract(input,['tenantId','actorId','uploadId']);shape(value,['tenantId','actorId','uploadId']);for(const k of Object.keys(value))uuid(value[k]);
    return this.#run('UPLOAD',Object.freeze(value),signal);
  }
  dispatchGraph(input){
    const {signal,value}=extract(input,['subscriptionId','notificationFingerprint']);shape(value,['subscriptionId','notificationFingerprint']);uuid(value.subscriptionId);digest(value.notificationFingerprint);
    return this.#run('GRAPH',Object.freeze(value),signal);
  }
  // Internal durable-inbox route pins authoritative tenant and exact source
  // evidence before either resolution can create a domain command.
  dispatchGraphBound(input){
    const {signal,value}=extract(input,['tenantId','sourceEvidenceHash','sourceVersionHash','subscriptionId','notificationFingerprint']);
    shape(value,['tenantId','sourceEvidenceHash','sourceVersionHash','subscriptionId','notificationFingerprint']);uuid(value.tenantId);uuid(value.subscriptionId);digest(value.sourceEvidenceHash);digest(value.sourceVersionHash);digest(value.notificationFingerprint);
    return this.#run('GRAPH',Object.freeze(value),signal);
  }
  submitPolicy(input){
    const {signal,value}=extract(input,['tenantId','actorId','matterId','requestId']);shape(value,['tenantId','actorId','matterId','requestId']);for(const k of Object.keys(value))uuid(value[k]);
    return this.#run('POLICY',Object.freeze(value),signal);
  }
  #binding(kind,value,input){
    const fields=kind==='POLICY'?policyFields:kind==='GRAPH'?[...payloadFields,'subscriptionId','changeType']:payloadFields;
    shape(value,fields);const binding=Object.freeze(Object.fromEntries(fields.map(k=>[k,value[k]])));
    uuid(binding.tenantId);uuid(binding.actorId);digest(binding.evidenceHash);
    if(typeof binding.versionId!=='string'||!/^[-A-Za-z0-9_+/=.:]{1,256}$/.test(binding.versionId)
      ||/^[A-Za-z][A-Za-z0-9+.-]*:/.test(binding.versionId)||['latest','current','null','undefined','head'].includes(binding.versionId.toLowerCase())
      ||!Number.isSafeInteger(binding.revision)||binding.revision<1)throw failure('UNAVAILABLE');
    if(kind==='GRAPH'){
      if(input.tenantId!==undefined&&(binding.tenantId!==input.tenantId||binding.evidenceHash!==input.sourceEvidenceHash||graphApprovedSourceVersionHash(binding)!==input.sourceVersionHash))throw failure('FORBIDDEN');
      if(!['created','updated'].includes(binding.changeType)||binding.subscriptionId!==input.subscriptionId||binding.sourceKey!==input.notificationFingerprint)throw failure('FORBIDDEN');
    }else if(binding.tenantId!==input.tenantId||binding.actorId!==input.actorId||binding.sourceKey!==(kind==='POLICY'?input.requestId:input.uploadId))throw failure('FORBIDDEN');
    if(kind==='POLICY'){
      if(binding.matterId!==input.matterId||binding.state!=='PUBLISHED')throw failure('FORBIDDEN');uuid(binding.policyVersionId);digest(binding.policyVersionHash);
    }else{if(binding.state!=='PROCESSING_ALLOWED')throw failure('FORBIDDEN');uuid(binding.payloadId);digest(binding.payloadHash);}
    return binding;
  }
  async #run(kind,input,parentSignal){
    if(parentSignal!==undefined&&(typeof parentSignal?.aborted!=='boolean'||typeof parentSignal?.addEventListener!=='function'||typeof parentSignal?.removeEventListener!=='function'))throw failure('INPUT_INVALID');
    if(parentSignal?.aborted||this.#uncertain||this.#pending.size>=this.#maxPending)throw failure('UNAVAILABLE');
    const controller=new AbortController(),signal=controller.signal,abort=()=>controller.abort();
    let timer,lease,committing=false,result;
    const check=()=>{if(signal.aborted||this.#uncertain)throw failure('UNAVAILABLE');};
    const ready=async()=>{check();if(await boundedReadinessStatus(this.#readiness,1500)!=='READY')throw failure('UNAVAILABLE');check();};
    const authorize=async(context,phase)=>{check();if(await this.#authorize(Object.freeze({...context,kind,phase,signal}))!==true)throw failure('FORBIDDEN');check();};
    this.#pending.add(controller);
    try{
      parentSignal?.addEventListener('abort',abort,{once:true});if(parentSignal?.aborted)abort();timer=setTimeout(abort,this.#timeout);
      await ready();
      // Acquire before source resolution: ignored cancellation cannot make a
      // global drain appear complete while a source/provider is still owned.
      try{lease=await this.#drain.acquire({operationId:`ingress:${crypto.randomUUID()}`,kind:'INGRESS',signal});}catch{this.#uncertain=true;throw failure('UNAVAILABLE');}
      check();await authorize(input,'RESOLVE');
      const request=Object.freeze(kind==='GRAPH'?{subscriptionId:input.subscriptionId,notificationFingerprint:input.notificationFingerprint,signal}:{...input,signal});
      const binding=this.#binding(kind,await this.#resolve[kind](request),input);check();
      if(await this.#verify(Object.freeze({...binding,kind,signal}))!==true)throw failure('FORBIDDEN');check();
      const source=kind==='UPLOAD'?'MANUAL_UPLOAD':kind==='GRAPH'?'MICROSOFT_GRAPH':'POLICY_EVALUATION';
      const sourceKey=kind==='GRAPH'?JSON.stringify([input.subscriptionId,binding.sourceKey]):binding.sourceKey;
      const ids=Object.freeze(Object.fromEntries(['command','job','event'].map(k=>[`${k}Id`,stableId(this.#namespace,binding.tenantId,source,sourceKey,k)])));
      const metadata=Object.freeze({tenantId:binding.tenantId,actorId:binding.actorId,kind,commandId:ids.commandId,jobId:ids.jobId,
        objectId:kind==='POLICY'?binding.matterId:ids.eventId,artifactId:kind==='POLICY'?binding.policyVersionId:binding.payloadId,
        artifactHash:kind==='POLICY'?binding.policyVersionHash:binding.payloadHash});
      await this.#audit(Object.freeze({...metadata,phase:'ATTEMPT',signal}));check();
      const current=this.#binding(kind,await this.#resolve[kind](request),input);check();
      if(Object.keys(binding).some(k=>current[k]!==binding[k]))throw failure('FORBIDDEN');
      if(await this.#verify(Object.freeze({...current,kind,signal}))!==true)throw failure('FORBIDDEN');
      await ready();await authorize(binding,'DISPATCH');check();
      const command={tenantId:binding.tenantId,actorId:binding.actorId,commandId:ids.commandId,jobId:ids.jobId,traceId:`ingress-command:${ids.commandId}`,signal};
      committing=true;
      const receipt=kind==='POLICY'?await this.#handlers.requestPolicyEvaluation({...command,matterId:binding.matterId,policyVersionId:binding.policyVersionId,policyVersionHash:binding.policyVersionHash})
        :await this.#handlers.registerInbound({...command,eventId:ids.eventId,payloadId:binding.payloadId,payloadHash:binding.payloadHash,sourceSystem:source,
          externalEventId:crypto.createHash('sha256').update(JSON.stringify(['ingress-source-v129',source,sourceKey])).digest('hex')});
      shape(receipt,['tenantId','commandId','jobId','kind','objectId','status','replayed']);
      if(receipt.tenantId!==binding.tenantId||receipt.commandId!==ids.commandId||receipt.jobId!==ids.jobId||receipt.objectId!==metadata.objectId
        ||receipt.kind!==(kind==='POLICY'?'POLICY_EVALUATION':'PROCESS_INBOUND')||receipt.status!=='ACCEPTED'||typeof receipt.replayed!=='boolean')throw failure('OUTCOME_UNKNOWN');
      check();await this.#audit(Object.freeze({...metadata,phase:'ACCEPTED',signal}));check();
      result=Object.freeze({commandId:ids.commandId,jobId:ids.jobId,objectId:metadata.objectId,status:'ACCEPTED',replayed:receipt.replayed});
    }catch(error){
      if(error?.message==='DOMAIN_COMMAND_CONFLICT')throw failure('CONFLICT');
      if(error?.message==='DOMAIN_COMMAND_FORBIDDEN')throw failure('FORBIDDEN');
      if(committing)throw failure('OUTCOME_UNKNOWN');
      if(['PROCESSING_INGRESS_FORBIDDEN','PROCESSING_INGRESS_UNAVAILABLE'].includes(error?.message))throw error;
      throw failure('UNAVAILABLE');
    }finally{
      // Never race an ignored provider or command promise against a deadline.
      // A lost release acknowledgement remains latched in the shared backend.
      try{if(lease)try{await this.#drain.release(lease);}catch{this.#uncertain=true;throw failure('OUTCOME_UNKNOWN');}}
      finally{clearTimeout(timer);try{parentSignal?.removeEventListener('abort',abort);}catch{this.#uncertain=true;throw failure('OUTCOME_UNKNOWN');}finally{this.#pending.delete(controller);}}
    }
    return result;
  }
  status(){return Object.freeze({inFlight:this.#pending.size,uncertain:this.#uncertain});}
  async probe({signal}={}){
    const healthy=()=>!signal?.aborted&&!this.#uncertain&&![...this.#pending].some(c=>c.signal.aborted);
    if(this.#probePending||!healthy())return Object.freeze({ok:false,code:'PROCESSING_INGRESS_UNVERIFIED'});
    this.#probePending=true;
    try{const value=await this.#sourceProbe({signal});const ok=value?.ok===true&&healthy();return Object.freeze({ok,code:ok?'PROCESSING_INGRESS_VERIFIED':'PROCESSING_INGRESS_UNVERIFIED'});}
    catch{return Object.freeze({ok:false,code:'PROCESSING_INGRESS_UNVERIFIED'});}finally{this.#probePending=false;}
  }
}
export const isManagedProcessingIngress=value=>registered.has(value);

// Bind this after authoritative webhook validation. Duplicates still reach
// PostgreSQL: an in-memory "seen" flag does not prove durable delivery.
export function createGraphProcessingDispatch(ingress){
  if(!isManagedProcessingIngress(ingress))throw failure('CONFIGURATION_INVALID');
  const dispatch=ingress.dispatchGraph.bind(ingress);
  return async notification=>{
    const required=['tenantId','subscriptionId','notificationFingerprint','resource','changeType','lifecycleEvent','duplicate'];
    const value=extract(notification,[...required,'traceId']).value;
    if(required.some(k=>!Object.hasOwn(value,k))||typeof value.duplicate!=='boolean'||value.lifecycleEvent!==null||!['created','updated'].includes(value.changeType))throw new Error('GRAPH_PROCESSING_NOTIFICATION_INVALID');
    uuid(value.subscriptionId);digest(value.notificationFingerprint);
    try{return await dispatch({subscriptionId:value.subscriptionId,notificationFingerprint:value.notificationFingerprint});}
    catch{throw new Error('GRAPH_WEBHOOK_DISPATCH_FAILED');}
  };
}

// Source key is excluded: delivery identity is derived from this immutable
// version hash, then durably registered as that key by the source provider.
export function graphApprovedSourceVersionHash(binding){
  return crypto.createHash('sha256').update(JSON.stringify(['graph-approved-source-v132',binding.tenantId,binding.actorId,binding.subscriptionId,binding.changeType,binding.payloadId,binding.payloadHash,binding.versionId,binding.evidenceHash,binding.revision])).digest('hex');
}
