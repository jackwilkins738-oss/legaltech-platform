import crypto from 'node:crypto';
import {GraphWebhookIngress} from './graphWebhookIngress.js';
import {PostgresGraphInboxProducer,PostgresGraphInboxWorker,PostgresGraphInboxReader,graphInboxShape,graphInboxUuid,graphInboxHash,isPostgresGraphInbox} from './postgresGraphInbox.js';
import {isManagedProcessingIngress} from './managedProcessingIngress.js';
import {isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {isProductionReadiness,boundedReadinessStatus} from './productionAdmission.js';

const registered=new WeakSet(),sha=v=>crypto.createHash('sha256').update(v).digest('hex'),failure=code=>new Error(`GRAPH_INBOX_${code}`);
const types={created:'CREATED',updated:'UPDATED',deleted:'DELETED',unknownFutureValue:'UNKNOWN',missed:'MISSED',subscriptionRemoved:'SUBSCRIPTION_REMOVED',reauthorizationRequired:'REAUTHORIZATION_REQUIRED'};
function integer(v,min,max){if(!Number.isInteger(v)||v<min||v>max)throw failure('CONFIGURATION_INVALID');}
function signalValid(v){if(v!==undefined&&(typeof v?.aborted!=='boolean'||typeof v.addEventListener!=='function'||typeof v.removeEventListener!=='function'))throw failure('INPUT_INVALID');}
function payloadCopy(value,maxBytes){
  let count=0;
  const walk=(v,depth)=>{
    if(++count>20000||depth>16)throw failure('INPUT_INVALID');
    if(v===null||typeof v==='boolean'||typeof v==='string'||typeof v==='number'&&Number.isFinite(v))return v;
    if(!v||typeof v!=='object'||!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype)throw failure('INPUT_INVALID');
    const keys=Reflect.ownKeys(v);if(keys.some(k=>typeof k!=='string'||!Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value')))throw failure('INPUT_INVALID');
    if(Array.isArray(v)){if(Object.getPrototypeOf(v)!==Array.prototype||v.length>1000||keys.length!==v.length+1||Array.from({length:v.length},(_,i)=>i).some(i=>!Object.hasOwn(Object.getOwnPropertyDescriptor(v,String(i))??{},'value')))throw failure('INPUT_INVALID');return Array.from(v,x=>walk(x,depth+1));}
    return Object.fromEntries(keys.map(k=>[k,walk(v[k],depth+1)]));
  };
  const copy=walk(value,0);if(!copy||Object.getPrototypeOf(copy)!==Object.prototype||Reflect.ownKeys(copy).some(k=>!['value','validationTokens'].includes(k))||!Array.isArray(copy.value)||copy.value.length<1||copy.value.length>100)throw failure('INPUT_INVALID');
  if(Buffer.byteLength(JSON.stringify(copy))>maxBytes)throw failure('INPUT_INVALID');return copy;
}
export function graphSourceDeliveryFingerprint({tenantId,subscriptionId,validatedFingerprint,sourceVersionHash,eventType}={}){
  graphInboxUuid(tenantId);graphInboxUuid(subscriptionId);graphInboxHash(validatedFingerprint);graphInboxHash(sourceVersionHash);if(!Object.values(types).includes(eventType))throw failure('INPUT_INVALID');
  return sha(JSON.stringify(['graph-source-delivery-v132',tenantId,subscriptionId,validatedFingerprint,sourceVersionHash,eventType]));
}
function sourceReceipt(value,row){
  graphInboxShape(value,['tenantId','subscriptionId','notificationFingerprint','validatedFingerprint','sourceEvidenceHash','sourceVersionHash']);
  if(['tenantId','subscriptionId'].some(k=>value[k]!==row[k])||value.validatedFingerprint!==row.notificationFingerprint)throw failure('UNVERIFIED');
  graphInboxHash(value.sourceEvidenceHash);graphInboxHash(value.sourceVersionHash);const eventType=types[row.changeType??row.lifecycleEvent];
  if(value.notificationFingerprint!==graphSourceDeliveryFingerprint({...value,eventType}))throw failure('UNVERIFIED');
  return Object.freeze({tenantId:value.tenantId,subscriptionId:value.subscriptionId,notificationFingerprint:value.notificationFingerprint,sourceEvidenceHash:value.sourceEvidenceHash,sourceVersionHash:value.sourceVersionHash,eventType});
}
function stableOutcome(value,claim,control){
  if(control){graphInboxShape(value,['tenantId','subscriptionId','notificationFingerprint','sourceEvidenceHash','sourceVersionHash','status']);if(value.status!=='ACCEPTED'||['tenantId','subscriptionId','notificationFingerprint','sourceEvidenceHash','sourceVersionHash'].some(k=>value[k]!==claim[k]))throw failure('UNVERIFIED');return sha(JSON.stringify(['graph-control-outcome-v132',value.tenantId,value.subscriptionId,value.notificationFingerprint,value.sourceEvidenceHash,value.sourceVersionHash,value.status]));}
  graphInboxShape(value,['commandId','jobId','objectId','status','replayed']);if(value.status!=='ACCEPTED'||typeof value.replayed!=='boolean')throw failure('UNVERIFIED');for(const k of ['commandId','jobId','objectId'])graphInboxUuid(value[k]);
  return sha(JSON.stringify(['graph-domain-outcome-v132',claim.tenantId,value.commandId,value.jobId,'PROCESS_INBOUND',value.objectId,value.status]));
}

// Raw notifications exist only during validation. 202 means all validated source
// references were committed to the inbox, not processed or legally approved.
export class ManagedGraphWebhookIntake {
  #producer;#worker;#reader;#processing;#resolve;#verify;#register;#authorize;#control;#probeGraph;#readiness;#drain;
  #timeout;#maxPending;#maxBytes;#pending=new Set();#closed=false;#uncertain=false;#probePending=null;
  constructor({producer,worker,reader,processingIngress,resolveSubscription,verifyValidationTokens=null,registerSource,authorizeDispatch,dispatchControl,probeGraph,drain,readiness,
    timeoutMs=10000,maxPending=16,maxBodyBytes=256*1024}={}){
    if(![producer,worker,reader].every(isPostgresGraphInbox)||!(producer instanceof PostgresGraphInboxProducer)||!(worker instanceof PostgresGraphInboxWorker)||!(reader instanceof PostgresGraphInboxReader)
      ||!isManagedProcessingIngress(processingIngress)||!isManagedDeploymentDrain(drain)||!isProductionReadiness(readiness)
      ||[resolveSubscription,registerSource,authorizeDispatch,dispatchControl,probeGraph].some(v=>typeof v!=='function')||verifyValidationTokens!==null&&typeof verifyValidationTokens!=='function')throw failure('CONFIGURATION_INVALID');
    integer(timeoutMs,100,60000);integer(maxPending,1,100);integer(maxBodyBytes,1024,1024*1024);
    this.#producer=Object.freeze({enqueueBatch:producer.enqueueBatch.bind(producer),probe:producer.probe.bind(producer)});
    this.#worker=Object.freeze(Object.fromEntries(['claimNext','assertCurrent','complete','fail','probe'].map(k=>[k,worker[k].bind(worker)])));
    this.#reader=Object.freeze({probe:reader.probe.bind(reader)});this.#processing=processingIngress.dispatchGraphBound.bind(processingIngress);
    this.#resolve=resolveSubscription;this.#verify=verifyValidationTokens;this.#register=registerSource;this.#authorize=authorizeDispatch;this.#control=dispatchControl;this.#probeGraph=probeGraph;this.#readiness=readiness;this.#drain=drain;
    this.#timeout=timeoutMs;this.#maxPending=maxPending;this.#maxBytes=maxBodyBytes;registered.add(this);Object.freeze(this);
  }
  status(){return Object.freeze({inFlight:this.#pending.size,acceptingNew:!this.#closed&&!this.#uncertain&&this.#pending.size<this.#maxPending,uncertain:this.#uncertain});}
  #check(signal){if(signal.aborted||this.#closed||this.#uncertain)throw failure('UNVERIFIED');}
  async #admit(signal){this.#check(signal);if(await boundedReadinessStatus(this.#readiness,1500)!=='READY')throw failure('UNVERIFIED');this.#check(signal);}
  #run(kind,signal,work){
    signalValid(signal);if(signal?.aborted||!this.status().acceptingNew)throw failure('UNVERIFIED');
    const controller=new AbortController(),entry={controller};this.#pending.add(entry);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(abort,this.#timeout);
    const task=Promise.resolve().then(async()=>{
      let lease,result,error;
      try{
        this.#check(controller.signal);
        try{lease=await this.#drain.acquire({kind,operationId:`graph-inbox:${crypto.randomUUID()}`});}catch{this.#uncertain=true;throw failure('UNVERIFIED');}
        this.#check(controller.signal);result=await work(controller.signal);
      }catch(e){error=e;}
      finally{
        if(lease)try{await this.#drain.release(lease);}catch{this.#uncertain=true;error=failure('OUTCOME_UNKNOWN');}
      }
      this.#check(controller.signal);if(error)throw error;return result;
    });entry.task=task;
    task.finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.#pending.delete(entry);}).catch(()=>{});return task;
  }
  receive(value,{signal}={}){
    const payload=payloadCopy(value,this.#maxBytes);
    return this.#run('INGRESS',signal,async internal=>{
      await this.#admit(internal);
      // One validator per request: reference staging/seen collections cannot
      // grow across requests or masquerade as durable completion evidence.
      const validator=new GraphWebhookIngress({resolveSubscription:input=>this.#resolve(Object.freeze({...input,signal:internal})),verifyValidationTokens:this.#verify?tokens=>this.#verify(tokens,Object.freeze({signal:internal})):null,maxItems:100,maxBytes:this.#maxBytes});
      const staged=validator.receive(payload,{traceId:`graph-validation:${crypto.randomUUID()}`});let rows;
      try{rows=await validator.validate(staged.intakeId);}catch(error){if(['GRAPH_WEBHOOK_DEPENDENCY_UNAVAILABLE','GRAPH_WEBHOOK_VERIFIER_UNAVAILABLE','GRAPH_WEBHOOK_SUBSCRIPTION_UNAVAILABLE'].includes(error?.message))throw failure('UNVERIFIED');throw failure('INPUT_INVALID');}
      this.#check(internal);const unique=new Map();
      for(const row of rows){
        graphInboxUuid(row.tenantId);graphInboxUuid(row.subscriptionId);graphInboxHash(row.notificationFingerprint);if(!types[row.changeType??row.lifecycleEvent])throw failure('INPUT_INVALID');
        const key=JSON.stringify([row.tenantId,row.subscriptionId,row.notificationFingerprint]);if(unique.has(key))continue;
        // This provider must durably publish the approved immutable mapping
        // consumed by V129 resolveGraph before acknowledging registration.
        const receipt=sourceReceipt(await this.#register(Object.freeze({...row,signal:internal})),row);this.#check(internal);unique.set(key,receipt);
      }
      await this.#admit(internal);let accepted=0,replayed=0;
      const tenants=[...new Set([...unique.values()].map(v=>v.tenantId))].sort();
      for(const tenantId of tenants){
        const batch=[...unique.values()].filter(v=>v.tenantId===tenantId),output=await this.#producer.enqueueBatch(batch,{signal:internal});this.#check(internal);
        if(!Array.isArray(output)||output.length!==batch.length)throw failure('OUTCOME_UNKNOWN');
        for(let i=0;i<output.length;i++){const receipt=output[i];if(!receipt||Object.keys(batch[i]).some(k=>receipt[k]!==batch[i][k])||typeof receipt.replayed!=='boolean'||!['QUEUED','RUNNING','DONE','DEAD'].includes(receipt.status))throw failure('OUTCOME_UNKNOWN');if(receipt.status==='DEAD')throw failure('UNVERIFIED');accepted++;if(receipt.replayed)replayed++;}
      }
      return Object.freeze({status:202,accepted,replayed});
    });
  }
  relay({tenantId,actorId,limit=25,signal}={}){
    graphInboxUuid(tenantId);graphInboxUuid(actorId);integer(limit,1,100);
    return this.#run('BACKGROUND',signal,async internal=>{
      // Bootstrap canaries and temporary provider outages must not claim a job
      // before processing admission is ready, or poison the supervisor.
      const ready=await boundedReadinessStatus(this.#readiness,1500);this.#check(internal);
      if(ready!=='READY')return Object.freeze({ok:true,scanned:0,delivered:0});
      let delivered=0;
      for(let i=0;i<limit;i++){
        this.#check(internal);let claim;
        try{claim=await this.#worker.claimNext({tenantId,signal:internal});}catch(error){if(error?.message==='GRAPH_INBOX_OUTCOME_UNKNOWN')this.#uncertain=true;throw error;}
        if(!claim)break;let dispatched=false,settling=false,controlStarted=false;
        try{
          this.#check(internal);
          const subscription=await this.#resolve(Object.freeze({subscriptionId:claim.subscriptionId,signal:internal}));this.#check(internal);
          if(!subscription||subscription.tenantId!==tenantId||subscription.subscriptionId!==claim.subscriptionId||subscription.status!=='ACTIVE'||typeof subscription.expiresAt!=='string'||!Number.isFinite(Date.parse(subscription.expiresAt))||Date.parse(subscription.expiresAt)<=Date.now())throw failure('FORBIDDEN');
          if(await this.#authorize(Object.freeze({tenantId,actorId,subscriptionId:claim.subscriptionId,notificationFingerprint:claim.notificationFingerprint,sourceEvidenceHash:claim.sourceEvidenceHash,sourceVersionHash:claim.sourceVersionHash,eventType:claim.eventType,phase:'DISPATCH',signal:internal}))!==true)throw failure('FORBIDDEN');this.#check(internal);
          if(await this.#worker.assertCurrent(claim,{signal:internal})!==true)throw failure('UNVERIFIED');this.#check(internal);
          const control=!['CREATED','UPDATED'].includes(claim.eventType);
          if(control)controlStarted=true;
          const result=control?await this.#control(Object.freeze({tenantId,subscriptionId:claim.subscriptionId,notificationFingerprint:claim.notificationFingerprint,sourceEvidenceHash:claim.sourceEvidenceHash,sourceVersionHash:claim.sourceVersionHash,eventType:claim.eventType,signal:internal})):await this.#processing({tenantId:claim.tenantId,sourceEvidenceHash:claim.sourceEvidenceHash,sourceVersionHash:claim.sourceVersionHash,subscriptionId:claim.subscriptionId,notificationFingerprint:claim.notificationFingerprint,signal:internal});
          dispatched=true;const outcomeHash=stableOutcome(result,claim,control);this.#check(internal);settling=true;
          if(await this.#worker.complete(claim,{outcomeHash,signal:internal})!==true)throw failure('OUTCOME_UNKNOWN');this.#check(internal);delivered++;
        }catch(error){
          // A cancelled callback is awaited above. Only after real settlement
          // may its exact claim be requeued. Never race a still-live provider.
          if(settling||controlStarted){this.#uncertain=true;throw failure('OUTCOME_UNKNOWN');}
          const retryable=internal.aborted||dispatched||!['GRAPH_INBOX_FORBIDDEN','PROCESSING_INGRESS_FORBIDDEN','PROCESSING_INGRESS_CONFLICT'].includes(error?.message);
          try{if(await this.#worker.fail(claim,{retryable,errorCode:internal.aborted?'DISPATCH_CANCELLED':retryable?'DISPATCH_RETRY':'DISPATCH_REJECTED'})!==true)throw failure('UNVERIFIED');}catch{this.#uncertain=true;throw failure('OUTCOME_UNKNOWN');}
          throw failure('UNVERIFIED');
        }
      }
      return Object.freeze({ok:true,scanned:delivered,delivered});
    });
  }
  async probe({signal}={}){
    signalValid(signal);const unhealthy=()=>signal?.aborted||this.#closed||this.#uncertain||[...this.#pending].some(p=>p.controller.signal.aborted);
    if(this.#probePending||unhealthy())return Object.freeze({ok:false,code:'GRAPH_INBOX_UNVERIFIED'});
    const task=Promise.resolve().then(async()=>{
      try{const values=await Promise.all([this.#producer.probe({signal}),this.#worker.probe({signal}),this.#reader.probe({signal}),this.#probeGraph(Object.freeze({signal}))]);const ok=!unhealthy()&&values.every(v=>v?.ok===true);return Object.freeze({ok,code:ok?'GRAPH_INBOX_VERIFIED':'GRAPH_INBOX_UNVERIFIED'});}catch{return Object.freeze({ok:false,code:'GRAPH_INBOX_UNVERIFIED'});}
    });this.#probePending=task;
    try{return await task;}finally{if(this.#probePending===task)this.#probePending=null;}
  }
  resume(){if(this.#pending.size||this.#uncertain)throw failure('UNVERIFIED');this.#closed=false;}
  async stop({timeoutMs=5000}={}){
    integer(timeoutMs,10,60000);this.#closed=true;for(const p of this.#pending)p.controller.abort();let timer;
    const settled=await Promise.race([Promise.allSettled([...this.#pending].map(p=>p.task).concat(this.#probePending?[this.#probePending]:[])).then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);clearTimeout(timer);
    return Object.freeze({drained:settled&&!this.#pending.size&&!this.#uncertain&&!this.#probePending,inFlight:this.#pending.size});
  }
}
export const isManagedGraphWebhookIntake=value=>registered.has(value);
