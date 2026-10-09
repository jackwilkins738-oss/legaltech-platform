import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HEX=/^[a-f0-9]{64}$/;
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
function shape(value,keys){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length)throw new Error('CANARY_FIXTURE_INVALID');
  const d=Object.getOwnPropertyDescriptors(value);if(keys.some(k=>!Object.hasOwn(d[k]??{},'value')))throw new Error('CANARY_FIXTURE_INVALID');return Object.freeze(Object.fromEntries(keys.map(k=>[k,d[k].value])));
}
function validateSignal(signal){if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal?.addEventListener!=='function'||typeof signal?.removeEventListener!=='function'))throw new Error('PROCESSING_CANARY_INPUT_INVALID');}
export class ProcessingCanary {
  #pipeline;#adopt;#fixture;#authorize;#scope;#timeout;#poll;#age;#now;#lastClock=-Infinity;#success=null;#binding=null;#task=null;#controller=null;#closed=false;
  constructor({pipeline,resultAdopter,tenantId,actorId,serviceActorId,createFixture,authorizeCanary,timeoutMs=10000,pollIntervalMs=100,maxAgeMs=30000,now=()=>performance.now()}={}){
    if(typeof pipeline?.handlers?.registerInbound!=='function'||typeof pipeline?.status!=='function'||typeof resultAdopter?.adopt!=='function'||typeof createFixture!=='function'||typeof authorizeCanary!=='function'
      ||[tenantId,actorId,serviceActorId].some(v=>typeof v!=='string'||!UUID.test(v))||!integer(timeoutMs,100,60000)||!integer(pollIntervalMs,10,1000)||!integer(maxAgeMs,1000,60000)||typeof now!=='function')throw new Error('PROCESSING_CANARY_CONFIGURATION_INVALID');
    this.#pipeline=Object.freeze({registerInbound:pipeline.handlers.registerInbound.bind(pipeline.handlers),status:pipeline.status.bind(pipeline)});this.#adopt=resultAdopter.adopt.bind(resultAdopter);
    this.#scope=Object.freeze({tenantId:tenantId.toLowerCase(),actorId:actorId.toLowerCase(),serviceActorId:serviceActorId.toLowerCase()});this.#fixture=createFixture;this.#authorize=authorizeCanary;this.#timeout=timeoutMs;this.#poll=pollIntervalMs;this.#age=maxAgeMs;this.#now=now;
  }
  #time(){const at=this.#now();if(!Number.isFinite(at)||at<this.#lastClock){this.#success=null;throw new Error('CANARY_CLOCK_INVALID');}this.#lastClock=at;return at;}
  #running(){const state=this.#pipeline.status();return [state.relay,state.worker].every(s=>s?.state==='RUNNING'&&s.errorCode===null);}
  async #gate(phase,signal){if(signal?.aborted||await this.#authorize(Object.freeze({...this.#scope,...this.#binding,phase,signal}))!==true||signal?.aborted)throw new Error('CANARY_FORBIDDEN');}
  run({signal}={}){
    validateSignal(signal);if(this.#closed)throw new Error('PROCESSING_CANARY_STOPPED');if(this.#task)throw new Error('PROCESSING_CANARY_BUSY');this.#success=null;this.#binding=null;
    // Store admission before invoking any user callback, including reentrant ones.
    const controller=new AbortController();this.#controller=controller;
    const task=Promise.resolve().then(()=>this.#run(signal,controller));this.#task=task;task.finally(()=>{if(this.#task===task)this.#task=null;}).catch(()=>{});return task;
  }
  async #run(parent,controller){
    const abort=()=>controller.abort();let timer;
    const check=()=>{this.#time();if(controller.signal.aborted||!this.#running())throw new Error('CANARY_ABORTED');};
    try{
      if(parent?.aborted)controller.abort();parent?.addEventListener('abort',abort,{once:true});timer=setTimeout(abort,this.#timeout);check();await this.#gate('RUN',controller.signal);check();
      const commandId=crypto.randomUUID(),jobId=crypto.randomUUID(),eventId=crypto.randomUUID();
      const fixture=shape(await this.#fixture(Object.freeze({...this.#scope,commandId,jobId,eventId,signal:controller.signal})),['confirmedSynthetic','payloadId','payloadHash','expectedResultCode','expectedResultHash']);check();
      if(fixture.confirmedSynthetic!==true||typeof fixture.payloadId!=='string'||!UUID.test(fixture.payloadId)||!HEX.test(fixture.payloadHash??'')||!HEX.test(fixture.expectedResultHash??'')
        ||typeof fixture.expectedResultCode!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(fixture.expectedResultCode))throw new Error('CANARY_FIXTURE_INVALID');
      this.#binding=Object.freeze({payloadId:fixture.payloadId.toLowerCase(),payloadHash:fixture.payloadHash});await this.#gate('SUBMIT',controller.signal);check();
      const submitted=await this.#pipeline.registerInbound({tenantId:this.#scope.tenantId,actorId:this.#scope.actorId,commandId,jobId,eventId,...this.#binding,
        sourceSystem:'MANUAL_UPLOAD',externalEventId:`canary:${jobId}`,traceId:`canary:${jobId}`,signal:controller.signal});check();
      if(submitted?.tenantId!==this.#scope.tenantId||submitted.jobId!==jobId||submitted.commandId!==commandId||submitted.objectId!==eventId||submitted.status!=='ACCEPTED'||submitted.replayed!==false)throw new Error('CANARY_RECEIPT_INVALID');
      while(true){
        check();const result=await this.#adopt({tenantId:this.#scope.tenantId,serviceActorId:this.#scope.serviceActorId,jobId,signal:controller.signal});check();
        if(result?.status==='PENDING'&&result.jobId===jobId){
          await new Promise(resolve=>{if(controller.signal.aborted)return resolve();const done=()=>{clearTimeout(wait);controller.signal.removeEventListener('abort',done);resolve();};const wait=setTimeout(done,this.#poll);controller.signal.addEventListener('abort',done,{once:true});});continue;
        }
        if(result?.status!=='APPLIED'||result.tenantId!==this.#scope.tenantId||result.jobId!==jobId||result.commandId!==commandId||result.objectId!==eventId||result.kind!=='PROCESS_INBOUND'
          ||result.artifactHash!==fixture.payloadHash||result.resultCode!==fixture.expectedResultCode||result.resultHash!==fixture.expectedResultHash)throw new Error('CANARY_RESULT_INVALID');
        await this.#gate('COMPLETE',controller.signal);check();this.#success=this.#time();return Object.freeze({ok:true,code:'PROCESSING_CANARY_VERIFIED'});
      }
    }catch{this.#success=null;return Object.freeze({ok:false,code:'PROCESSING_CANARY_UNVERIFIED'});}
    finally{controller.abort();clearTimeout(timer);parent?.removeEventListener('abort',abort);if(this.#controller===controller)this.#controller=null;}
  }
  resume(){if(this.#task)throw new Error('PROCESSING_CANARY_BUSY');this.#closed=false;this.#success=null;}
  async stop({timeoutMs=5000}={}){
    if(!integer(timeoutMs,10,60000))throw new Error('PROCESSING_CANARY_INPUT_INVALID');
    this.#closed=true;this.#success=null;this.#controller?.abort();const task=this.#task;if(!task)return Object.freeze({drained:true});
    let timer;const settled=await Promise.race([task.then(()=>true,()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);clearTimeout(timer);return Object.freeze({drained:settled});
  }
  async probe({signal}={}){
    try{validateSignal(signal);if(this.#closed||this.#task||this.#success===null||this.#time()-this.#success>this.#age||!this.#running())throw new Error('CANARY_UNREADY');await this.#gate('PROBE',signal);
      if(this.#closed||this.#task||this.#success===null||this.#time()-this.#success>this.#age||!this.#running())throw new Error('CANARY_UNREADY');return Object.freeze({ok:true,code:'PROCESSING_CANARY_VERIFIED'});
    }catch{return Object.freeze({ok:false,code:'PROCESSING_CANARY_UNVERIFIED'});}
  }
}
