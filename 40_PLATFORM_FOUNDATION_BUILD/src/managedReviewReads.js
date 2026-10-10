import crypto from 'node:crypto';
import {isPostgresReviewReader,reviewReadInput} from './postgresReviewReader.js';
import {isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {isProductionReadiness,boundedReadinessStatus} from './productionAdmission.js';
const registered=new WeakSet(),fail=()=>new Error('MANAGED_REVIEW_READ_UNAVAILABLE');
export const isManagedReviewReads=v=>registered.has(v);
export class ManagedReviewReads {
  #reader;#drain;#ready;#audit;#provider;#timeout;#capacity;#pending=new Set();#probe=null;#closed=false;#uncertain=false;
  constructor({reader,drain,readiness,audit,probeRead,timeoutMs=10000,maxPending=16}={}){
    if(!isPostgresReviewReader(reader)||!isManagedDeploymentDrain(drain)||!isProductionReadiness(readiness)||typeof audit!=='function'||typeof probeRead!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isInteger(maxPending)||maxPending<1||maxPending>100)throw new Error('MANAGED_REVIEW_READ_CONFIGURATION_INVALID');
    this.#reader=Object.freeze(Object.fromEntries(['list','get','probe'].map(k=>[k,reader[k].bind(reader)])));this.#drain=drain;this.#ready=readiness;this.#audit=audit;this.#provider=probeRead;this.#timeout=timeoutMs;this.#capacity=maxPending;registered.add(this);Object.freeze(this);
  }
  status(){return Object.freeze({inFlight:this.#pending.size,uncertain:this.#uncertain,acceptingNew:!this.#closed&&!this.#uncertain&&this.#pending.size<this.#capacity});}
  list(value,options){return this.#read(reviewReadInput(value),false,options);}
  get(value,options){return this.#read(reviewReadInput(value,true),true,options);}
  #check(signal){if(signal?.aborted||this.#closed||this.#uncertain)throw fail();}
  #read(r,detail,{signal}={}){
    if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw new Error('REVIEW_READ_INPUT_INVALID');
    this.#check(signal);if(!this.status().acceptingNew)throw fail();const controller=new AbortController(),entry={controller};this.#pending.add(entry);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,this.#timeout);
    const task=Promise.resolve().then(async()=>{let lease,output,error;const internal=controller.signal,traceId=`review-read:${crypto.randomUUID()}`;
      try{this.#check(internal);if(await boundedReadinessStatus(this.#ready,1500)!=='READY')throw fail();
        try{lease=await this.#drain.acquire({kind:'INGRESS',operationId:traceId});}catch{this.#uncertain=true;throw fail();}this.#check(internal);
        const binding=Object.freeze({tenantId:r.tenantId,actorId:r.actorId,eventId:detail?r.eventId:null,operation:detail?'REVIEW_DETAIL':'REVIEW_LIST',traceId,signal:internal});
        await this.#audit(Object.freeze({...binding,phase:'ATTEMPT'}));this.#check(internal);
        output=await this.#reader[detail?'get':'list'](r,{signal:internal,beforeRelease:async prepared=>{this.#check(internal);await this.#audit(Object.freeze({...binding,phase:'PREPARED',itemCount:prepared.itemCount}));this.#check(internal);}});this.#check(internal);
      }catch(e){error=e;}finally{if(lease)try{await this.#drain.release(lease);}catch{this.#uncertain=true;error=fail();}}
      if(error)throw error;this.#check(internal);return output;
    });entry.task=task;task.finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.#pending.delete(entry);}).catch(()=>{});return task;
  }
  async probe({signal}={}){
    const unhealthy=()=>signal?.aborted||this.#closed||this.#uncertain||[...this.#pending].some(p=>p.controller.signal.aborted);
    if(this.#probe||unhealthy())return Object.freeze({ok:false,code:'REVIEW_READ_UNVERIFIED'});
    const task=Promise.resolve().then(async()=>{const results=await Promise.allSettled([()=>this.#reader.probe({signal}),()=>this.#provider(Object.freeze({signal}))].map(run=>Promise.resolve().then(run)));const ok=!unhealthy()&&results.every(r=>r.status==='fulfilled'&&r.value?.ok===true);return Object.freeze({ok,code:ok?'REVIEW_READ_VERIFIED':'REVIEW_READ_UNVERIFIED'});});this.#probe=task;
    try{return await task;}finally{if(this.#probe===task)this.#probe=null;}
  }
  resume(){if(this.#pending.size||this.#probe||this.#uncertain)throw fail();this.#closed=false;}
  async stop({timeoutMs=5000}={}){if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw fail();this.#closed=true;for(const p of this.#pending)p.controller.abort();let timer;
    const settled=await Promise.race([Promise.allSettled([...this.#pending].map(p=>p.task).concat(this.#probe?[this.#probe]:[])).then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),timeoutMs);})]);clearTimeout(timer);return Object.freeze({drained:settled&&!this.#pending.size&&!this.#probe&&!this.#uncertain,inFlight:this.#pending.size});}
}
