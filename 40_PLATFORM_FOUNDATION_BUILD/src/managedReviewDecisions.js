import crypto from 'node:crypto';
import {isPostgresReviewDecisions,normalizeReviewDecision,decisionKeyHash,writebackJobId} from './postgresReviewDecisions.js';
import {isManagedDeploymentDrain} from './managedDeploymentDrain.js';
import {isProductionReadiness,boundedReadinessStatus} from './productionAdmission.js';

const registered=new WeakSet(),fail=code=>new Error(`MANAGED_REVIEW_${code}`);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const keys=['tenantId','actorId','eventId','decision','matterId','decisionKey','expectedResultJobId','expectedResultHash'];
function signalValid(signal){if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw fail('INPUT_INVALID');}
function request(value){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value')))throw fail('INPUT_INVALID');
  try{const normalized=normalizeReviewDecision({...value,traceId:'review:v133'});const traceId=`review:${decisionKeyHash(normalized.tenantId,normalized.decisionKey)}`;
    if(keys.filter(k=>k.endsWith('Id')&&k!=='matterId').some(k=>!UUID.test(value[k]))||value.decision==='APPROVE'&&!UUID.test(value.matterId)||value.decision==='REJECT'&&value.matterId!==null)throw fail('INPUT_INVALID');return Object.freeze({...normalized,traceId});
  }catch{throw fail('INPUT_INVALID');}
}
function receipt(value,r){
  const names=['tenantId','eventId','decision','matterId','resultJobId','resultHash','writebackJobId','status','replayed'];
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==names.length||names.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value'))
    ||['tenantId','eventId','decision','matterId'].some(k=>value[k]!==r[k])||value.resultJobId!==r.expectedResultJobId||value.resultHash!==r.expectedResultHash||value.status!=='DECIDED'||typeof value.replayed!=='boolean'
    ||r.decision==='APPROVE'&&value.writebackJobId!==writebackJobId(r.tenantId,r.eventId)||r.decision==='REJECT'&&value.writebackJobId!==null)throw fail('OUTCOME_UNKNOWN');
  return Object.freeze({...value});
}
export const isManagedReviewDecisions=value=>registered.has(value);

// The browser supplies only the exact result it reviewed. Actor/tenant come from
// the verified session; provider evidence and authorization stay server-owned.
export class ManagedReviewDecisions {
  #reviews;#readiness;#drain;#authorize;#audit;#probeProvider;#timeout;#capacity;#pending=new Set();#probe=null;#closed=false;#uncertain=false;
  constructor({reviews,readiness,drain,authorizeReview,audit,probeReview,timeoutMs=10000,maxPending=16}={}){
    if(!isPostgresReviewDecisions(reviews)||!isProductionReadiness(readiness)||!isManagedDeploymentDrain(drain)||[authorizeReview,audit,probeReview].some(f=>typeof f!=='function')||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000||!Number.isInteger(maxPending)||maxPending<1||maxPending>100)throw fail('CONFIGURATION_INVALID');
    this.#reviews=Object.freeze({decide:reviews.decide.bind(reviews),probe:reviews.probe.bind(reviews)});this.#readiness=readiness;this.#drain=drain;this.#authorize=authorizeReview;this.#audit=audit;this.#probeProvider=probeReview;this.#timeout=timeoutMs;this.#capacity=maxPending;registered.add(this);Object.freeze(this);
  }
  status(){return Object.freeze({inFlight:this.#pending.size,uncertain:this.#uncertain,acceptingNew:!this.#closed&&!this.#uncertain&&this.#pending.size<this.#capacity});}
  #check(signal){if(signal.aborted||this.#closed||this.#uncertain)throw fail('UNAVAILABLE');}
  async #gate(r,phase,signal){this.#check(signal);let allowed;try{allowed=await this.#authorize(Object.freeze({...r,phase,signal}));}catch{throw fail('UNAVAILABLE');}this.#check(signal);if(allowed!==true)throw fail('FORBIDDEN');}
  decide(value,{signal}={}){
    const r=request(value);signalValid(signal);if(signal?.aborted||!this.status().acceptingNew)throw fail('UNAVAILABLE');
    const controller=new AbortController(),entry={controller};this.#pending.add(entry);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timer=setTimeout(abort,this.#timeout);
    const task=Promise.resolve().then(async()=>{
      let lease,output,error,committed=false;
      const internal=controller.signal;const {decisionKey,...auditBinding}=r;
      try{
        this.#check(internal);if(await boundedReadinessStatus(this.#readiness,1500)!=='READY')throw fail('UNAVAILABLE');
        await this.#gate(r,'ADMIT',internal);
        // Local cancellation cannot discard the acquisition acknowledgement.
        try{lease=await this.#drain.acquire({kind:'INGRESS',operationId:`review:${crypto.randomUUID()}`});}catch{this.#uncertain=true;throw fail('OUTCOME_UNKNOWN');}
        this.#check(internal);await this.#audit(Object.freeze({...auditBinding,phase:'ATTEMPT',signal:internal}));await this.#gate(r,'DISPATCH',internal);
        const result=await this.#reviews.decide({...r,signal:internal});committed=true;
        output=receipt(result,r);await this.#audit(Object.freeze({...auditBinding,phase:'ACCEPTED',signal:internal}));this.#check(internal);
      }catch(e){error=e;}
      finally{if(lease)try{await this.#drain.release(lease);}catch{this.#uncertain=true;error=fail('OUTCOME_UNKNOWN');}}
      if(error){if(this.#uncertain)throw fail('OUTCOME_UNKNOWN');if(committed||error.message==='REVIEW_DECISION_COMMIT_OUTCOME_UNKNOWN')throw fail('OUTCOME_UNKNOWN');if(['REVIEW_DECISION_CONFLICT','REVIEW_DECISION_FORBIDDEN','MANAGED_REVIEW_FORBIDDEN'].includes(error.message))throw error;throw fail('UNAVAILABLE');}
      this.#check(internal);return output;
    });entry.task=task;task.finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.#pending.delete(entry);}).catch(()=>{});return task;
  }
  async probe({signal}={}){
    signalValid(signal);const unhealthy=()=>signal?.aborted||this.#closed||this.#uncertain||[...this.#pending].some(p=>p.controller.signal.aborted);
    if(this.#probe||unhealthy())return Object.freeze({ok:false,code:'REVIEW_UNVERIFIED'});
    const task=Promise.resolve().then(async()=>{const results=await Promise.allSettled([()=>this.#reviews.probe({signal}),()=>this.#probeProvider(Object.freeze({signal}))].map(run=>Promise.resolve().then(run)));const ok=!unhealthy()&&results.every(r=>r.status==='fulfilled'&&r.value?.ok===true);return Object.freeze({ok,code:ok?'REVIEW_VERIFIED':'REVIEW_UNVERIFIED'});});this.#probe=task;
    try{return await task;}finally{if(this.#probe===task)this.#probe=null;}
  }
  resume(){if(this.#pending.size||this.#probe||this.#uncertain)throw fail('UNAVAILABLE');this.#closed=false;}
  async stop({timeoutMs=5000}={}){
    if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>60000)throw fail('INPUT_INVALID');this.#closed=true;for(const p of this.#pending)p.controller.abort();let timer;
    const settled=await Promise.race([Promise.allSettled([...this.#pending].map(p=>p.task).concat(this.#probe?[this.#probe]:[])).then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),timeoutMs);})]);clearTimeout(timer);
    return Object.freeze({drained:settled&&!this.#pending.size&&!this.#probe&&!this.#uncertain,inFlight:this.#pending.size});
  }
}
