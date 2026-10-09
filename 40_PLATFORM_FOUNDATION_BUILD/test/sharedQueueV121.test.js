// Mandatory security concept: V121 shared queue regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresJobProducer,PostgresJobWorker,PostgresJobReader,createPostgresQueueBoundary} from '../src/postgresJobs.js';

const tenantId='12100000-0000-4000-8000-000000000001',jobId='12100000-0000-4000-8000-000000000011',objectId='12100000-0000-4000-8000-000000000021',workerId='12100000-0000-4000-8000-000000000031';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),at='2026-10-09T13:00:00.000Z';
const input=()=>({tenantId,jobId,objectId,kind:'PROCESS_INBOUND',traceId:'opaque-trace',idempotencyKey:'opaque-dedupe'});
const row=()=>({tenant_id:tenantId,job_id:jobId,object_id:objectId,kind:'PROCESS_INBOUND',trace_hash:sha('opaque-trace'),status:'QUEUED',attempts:0,worker_id:null,lease_token_hash:null,lease_until:null,run_until:null,available_at:at,created_at:at,last_error_code:null,result_code:null});
function driver({member=true,grants=true,role='runtime',privileged=false,owns_schema=false,outside_access=false,trigger=true,candidate=true,changed=1,completed=false,failCommit=false,mutateClaim=null,prior=[],data=null}={}) {
  const calls=[],releases=[],stored=[];
  const pool={connect:async()=>({query:async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:role,login_role:role,tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes('AS member,'))return {rows:[{member,privileged,owns_schema,outside_access}]};
    if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:grants}]};
    if(sql.includes('FROM pg_trigger'))return {rows:trigger?[{tgenabled:'O'}]:[]};
    if(sql.startsWith('SELECT c.relname'))return {rows:values[0].map(relname=>({relname,enabled:true,forced:true,active:true}))};
    if(sql==='COMMIT'&&failCommit)throw new Error('SECRET_DATABASE_DETAILS');
    if(data){const result=await data(sql,values);if(result)return result;}
    if(sql.startsWith('SELECT * FROM queue_security.jobs')&&sql.includes(' OR '))return {rows:prior};
    if(sql.includes('INSERT INTO queue_security.jobs')){
      const created={...row(),tenant_id:values[0],job_id:values[1],kind:values[2],object_id:values[3],trace_hash:values[4],key_hash:values[5],request_hash:values[6],max_attempts:values[7],lease_ms:values[8],max_run_ms:values[9],initial_delay_ms:values[10],retry_delay_ms:values[11]};stored.push(created);return {rows:[created]};
    }
    if(sql.startsWith('SELECT job_id,object_id'))return {rows:candidate?[{job_id:jobId,object_id:objectId}]:[]};
    if(sql.includes("SET status='RUNNING'")){
      let claimed={...row(),status:'RUNNING',attempts:1,worker_id:values[3],lease_token_hash:values[4],lease_until:'2026-10-09T13:01:00.000Z',run_until:'2026-10-09T13:15:00.000Z'};
      if(mutateClaim)claimed=mutateClaim(claimed);return {rows:[claimed]};
    }
    if(sql.includes('UPDATE queue_security.jobs')){
      if(sql.includes("last_error_code='WORKER_LEASE_EXPIRED'"))return {rows:[{...row(),attempts:1,last_error_code:'WORKER_LEASE_EXPIRED'}]};
      return {rows:Array.from({length:changed},()=>({job_id:jobId}))};
    }
    if(sql.startsWith('SELECT job_id FROM queue_security.jobs'))return {rows:sql.includes("status='SUCCEEDED'")?(completed?[{job_id:jobId}]:[]):(changed?[{job_id:jobId}]:[])};
    if(sql.startsWith('SELECT * FROM queue_security.jobs'))return {rows:[{...row(),lease_token_hash:'f'.repeat(64)}]};
    return {rows:[]};
  },release:destroy=>releases.push(destroy)})};return {pool,calls,releases,stored};
}
const options=x=>({pool:x.pool,expectedRole:'runtime',timeoutMs:100});
const producer=(x,authorizeEnqueue=async()=>true)=>new PostgresJobProducer({...options(x),authorizeEnqueue});
const worker=(x,authorizeWorker=async()=>true)=>new PostgresJobWorker({...options(x),workerId,authorizeWorker});
const reader=(x,authorizeRead=async()=>true)=>new PostgresJobReader({...options(x),authorizeRead});
const claim=()=>({tenantId,jobId,objectId,kind:'PROCESS_INBOUND',attempt:1,workerId,token:crypto.randomBytes(32).toString('base64url')});

test('V121 enqueue commits before receipt and persists hashes/references without arbitrary content',async()=>{
  const x=driver(),result=await producer(x).enqueue(input());assert.equal(result.status,'QUEUED');assert.equal(result.replayed,false);assert.deepEqual(x.releases,[false]);
  const insert=x.calls.find(x=>x.sql.includes('INSERT INTO queue_security.jobs'));assert.equal(JSON.stringify(insert).includes('opaque-trace'),false);assert.equal(JSON.stringify(insert).includes('opaque-dedupe'),false);assert.equal(result.token,undefined);
});
test('V121 enqueue rejects payloads, invalid UUIDs and unbounded lease/retry policy before checkout',async()=>{
  for(const change of [{payload:{email:'sensitive'}},{objectId:'bad'},{kind:'TYPO'},{maxAttempts:11},{leaseMs:4999},{maxRunMs:1000},{retryDelayMs:0},{delayMs:86400001}]){
    const x=driver();await assert.rejects(producer(x).enqueue({...input(),...change}),/INPUT_INVALID/);assert.equal(x.calls.length,0);
  }
});
test('V121 asynchronous enqueue denial and authorisation failure never persist a job',async()=>{
  for(const authority of [async()=>false,async()=>{throw new Error('SECRET_DIRECTORY')}]){const x=driver();await assert.rejects(producer(x,authority).enqueue(input()),/FORBIDDEN|AUTHORIZATION_UNAVAILABLE/);assert.equal(x.stored.length,0);assert.deepEqual(x.releases,[true]);}
});
test('V121 enqueue replay binds identical immutable policy and rejects metadata/key conflicts',async()=>{
  const original=driver();await producer(original).enqueue(input());const prior=original.stored[0];
  const x=driver({prior:[prior]});assert.equal((await producer(x).enqueue(input())).replayed,true);assert.equal(x.stored.length,0);
  for(const change of [{objectId:'12100000-0000-4000-8000-000000000022'},{maxAttempts:2},{traceId:'different'}])await assert.rejects(producer(driver({prior:[prior]})).enqueue({...input(),...change}),/ENQUEUE_CONFLICT/);
});
test('V121 uncertain enqueue commit is distinguished and cannot return an optimistic receipt',async()=>{
  const x=driver({failCommit:true});await assert.rejects(producer(x).enqueue(input()),e=>e.message==='QUEUE_ENQUEUE_OUTCOME_UNKNOWN');assert.deepEqual(x.releases,[true]);
});
test('V121 unsafe role, widened grant or disabled trigger denies queue operations',async()=>{
  for(const bad of [{member:false},{grants:false},{role:'owner'},{privileged:true},{owns_schema:true},{outside_access:true},{trigger:false}]){
    const x=driver(bad);await assert.rejects(worker(x).claimNext({tenantId,kind:'PROCESS_INBOUND'}),/UNAVAILABLE/);assert.equal(x.calls.some(x=>x.sql.includes("SET status='RUNNING'")),false);
  }
});
test('V121 claim checks current tenant/kind and selected object authorisation before allocating a token',async()=>{
  const seen=[],x=driver();const result=await worker(x,async context=>{seen.push(context);return true}).claimNext({tenantId,kind:'PROCESS_INBOUND'});
  assert.equal(seen.length,2);assert.equal(seen[0].jobId,null);assert.equal(seen[1].jobId,jobId);assert.equal(seen[1].objectId,objectId);assert.equal(seen[1].workerId,workerId);
  assert.match(result.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(JSON.stringify(x.calls).includes(result.token),false);assert.deepEqual(x.releases,[false]);
});
test('V121 selected job denial cannot be bypassed by a broad queue claim authorisation',async()=>{
  const x=driver();await assert.rejects(worker(x,async context=>context.jobId===null).claimNext({tenantId,kind:'PROCESS_INBOUND'}),/FORBIDDEN/);assert.equal(x.calls.some(x=>x.sql.includes("SET status='RUNNING'")),false);
});
test('V121 an empty due queue returns null after commit and never exposes an uncommitted token',async()=>{
  const x=driver({candidate:false});assert.equal(await worker(x).claimNext({tenantId,kind:'PROCESS_INBOUND'}),null);assert.ok(x.calls.some(x=>x.sql==='COMMIT'));
});
test('V121 returned claim must match tenant, object, worker and token digest',async()=>{
  for(const change of [{tenant_id:'12100000-0000-4000-8000-000000000002'},{object_id:'12100000-0000-4000-8000-000000000022'},{worker_id:'12100000-0000-4000-8000-000000000032'},{lease_token_hash:'f'.repeat(64)}]){
    const x=driver({mutateClaim:row=>({...row,...change})});await assert.rejects(worker(x).claimNext({tenantId,kind:'PROCESS_INBOUND'}),/UNAVAILABLE/);
  }
});
test('V121 uncertain claim commit provides no executable credential',async()=>{
  const x=driver({failCommit:true});await assert.rejects(worker(x).claimNext({tenantId,kind:'PROCESS_INBOUND'}),/CLAIM_OUTCOME_UNKNOWN/);assert.deepEqual(x.releases,[true]);
});
test('V121 renewal/completion use job, tenant, kind, fence, authenticated worker and token digest',async()=>{
  const x=driver(),w=worker(x),claimed=claim();assert.equal(await w.renew(claimed),true);assert.equal(await w.complete(claimed),true);
  const mutations=x.calls.filter(x=>x.sql.includes('UPDATE queue_security.jobs'));
  for(const mutation of mutations){assert.deepEqual(mutation.values.slice(0,6),[tenantId,jobId,'PROCESS_INBOUND',1,workerId,sha(claimed.token)]);assert.equal(mutation.sql.includes('j.lease_until>m.stamp'),true);}
});
test('V121 stale or recovered claims cannot renew, complete, fail or pass an execution checkpoint',async()=>{
  const x=driver({changed:0}),w=worker(x),old=claim();assert.equal(await w.renew(old),false);assert.equal(await w.complete(old),false);assert.equal(await w.fail(old,{errorCode:'FAILED',retryable:true}),false);await assert.rejects(w.assertCurrent(old),/UNAVAILABLE/);
});
test('V121 a different worker identity or malformed token/fence is refused before checkout',async()=>{
  const x=driver(),w=worker(x);for(const change of [{workerId:'12100000-0000-4000-8000-000000000032'},{token:'short'},{attempt:0},{attempt:11},{tenantId:'bad'}])await assert.rejects(w.renew({...claim(),...change}),/INPUT_INVALID/);assert.equal(x.calls.length,0);
});
test('V121 current-authority withdrawal blocks settlement even with a valid claim',async()=>{
  const x=driver();await assert.rejects(worker(x,async()=>false).complete(claim()),/FORBIDDEN/);assert.equal(x.calls.some(x=>x.sql.includes('UPDATE queue_security.jobs')),false);
});
test('V121 identical successful completion replays while a different result cannot claim success',async()=>{
  assert.equal(await worker(driver({changed:0,completed:true})).complete(claim()),true);
  assert.equal(await worker(driver({changed:0,completed:false})).complete(claim(),{resultCode:'DIFFERENT'}),false);
});
test('V121 settlement commit uncertainty never reports completion or retries',async()=>{
  const x=driver({failCommit:true});await assert.rejects(worker(x).complete(claim()),e=>e.message==='QUEUE_SETTLEMENT_OUTCOME_UNKNOWN');assert.deepEqual(x.releases,[true]);
});
test('V121 failure rejects free-text errors and nonboolean retry decisions',async()=>{
  const x=driver();await assert.rejects(worker(x).fail(claim(),{errorCode:'document text'}),/INPUT_INVALID/);await assert.rejects(worker(x).fail(claim(),{errorCode:'FAILED',retryable:'yes'}),/INPUT_INVALID/);assert.equal(x.calls.length,0);
});
test('V121 failure policy includes reconciliation for external effects and bounded exponential backoff',async()=>{
  const x=driver();await worker(x).fail({...claim(),kind:'PROCLAIM_WRITEBACK'},{errorCode:'OUTCOME_UNKNOWN',retryable:true});
  const mutation=x.calls.find(x=>x.sql.includes('UPDATE queue_security.jobs'));assert.match(mutation.sql,/THEN 'RECONCILE'/);assert.match(mutation.sql,/j.attempts<j.max_attempts/);assert.match(mutation.sql,/LEAST\(3600000/);assert.equal(mutation.values[2],'PROCLAIM_WRITEBACK');
});
test('V121 expiry recovery is bounded, tenant-specific and reauthorises each selected object',async()=>{
  const x=driver(),seen=[];const recovered=await worker(x,async context=>{seen.push(context);return true}).recoverExpired({tenantId,kind:'PROCESS_INBOUND',limit:2});
  assert.equal(recovered.length,1);assert.equal(seen[1].objectId,objectId);const selected=x.calls.find(x=>x.sql.startsWith('SELECT job_id,object_id'));assert.deepEqual(selected.values,[tenantId,'PROCESS_INBOUND',2]);
  assert.equal(Object.hasOwn(recovered[0],'token'),false);
});
test('V121 recovery limits and job denial fail closed without changing other jobs',async()=>{
  const x=driver();await assert.rejects(worker(x).recoverExpired({tenantId,kind:'PROCESS_INBOUND',limit:101}),/INPUT_INVALID/);
  await assert.rejects(worker(x,async context=>context.jobId===null).recoverExpired({tenantId,kind:'PROCESS_INBOUND'}),/FORBIDDEN/);assert.equal(x.calls.some(x=>x.sql.includes('UPDATE queue_security.jobs')),false);
});
test('V121 authenticated reader is tenant-bound and exposes neither token nor its digest',async()=>{
  const x=driver(),result=await reader(x).get({tenantId,jobId});assert.equal(result.jobId,jobId);assert.equal(result.token,undefined);assert.equal(result.leaseTokenHash,undefined);
  assert.deepEqual(x.calls.find(x=>x.sql.startsWith('SELECT *')).values,[tenantId,jobId]);
  await assert.rejects(reader(x,async()=>false).get({tenantId,jobId}),/FORBIDDEN/);
});
test('V121 a stalled current-authority lookup times out and discards its connection',async()=>{
  const x=driver();await assert.rejects(worker(x,async()=>new Promise(()=>{})).claimNext({tenantId,kind:'PROCESS_INBOUND'}),/UNAVAILABLE/);assert.deepEqual(x.releases,[true]);
});
test('V121 production queue factory binds the actual producer and worker posture probes',async()=>{
  const x=driver(),boundary=createPostgresQueueBoundary({producerPool:x.pool,expectedProducerRole:'runtime',workerPool:x.pool,expectedWorkerRole:'runtime',workerId,authorizeEnqueue:async()=>true,authorizeWorker:async()=>true});assert.equal((await boundary.queueProbe()).ok,true);assert.equal(Object.isFrozen(boundary),true);
  assert.throws(()=>new PostgresJobProducer(options(x)),/CONFIGURATION_INVALID/);assert.throws(()=>new PostgresJobWorker({...options(x),workerId}),/CONFIGURATION_INVALID/);
});
test('V121 posture probes fail closed when the transition trigger is missing',async()=>{
  const x=driver({trigger:false});await assert.rejects(producer(x).probe(),/UNAVAILABLE/);await assert.rejects(worker(x).probe(),/UNAVAILABLE/);
});
test('V121 mismatched returned tenant or job cannot acknowledge read or settlement',async()=>{
  const x=driver({data:async sql=>sql.startsWith('SELECT * FROM queue_security.jobs')?{rows:[{...row(),tenant_id:'12100000-0000-4000-8000-000000000002'}]}:sql.includes('UPDATE queue_security.jobs')?{rows:[{job_id:'12100000-0000-4000-8000-000000000012'}]}:null});
  await assert.rejects(reader(x).get({tenantId,jobId}),/UNAVAILABLE/);await assert.rejects(worker(x).complete(claim()),/UNAVAILABLE/);
});
