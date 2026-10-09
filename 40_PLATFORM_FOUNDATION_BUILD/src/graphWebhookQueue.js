import crypto from 'node:crypto';

const SAFE=/^[A-Za-z0-9._:/-]{1,256}$/;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function id(v,code,max=256){if(typeof v!=='string'||!v||v.length>max||!SAFE.test(v))throw new Error(code);return v;}
function plain(v){return v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;}
function clone(v){try{return structuredClone(v);}catch{throw new Error('GRAPH_WEBHOOK_QUEUE_PAYLOAD_INVALID');}}

/** Ephemeral reference queue. Production must replace this with an isolated managed queue. */
export class GraphWebhookValidationQueue {
  #ingress;#dispatch;#now;#leaseMs;#maxAttempts;#maxPending;#maxItems;#maxBytes;#jobs=new Map();#events=[];
  constructor({ingress,dispatch,now=()=>Date.now(),leaseMs=60000,maxAttempts=3,maxPending=10000,maxItems=100,maxBytes=256*1024}={}){
    if(!ingress||typeof ingress.receive!=='function'||typeof ingress.validate!=='function'||typeof dispatch!=='function'||typeof now!=='function')throw new Error('GRAPH_WEBHOOK_QUEUE_CONFIGURATION_INVALID');
    if(!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>15*60*1000||!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10||!Number.isInteger(maxPending)||maxPending<1||maxPending>100000||!Number.isInteger(maxItems)||maxItems<1||maxItems>1000||!Number.isInteger(maxBytes)||maxBytes<1024||maxBytes>1024*1024)throw new Error('GRAPH_WEBHOOK_QUEUE_CONFIGURATION_INVALID');
    this.#ingress=ingress;this.#dispatch=dispatch;this.#now=now;this.#leaseMs=leaseMs;this.#maxAttempts=maxAttempts;this.#maxPending=maxPending;this.#maxItems=maxItems;this.#maxBytes=maxBytes;
  }
  #time(){const n=this.#now();if(!Number.isSafeInteger(n)||n<0||n>8.64e15-this.#leaseMs)throw new Error('GRAPH_WEBHOOK_QUEUE_CLOCK_INVALID');return n;}
  #event(job,event,extra={}){const row=Object.freeze({intakeId:job.id,payloadHash:job.payloadHash,event,attempts:job.attempts,at:new Date(this.#time()).toISOString(),...extra});this.#events.push(row);return row;}
  receive(payload,{traceId}={}){
    traceId=id(traceId,'GRAPH_WEBHOOK_QUEUE_TRACE_INVALID');if(!plain(payload)||!Array.isArray(payload.value)||payload.value.length<1||payload.value.length>this.#maxItems)throw new Error('GRAPH_WEBHOOK_QUEUE_PAYLOAD_INVALID');let serialized;try{serialized=JSON.stringify(payload);}catch{throw new Error('GRAPH_WEBHOOK_QUEUE_PAYLOAD_INVALID');}if(Buffer.byteLength(serialized)>this.#maxBytes)throw new Error('GRAPH_WEBHOOK_QUEUE_PAYLOAD_TOO_LARGE');
    const pending=[...this.#jobs.values()].filter(j=>['QUEUED','RUNNING'].includes(j.status)).length;if(pending>=this.#maxPending)throw new Error('GRAPH_WEBHOOK_QUEUE_FULL');const now=this.#time(),job={id:`gwq_${crypto.randomUUID()}`,status:'QUEUED',attempts:0,payload:clone(payload),payloadHash:sha(serialized),traceId,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),leaseAt:null,errorCode:null,validatedCount:0,dispatchCount:0,duplicateCount:0};this.#jobs.set(job.id,job);this.#event(job,'RECEIVED');return Object.freeze({status:202,intakeId:job.id});
  }
  recoverExpired(){const now=this.#time(),before=now-this.#leaseMs;let changed=0;for(const job of this.#jobs.values()){if(job.status!=='RUNNING'||Date.parse(job.leaseAt)>before)continue;job.status=job.attempts>=this.#maxAttempts?'DEAD':'QUEUED';job.updatedAt=new Date(now).toISOString();job.errorCode='GRAPH_WEBHOOK_QUEUE_LEASE_EXPIRED';job.leaseAt=null;if(job.status==='DEAD')job.payload=null;this.#event(job,job.status==='DEAD'?'DEAD':'LEASE_RECOVERED',{errorCode:job.errorCode});changed++;}return changed;}
  #claim(idValue=null){this.recoverExpired();const now=this.#time();let job;if(idValue!==null){idValue=id(idValue,'GRAPH_WEBHOOK_QUEUE_INTAKE_INVALID');job=this.#jobs.get(idValue);}else job=[...this.#jobs.values()].filter(j=>j.status==='QUEUED').sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];if(!job||job.status!=='QUEUED')return null;job.status='RUNNING';job.attempts+=1;job.leaseAt=new Date(now).toISOString();job.updatedAt=job.leaseAt;this.#event(job,'CLAIMED');return job;}
  async processNext({intakeId=null}={}){const job=this.#claim(intakeId);if(!job)return null;try{
      const staged=this.#ingress.receive(job.payload,{traceId:job.traceId});const accepted=await this.#ingress.validate(staged.intakeId);let dispatched=0,duplicates=0;
      for(const notification of accepted){if(notification.duplicate)duplicates++;await this.#dispatch(Object.freeze({...notification,traceId:job.traceId}));dispatched++;}
      job.validatedCount=accepted.length;job.dispatchCount=dispatched;job.duplicateCount=duplicates;job.status='DONE';job.updatedAt=new Date(this.#time()).toISOString();job.leaseAt=null;job.payload=null;job.errorCode=null;this.#event(job,'DONE',{validatedCount:accepted.length,dispatchCount:dispatched,duplicateCount:duplicates});return Object.freeze(this.#view(job));
    }catch(error){const retryable=['GRAPH_WEBHOOK_DEPENDENCY_UNAVAILABLE','GRAPH_WEBHOOK_DISPATCH_FAILED'].includes(error?.message);job.errorCode=retryable?error.message:'GRAPH_WEBHOOK_VALIDATION_REJECTED';job.status=retryable&&job.attempts<this.#maxAttempts?'QUEUED':'DEAD';job.updatedAt=new Date(this.#time()).toISOString();job.leaseAt=null;if(job.status==='DEAD')job.payload=null;this.#event(job,job.status==='DEAD'?'DEAD':'RETRY',{errorCode:job.errorCode});return Object.freeze(this.#view(job));}
  }
  get(intakeId){intakeId=id(intakeId,'GRAPH_WEBHOOK_QUEUE_INTAKE_INVALID');const job=this.#jobs.get(intakeId);return job?Object.freeze(this.#view(job)):null;}
  snapshot(){return Object.freeze([...this.#jobs.values()].map(j=>Object.freeze(this.#view(j))).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)));}
  events(){return Object.freeze(this.#events.map(e=>Object.freeze({...e})));}
  #view(j){return {id:j.id,status:j.status,attempts:j.attempts,payloadHash:j.payloadHash,traceId:j.traceId,createdAt:j.createdAt,updatedAt:j.updatedAt,leaseAt:j.leaseAt,errorCode:j.errorCode,validatedCount:j.validatedCount,dispatchCount:j.dispatchCount,duplicateCount:j.duplicateCount};}
}

export function idempotentGraphDispatch(handler){
  if(typeof handler!=='function')throw new Error('GRAPH_WEBHOOK_DISPATCH_CONFIGURATION_INVALID');const completed=new Set();
  return async notification=>{if(!plain(notification)||typeof notification.notificationFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(notification.notificationFingerprint))throw new Error('GRAPH_WEBHOOK_DISPATCH_INVALID');if(completed.has(notification.notificationFingerprint))return Object.freeze({duplicate:true});try{await handler(notification);}catch{throw new Error('GRAPH_WEBHOOK_DISPATCH_FAILED');}completed.add(notification.notificationFingerprint);return Object.freeze({duplicate:false});};
}
