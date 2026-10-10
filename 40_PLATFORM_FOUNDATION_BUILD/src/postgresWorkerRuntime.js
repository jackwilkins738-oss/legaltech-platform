import crypto from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HEX=/^[a-f0-9]{64}$/,CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
const kinds=new Set(['PROCESS_INBOUND','POLICY_EVALUATION']);
const retries=new Set(['PAYLOAD_DEPENDENCY_UNAVAILABLE','POLICY_DEPENDENCY_UNAVAILABLE','PROCESSOR_DEPENDENCY_UNAVAILABLE']);
export class WorkerRetryableError extends Error {
  constructor(code){if(!retries.has(code))throw new Error('WORKER_RETRY_CODE_INVALID');super(code);this.name='WorkerRetryableError';}
}
function integer(v,min,max){if(!Number.isInteger(v)||v<min||v>max)throw new Error('WORKER_RUNTIME_CONFIGURATION_INVALID');return v;}
function snapshotArtifact(value,{tenantId,id,hash,state,maxBytes}){
  const fail=()=>{throw new Error('WORKER_ARTIFACT_INVALID');};
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==5)fail();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(['tenantId','id','hash','state','bytes'].some(k=>!Object.hasOwn(descriptors[k]??{},'value')))fail();
  const v=Object.fromEntries(Object.entries(descriptors).map(([k,d])=>[k,d.value]));
  if(v.tenantId!==tenantId||v.id!==id||v.hash!==hash||v.state!==state||(!Buffer.isBuffer(v.bytes)&&!(v.bytes instanceof Uint8Array))||v.bytes.byteLength<1||v.bytes.byteLength>maxBytes)fail();
  const bytes=Buffer.from(v.bytes);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash){bytes.fill(0);fail();}return bytes;
}
function output(value){
  if(value&&Object.values(Object.getOwnPropertyDescriptors(value)).some(d=>!Object.hasOwn(d,'value')))throw new Error('WORKER_PROCESSOR_RESULT_INVALID');
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==2||Reflect.ownKeys(value).some(k=>!['resultCode','resultHash'].includes(k))
    ||typeof value.resultCode!=='string'||!CODE.test(value.resultCode)||typeof value.resultHash!=='string'||!HEX.test(value.resultHash))throw new Error('WORKER_PROCESSOR_RESULT_INVALID');
  return Object.freeze({resultCode:value.resultCode,resultHash:value.resultHash});
}
export class PostgresWorkerRuntime {
  #queue;#domain;#authorize;#loadPayload;#loadPolicy;#inbound;#policy;#timeout;#heartbeat;#payloadLimit;#policyLimit;#busy=false;
  constructor({jobWorker,domainLoader,authorizeExecution,loadPayload,loadPolicy,processInbound,evaluatePolicy,
    executionTimeoutMs=60000,heartbeatIntervalMs=1000,maxPayloadBytes=15*1024*1024,maxPolicyBytes=1024*1024}={}) {
    if(['claimNext','assertCurrent','renew','completeWithResult','fail','recoverExpired'].some(k=>typeof jobWorker?.[k]!=='function')||typeof domainLoader?.load!=='function'
      ||[authorizeExecution,loadPayload,loadPolicy,processInbound,evaluatePolicy].some(f=>typeof f!=='function'))throw new Error('WORKER_RUNTIME_CONFIGURATION_INVALID');
    this.#queue=Object.freeze(Object.fromEntries(['claimNext','assertCurrent','renew','completeWithResult','fail','recoverExpired'].map(k=>[k,jobWorker[k].bind(jobWorker)])));
    this.#domain=Object.freeze({load:domainLoader.load.bind(domainLoader)});this.#authorize=authorizeExecution;this.#loadPayload=loadPayload;this.#loadPolicy=loadPolicy;this.#inbound=processInbound;this.#policy=evaluatePolicy;
    this.#timeout=integer(executionTimeoutMs,100,3600000);this.#heartbeat=integer(heartbeatIntervalMs,100,10000);
    this.#payloadLimit=integer(maxPayloadBytes,1,15*1024*1024);this.#policyLimit=integer(maxPolicyBytes,1,1024*1024);
  }
  async recoverExpired({tenantId,kind,limit=25,signal}={}) {
    if(!kinds.has(kind))throw new Error('WORKER_RUNTIME_INPUT_INVALID');
    if(this.#busy)throw new Error('WORKER_RUNTIME_BUSY');
    this.#busy=true;try{return await this.#queue.recoverExpired({tenantId,kind,limit,signal});}finally{this.#busy=false;}
  }
  async processNext({tenantId,serviceActorId,kind,signal}={}) {
    if(typeof tenantId!=='string'||!UUID.test(tenantId)||typeof serviceActorId!=='string'||!UUID.test(serviceActorId)||!kinds.has(kind))throw new Error('WORKER_RUNTIME_INPUT_INVALID');
    if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal?.addEventListener!=='function'||typeof signal?.removeEventListener!=='function'))throw new Error('WORKER_RUNTIME_INPUT_INVALID');
    if(this.#busy)throw new Error('WORKER_RUNTIME_BUSY');this.#busy=true;
    tenantId=tenantId.toLowerCase();serviceActorId=serviceActorId.toLowerCase();
    const controller=new AbortController(),abort=()=>controller.abort();
    let claim,command,bytes,processorBytes,heartbeatTimer,timer,heartbeatPending=Promise.resolve(),heartbeatActive=false,checkpointActive=true,checkpoints=new Set(),fault=null,completionStarted=false;
    const stopHeartbeat=async()=>{heartbeatActive=false;clearTimeout(heartbeatTimer);await heartbeatPending;};
    const check=()=>{if(controller.signal.aborted)throw new Error(fault??'WORKER_EXECUTION_ABORTED');};
    const authorize=async phase=>{
      check();let allowed;
      try{allowed=await this.#authorize(Object.freeze({...command,serviceActorId,workerId:claim.workerId,attempt:claim.attempt,phase,signal:controller.signal}));}catch{throw new Error('WORKER_EXECUTION_AUTHORIZATION_UNAVAILABLE');}
      check();if(allowed!==true)throw new Error('WORKER_EXECUTION_FORBIDDEN');
    };
    const checkpoint=phase=>{
      const task=(async()=>{
        if(!checkpointActive)throw new Error('WORKER_CHECKPOINT_CLOSED');
        try{
          check();if(await this.#queue.assertCurrent(claim,{signal:controller.signal})!==true)throw new Error('WORKER_CLAIM_LOST');check();
          const current=await this.#domain.load(claim,{serviceActorId,signal:controller.signal});check();
          if(current.requestHash!==command.requestHash||current.intentHash!==command.intentHash||current.commandId!==command.commandId)throw new Error('WORKER_DOMAIN_BINDING_INVALID');
          await authorize(phase);check();
        }catch(error){fault=typeof error?.message==='string'?error.message:'WORKER_CHECKPOINT_FAILED';throw error;}
      })();checkpoints.add(task);task.finally(()=>checkpoints.delete(task)).catch(()=>{});return task;
    };
    const heartbeat=()=>{
      heartbeatTimer=setTimeout(()=>{
        heartbeatPending=(async()=>{
          if(!heartbeatActive||controller.signal.aborted)return;
          try{if(await this.#queue.renew(claim,{signal:controller.signal})!==true)throw new Error('lost');}
          catch{fault='WORKER_CLAIM_LOST';controller.abort();}
          if(heartbeatActive&&!controller.signal.aborted)heartbeat();
        })();heartbeatPending.catch(()=>{});
      },this.#heartbeat);
    };
    try{
      if(signal?.aborted)controller.abort();signal?.addEventListener('abort',abort,{once:true});check();
      timer=setTimeout(()=>{fault='WORKER_EXECUTION_TIMEOUT';controller.abort();},this.#timeout);
      claim=await this.#queue.claimNext({tenantId,kind,signal:controller.signal});check();if(claim===null)return null;
      if(!claim||claim.tenantId!==tenantId||claim.kind!==kind||!UUID.test(claim.jobId??'')||!UUID.test(claim.objectId??'')||!UUID.test(claim.workerId??'')||!HEX.test(claim.requestHash??'')||!HEX.test(claim.traceHash??'')
        ||!Number.isInteger(claim.attempt)||claim.attempt<1||claim.attempt>10||!Number.isInteger(claim.leaseMs)||claim.leaseMs<5000||claim.leaseMs>300000
        ||!Number.isInteger(claim.maxRunMs)||claim.maxRunMs<claim.leaseMs||claim.maxRunMs>3600000||this.#timeout>claim.maxRunMs||this.#heartbeat*3>claim.leaseMs)throw new Error('WORKER_CLAIM_BINDING_INVALID');
      heartbeatActive=true;heartbeat();
      command=await this.#domain.load(claim,{serviceActorId,signal:controller.signal});check();
      if(command.tenantId!==tenantId||command.jobId!==claim.jobId||command.kind!==kind||command.objectId!==claim.objectId||command.traceHash!==claim.traceHash||command.intentHash!==claim.requestHash)throw new Error('WORKER_DOMAIN_BINDING_INVALID');
      await authorize('LOAD_ARTIFACT');
      const id=kind==='PROCESS_INBOUND'?command.payloadId:command.policyVersionId,hash=kind==='PROCESS_INBOUND'?command.payloadHash:command.policyVersionHash;
      if(typeof id!=='string'||!UUID.test(id)||typeof hash!=='string'||!HEX.test(hash)||typeof command.commandId!=='string'||!UUID.test(command.commandId)||!HEX.test(command.requestHash??''))throw new Error('WORKER_DOMAIN_BINDING_INVALID');
      const artifact=kind==='PROCESS_INBOUND'?await this.#loadPayload(Object.freeze({tenantId,payloadId:id,payloadHash:hash,signal:controller.signal}))
        :await this.#loadPolicy(Object.freeze({tenantId,policyVersionId:id,policyVersionHash:hash,signal:controller.signal}));
      check();bytes=snapshotArtifact(artifact,{tenantId,id,hash,state:kind==='PROCESS_INBOUND'?'PROCESSING_ALLOWED':'PUBLISHED',maxBytes:kind==='PROCESS_INBOUND'?this.#payloadLimit:this.#policyLimit});
      await checkpoint('EXECUTE');check();processorBytes=Buffer.from(bytes);
      const processed=await (kind==='PROCESS_INBOUND'?this.#inbound:this.#policy)(Object.freeze({command,artifact:Object.freeze({tenantId,id,hash,bytes:processorBytes}),idempotencyKey:command.commandId,
        checkpoint:()=>checkpoint('CHECKPOINT'),signal:controller.signal}));
      check();if(checkpoints.size!==0||fault)throw new Error(fault??'WORKER_CHECKPOINT_PENDING');const result=output(processed);
      await stopHeartbeat();check();await checkpoint('COMMIT_RESULT');check();checkpointActive=false;
      completionStarted=true;
      const saved=await this.#queue.completeWithResult(claim,{commandId:command.commandId,commandHash:command.requestHash,artifactHash:hash,...result},{signal:controller.signal});
      if(saved===false)return Object.freeze({jobId:claim.jobId,status:'STALE',errorCode:'WORKER_CLAIM_LOST'});
      if(!saved||saved.tenantId!==tenantId||saved.jobId!==claim.jobId||saved.kind!==kind||saved.objectId!==claim.objectId||saved.commandId!==command.commandId||saved.commandHash!==command.requestHash||saved.artifactHash!==hash
        ||saved.resultHash!==result.resultHash||saved.resultCode!==result.resultCode||saved.attempt!==claim.attempt||saved.workerId!==claim.workerId)throw new Error('WORKER_RESULT_BINDING_INVALID');
      return Object.freeze({jobId:claim.jobId,status:'SUCCEEDED',resultCode:saved.resultCode,resultHash:saved.resultHash});
    }catch(error){
      await stopHeartbeat();checkpointActive=false;
      // Wait for escaped checkpoint work before settling or releasing admission.
      if(checkpoints.size){controller.abort();await Promise.allSettled([...checkpoints]);}
      if(completionStarted)return Object.freeze({jobId:claim?.jobId??null,status:'OUTCOME_UNKNOWN',errorCode:'WORKER_COMPLETION_OUTCOME_UNKNOWN'});
      if(!claim)throw new Error('WORKER_CLAIM_UNAVAILABLE');
      if(controller.signal.aborted||fault==='WORKER_CLAIM_LOST')return Object.freeze({jobId:claim.jobId,status:'ABORTED',errorCode:fault==='WORKER_EXECUTION_TIMEOUT'?'WORKER_EXECUTION_TIMEOUT':fault==='WORKER_CLAIM_LOST'?'WORKER_CLAIM_LOST':'WORKER_EXECUTION_ABORTED'});
      const retryable=error instanceof WorkerRetryableError;
      const errorCode=retryable?error.message:/FORBIDDEN|AUTHORIZATION/.test(error?.message??'')?'WORKER_AUTHORIZATION_DENIED':/ARTIFACT/.test(error?.message??'')?'WORKER_ARTIFACT_INVALID':/BINDING/.test(error?.message??'')?'WORKER_BINDING_INVALID':'WORKER_PROCESSING_FAILED';
      try{if(await this.#queue.fail(claim,{errorCode,retryable,signal:controller.signal})!==true)return Object.freeze({jobId:claim.jobId,status:'STALE',errorCode:'WORKER_CLAIM_LOST'});}
      catch{return Object.freeze({jobId:claim.jobId,status:'OUTCOME_UNKNOWN',errorCode:'WORKER_FAILURE_OUTCOME_UNKNOWN'});}
      return Object.freeze({jobId:claim.jobId,status:'FAILED',errorCode,retryRequested:retryable});
    }finally{
      checkpointActive=false;controller.abort();await Promise.allSettled([...checkpoints]);await stopHeartbeat();clearTimeout(timer);signal?.removeEventListener('abort',abort);bytes?.fill(0);processorBytes?.fill(0);this.#busy=false;
    }
  }
}
