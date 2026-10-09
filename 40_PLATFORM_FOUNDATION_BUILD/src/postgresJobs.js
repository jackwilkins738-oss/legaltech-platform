import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';
import {securityOptions,securityTransaction,securityProbe} from './postgresSecurityBoundary.js';
import {prepareJobIntent,validateJobIntent} from './jobIntent.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HEX=/^[a-f0-9]{64}$/;
const KINDS=new Set(['PROCESS_INBOUND','POLICY_EVALUATION','PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY']);
const CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
const producer='legaltech_queue_producer',worker='legaltech_queue_worker',reader='legaltech_queue_reader';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const unavailable=()=>new Error('QUEUE_STORE_UNAVAILABLE');
function uuid(v){if(typeof v!=='string'||!UUID.test(v))throw new Error('QUEUE_INPUT_INVALID');return v.toLowerCase();}
function kind(v){if(!KINDS.has(v))throw new Error('QUEUE_INPUT_INVALID');return v;}
function integer(v,min,max){if(!Number.isInteger(v)||v<min||v>max)throw new Error('QUEUE_INPUT_INVALID');return v;}
function code(v){if(typeof v!=='string'||!CODE.test(v))throw new Error('QUEUE_INPUT_INVALID');return v;}
const date=v=>v===null?null:new Date(v).toISOString();
function view(row){
  if(!row||!UUID.test(row.tenant_id)||!UUID.test(row.job_id)||!UUID.test(row.object_id)||!KINDS.has(row.kind)
    ||!['QUEUED','RUNNING','SUCCEEDED','DEAD','RECONCILE'].includes(row.status)||!Number.isInteger(row.attempts)||row.attempts<0||row.attempts>10||!HEX.test(row.trace_hash))throw unavailable();
  return Object.freeze({tenantId:row.tenant_id,jobId:row.job_id,kind:row.kind,objectId:row.object_id,traceHash:row.trace_hash,status:row.status,
    attempt:row.attempts,workerId:row.worker_id,leaseUntil:date(row.lease_until),runUntil:date(row.run_until),availableAt:date(row.available_at),createdAt:date(row.created_at),lastErrorCode:row.last_error_code,resultCode:row.result_code});
}
async function trigger(tx){
  const found=await tx.query(`SELECT t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='queue_security' AND c.relname='jobs' AND t.tgname='protect_shared_job_transition' AND NOT t.tgisinternal`);
  if(found.rows.length!==1||!['O','A'].includes(found.rows[0].tgenabled))throw unavailable();
}
async function run(options,group,authorize,binding,work,{signal,readOnly=false}={}) {
  let denied;
  try{return await securityTransaction(options,group,async tx=>{
    await trigger(tx);
    const check=async extra=>{
      let ok=false;try{ok=await authorize(Object.freeze({...binding,...extra,signal:tx.signal}))===true;}catch{denied=new Error('QUEUE_AUTHORIZATION_UNAVAILABLE');throw denied;}
      if(!ok){denied=new Error('QUEUE_FORBIDDEN');throw denied;}
    };
    await check({});return work(tx,check);
  },{signal,readOnly});}catch(error){if(error.message==='POSTGRES_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('QUEUE_TRANSACTION_OUTCOME_UNKNOWN');throw denied??unavailable();}
}
const backoff="LEAST(3600000::bigint,j.retry_delay_ms::bigint*(1::bigint << (j.attempts-1))) * interval '1 millisecond'";
function sameEnqueue(row,base,requestHash){return row.tenant_id===base.tenantId&&row.job_id===base.jobId&&row.kind===base.kind&&row.object_id===base.objectId
  &&row.trace_hash===base.traceHash&&row.key_hash===base.keyHash&&row.request_hash===requestHash&&row.max_attempts===base.maxAttempts
  &&row.lease_ms===base.leaseMs&&row.max_run_ms===base.maxRunMs&&row.initial_delay_ms===base.delayMs&&row.retry_delay_ms===base.retryDelayMs;}

export class PostgresJobProducer {
  #options;#authorize;
  constructor({authorizeEnqueue,...options}={}){if(typeof authorizeEnqueue!=='function')throw new Error('SHARED_QUEUE_CONFIGURATION_INVALID');this.#options=securityOptions(options);this.#authorize=authorizeEnqueue;}
  async enqueue(input,{signal}={}) {
    return this.enqueueIntent(prepareJobIntent(input),{signal});
  }
  async enqueueIntent(input,{signal}={}) {
    const base=validateJobIntent(input);
    const {tenantId,jobId,kind:type,objectId,leaseMs,maxRunMs}=base;
    const requestHash=sha(canonicalAuditPayload(base));let conflict=false;
    try{return await run(this.#options,producer,this.#authorize,{...base,operation:'ENQUEUE'},async tx=>{
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['queue-enqueue-v121',tenantId])]);
      const prior=await tx.query('SELECT * FROM queue_security.jobs WHERE tenant_id=$1::uuid AND (job_id=$2::uuid OR (kind=$3 AND key_hash=$4))',[tenantId,jobId,type,base.keyHash]);
      if(prior.rows.length){
        if(prior.rows.length!==1||!sameEnqueue(prior.rows[0],base,requestHash)){conflict=true;throw unavailable();}
        return Object.freeze({...view(prior.rows[0]),replayed:true});
      }
      const result=await tx.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp)
        INSERT INTO queue_security.jobs(tenant_id,job_id,kind,object_id,trace_hash,key_hash,request_hash,max_attempts,lease_ms,max_run_ms,initial_delay_ms,retry_delay_ms,status,attempts,available_at,created_at,updated_at)
        SELECT $1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,'QUEUED',0,stamp+($11::integer*interval '1 millisecond'),stamp,stamp FROM moment RETURNING *`,
        [tenantId,jobId,type,objectId,base.traceHash,base.keyHash,requestHash,base.maxAttempts,leaseMs,maxRunMs,base.delayMs,base.retryDelayMs]);
      if(result.rows.length!==1||!sameEnqueue(result.rows[0],base,requestHash)||result.rows[0].status!=='QUEUED'||result.rows[0].attempts!==0)throw unavailable();return Object.freeze({...view(result.rows[0]),replayed:false});
    },{signal});}catch(error){if(error.message==='QUEUE_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('QUEUE_ENQUEUE_OUTCOME_UNKNOWN');throw conflict?new Error('QUEUE_ENQUEUE_CONFLICT'):error;}
  }
  async probe(){try{await securityProbe(this.#options,producer);return await securityTransaction(this.#options,producer,async tx=>{await trigger(tx);return Object.freeze({ok:true});},{readOnly:true});}catch{throw unavailable();}}
}

export class PostgresJobWorker {
  #options;#authorize;#workerId;
  constructor({authorizeWorker,workerId,...options}={}){if(typeof authorizeWorker!=='function')throw new Error('SHARED_QUEUE_CONFIGURATION_INVALID');this.#workerId=uuid(workerId);this.#options=securityOptions(options);this.#authorize=authorizeWorker;}
  #binding(claim,operation){
    if(!claim||typeof claim!=='object')throw new Error('QUEUE_INPUT_INVALID');
    const tenantId=uuid(claim.tenantId),jobId=uuid(claim.jobId),type=kind(claim.kind),attempt=integer(claim.attempt,1,10);
    if(uuid(claim.workerId)!==this.#workerId||typeof claim.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(claim.token)||Buffer.from(claim.token,'base64url').length!==32||Buffer.from(claim.token,'base64url').toString('base64url')!==claim.token)throw new Error('QUEUE_INPUT_INVALID');
    return {tenantId,jobId,kind:type,attempt,workerId:this.#workerId,operation,tokenHash:sha(claim.token)};
  }
  async claimNext({tenantId,kind:type,signal}={}) {
    tenantId=uuid(tenantId);type=kind(type);const token=crypto.randomBytes(32).toString('base64url'),tokenHash=sha(token);
    try{return await run(this.#options,worker,this.#authorize,{tenantId,kind:type,workerId:this.#workerId,jobId:null,operation:'CLAIM'},async(tx,check)=>{
      const selected=await tx.query(`SELECT job_id,object_id FROM queue_security.jobs WHERE tenant_id=$1::uuid AND kind=$2 AND status='QUEUED'
        AND attempts<max_attempts AND available_at<=clock_timestamp() ORDER BY available_at,created_at,job_id LIMIT 1 FOR UPDATE SKIP LOCKED`,[tenantId,type]);
      if(selected.rows.length===0)return null;if(selected.rows.length!==1)throw unavailable();const jobId=uuid(selected.rows[0].job_id),objectId=uuid(selected.rows[0].object_id);
      await check({jobId,objectId});
      const result=await tx.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp)
        UPDATE queue_security.jobs j SET status='RUNNING',attempts=j.attempts+1,worker_id=$4::uuid,lease_token_hash=$5,
          started_at=m.stamp,lease_until=m.stamp+(j.lease_ms*interval '1 millisecond'),run_until=m.stamp+(j.max_run_ms*interval '1 millisecond'),
          last_error_code=NULL,result_code=NULL,updated_at=m.stamp FROM moment m
        WHERE j.tenant_id=$1::uuid AND j.job_id=$2::uuid AND j.kind=$3 AND j.status='QUEUED' AND j.attempts<j.max_attempts AND j.available_at<=m.stamp RETURNING j.*`,[tenantId,jobId,type,this.#workerId,tokenHash]);
      if(result.rows.length!==1||result.rows[0].lease_token_hash!==tokenHash||result.rows[0].worker_id!==this.#workerId
        ||result.rows[0].tenant_id!==tenantId||result.rows[0].job_id!==jobId||result.rows[0].kind!==type||result.rows[0].object_id!==objectId||result.rows[0].status!=='RUNNING'||result.rows[0].attempts<1)throw unavailable();
      return Object.freeze({...view(result.rows[0]),token});
    },{signal});}catch(error){if(error.message==='QUEUE_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('QUEUE_CLAIM_OUTCOME_UNKNOWN');throw error;}
  }
  async assertCurrent(claim,{signal}={}) {
    const b=this.#binding(claim,'ASSERT_CURRENT');
    return run(this.#options,worker,this.#authorize,b,async tx=>{
      const result=await tx.query(`SELECT job_id FROM queue_security.jobs WHERE tenant_id=$1::uuid AND job_id=$2::uuid AND kind=$3 AND attempts=$4
        AND worker_id=$5::uuid AND lease_token_hash=$6 AND status='RUNNING' AND lease_until>clock_timestamp()
        AND started_at<=clock_timestamp() AND updated_at<=clock_timestamp()`,[b.tenantId,b.jobId,b.kind,b.attempt,b.workerId,b.tokenHash]);
      if(result.rows.length!==1||result.rows[0].job_id!==b.jobId)throw unavailable();return true;
    },{readOnly:true,signal});
  }
  async #settle(claim,operation,{errorCode=null,resultCode=null,retryable=false,signal}={}) {
    const b=this.#binding(claim,operation);
    if(operation==='FAIL')code(errorCode);else if(operation==='COMPLETE')code(resultCode);
    if(typeof retryable!=='boolean')throw new Error('QUEUE_INPUT_INVALID');
    const args=[b.tenantId,b.jobId,b.kind,b.attempt,b.workerId,b.tokenHash];
    try{return await run(this.#options,worker,this.#authorize,b,async tx=>{
      let sql,values;
      if(operation==='RENEW'){
        sql=`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp)
          UPDATE queue_security.jobs j SET lease_until=LEAST(m.stamp+(j.lease_ms*interval '1 millisecond'),j.run_until),updated_at=m.stamp FROM moment m
          WHERE j.tenant_id=$1::uuid AND j.job_id=$2::uuid AND j.kind=$3 AND j.attempts=$4 AND j.worker_id=$5::uuid AND j.lease_token_hash=$6
          AND j.status='RUNNING' AND j.lease_until>m.stamp AND j.run_until>m.stamp RETURNING j.job_id`;values=args;
      }else if(operation==='COMPLETE'){
        sql=`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp)
          UPDATE queue_security.jobs j SET status='SUCCEEDED',lease_until=NULL,run_until=NULL,result_code=$7,last_error_code=NULL,updated_at=m.stamp FROM moment m
          WHERE j.tenant_id=$1::uuid AND j.job_id=$2::uuid AND j.kind=$3 AND j.attempts=$4 AND j.worker_id=$5::uuid AND j.lease_token_hash=$6
          AND j.status='RUNNING' AND j.lease_until>m.stamp RETURNING j.job_id`;values=[...args,resultCode];
      }else{
        sql=`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp)
          UPDATE queue_security.jobs j SET status=CASE WHEN j.kind IN ('PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY') THEN 'RECONCILE' WHEN $7::boolean AND j.attempts<j.max_attempts THEN 'QUEUED' ELSE 'DEAD' END,
            worker_id=NULL,lease_token_hash=NULL,lease_until=NULL,run_until=NULL,started_at=NULL,result_code=NULL,last_error_code=$8,
            available_at=m.stamp+(${backoff}),updated_at=m.stamp FROM moment m
          WHERE j.tenant_id=$1::uuid AND j.job_id=$2::uuid AND j.kind=$3 AND j.attempts=$4 AND j.worker_id=$5::uuid AND j.lease_token_hash=$6
          AND j.status='RUNNING' AND j.lease_until>m.stamp RETURNING j.job_id`;values=[...args,retryable,errorCode];
      }
      const changed=await tx.query(sql,values);if(changed.rows.length>1||changed.rows.some(x=>x.job_id!==b.jobId))throw unavailable();if(changed.rows.length===1)return true;
      if(operation==='COMPLETE'){
        const replay=await tx.query(`SELECT job_id FROM queue_security.jobs WHERE tenant_id=$1::uuid AND job_id=$2::uuid AND kind=$3 AND attempts=$4
          AND worker_id=$5::uuid AND lease_token_hash=$6 AND status='SUCCEEDED' AND result_code=$7`,[...args,resultCode]);return replay.rows.length===1&&replay.rows[0].job_id===b.jobId;
      }
      return false;
    },{signal});}catch(error){if(error.message==='QUEUE_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('QUEUE_SETTLEMENT_OUTCOME_UNKNOWN');throw error;}
  }
  renew(claim,options={}){return this.#settle(claim,'RENEW',options);}
  complete(claim,{resultCode='COMPLETED',signal}={}){return this.#settle(claim,'COMPLETE',{resultCode,signal});}
  fail(claim,options={}){return this.#settle(claim,'FAIL',options);}
  async recoverExpired({tenantId,kind:type,limit=25,signal}={}) {
    tenantId=uuid(tenantId);type=kind(type);integer(limit,1,100);
    return run(this.#options,worker,this.#authorize,{tenantId,kind:type,workerId:this.#workerId,jobId:null,operation:'RECOVER'},async(tx,check)=>{
      const selected=await tx.query(`SELECT job_id,object_id FROM queue_security.jobs WHERE tenant_id=$1::uuid AND kind=$2 AND status='RUNNING'
        AND lease_until<=clock_timestamp() ORDER BY lease_until,job_id LIMIT $3 FOR UPDATE SKIP LOCKED`,[tenantId,type,limit]);
      if(selected.rows.length>limit||new Set(selected.rows.map(x=>x.job_id)).size!==selected.rows.length)throw unavailable();
      const recovered=[];
      for(const row of selected.rows){
        const jobId=uuid(row.job_id);await check({jobId,objectId:uuid(row.object_id)});
        const changed=await tx.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp)
          UPDATE queue_security.jobs j SET status=CASE WHEN j.kind IN ('PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY') THEN 'RECONCILE' WHEN j.attempts<j.max_attempts THEN 'QUEUED' ELSE 'DEAD' END,
            worker_id=NULL,lease_token_hash=NULL,lease_until=NULL,run_until=NULL,started_at=NULL,result_code=NULL,last_error_code='WORKER_LEASE_EXPIRED',
            available_at=m.stamp+(${backoff}),updated_at=m.stamp FROM moment m
          WHERE j.tenant_id=$1::uuid AND j.job_id=$2::uuid AND j.kind=$3 AND j.status='RUNNING' AND j.lease_until<=m.stamp RETURNING j.*`,[tenantId,jobId,type]);
        if(changed.rows.length!==1||changed.rows[0].tenant_id!==tenantId||changed.rows[0].job_id!==jobId||changed.rows[0].kind!==type)throw unavailable();recovered.push(view(changed.rows[0]));
      }
      return Object.freeze(recovered);
    },{signal});
  }
  async probe(){try{await securityProbe(this.#options,worker);return await securityTransaction(this.#options,worker,async tx=>{await trigger(tx);return Object.freeze({ok:true});},{readOnly:true});}catch{throw unavailable();}}
}

export class PostgresJobReader {
  #options;#authorize;
  constructor({authorizeRead,...options}={}){if(typeof authorizeRead!=='function')throw new Error('SHARED_QUEUE_CONFIGURATION_INVALID');this.#options=securityOptions(options);this.#authorize=authorizeRead;}
  async get({tenantId,jobId,signal}={}) {
    tenantId=uuid(tenantId);jobId=uuid(jobId);
    return run(this.#options,reader,this.#authorize,{tenantId,jobId,operation:'READ'},async tx=>{
      const result=await tx.query('SELECT * FROM queue_security.jobs WHERE tenant_id=$1::uuid AND job_id=$2::uuid',[tenantId,jobId]);
      if(result.rows.length>1||result.rows.length===1&&(result.rows[0].tenant_id!==tenantId||result.rows[0].job_id!==jobId))throw unavailable();return result.rows.length?view(result.rows[0]):null;
    },{readOnly:true,signal});
  }
}

export function createPostgresQueueBoundary({producerPool,expectedProducerRole,workerPool,expectedWorkerRole,workerId,authorizeEnqueue,authorizeWorker,timeoutMs=5000}={}) {
  const jobProducer=new PostgresJobProducer({pool:producerPool,expectedRole:expectedProducerRole,authorizeEnqueue,timeoutMs});
  const jobWorker=new PostgresJobWorker({pool:workerPool,expectedRole:expectedWorkerRole,workerId,authorizeWorker,timeoutMs});
  return Object.freeze({jobProducer,jobWorker,queueProbe:async()=>{await jobProducer.probe();return jobWorker.probe();}});
}
