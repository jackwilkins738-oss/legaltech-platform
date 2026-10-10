// Mandatory security concept: V124 verified worker execution and actual drain.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresWorkerRuntime,WorkerRetryableError} from '../src/postgresWorkerRuntime.js';
import {WorkerSupervisor} from '../src/workerSupervisor.js';
import {createPostgresProcessingPipeline} from '../src/postgresProcessingPipeline.js';
const id=n=>`12400000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=id(1),serviceActorId=id(2),workerId=id(3),jobId=id(4),objectId=id(5),commandId=id(6),payloadId=id(7),policyVersionId=id(8);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),source=Buffer.from('synthetic test artifact'),hash=sha(source);
const claim=()=>({tenantId,workerId,jobId,objectId,kind:'PROCESS_INBOUND',attempt:1,token:'SECRET_CLAIM_TOKEN',requestHash:sha('intent'),traceHash:sha('trace'),leaseMs:5000,maxRunMs:60000,maxAttempts:3});
const command=()=>({tenantId,workerId,jobId,objectId,commandId,actorId:id(9),kind:'PROCESS_INBOUND',intentHash:sha('intent'),requestHash:sha('command'),traceHash:sha('trace'),payloadId,payloadHash:hash,policyVersionId:null,policyVersionHash:null});
const result=()=>({resultCode:'CLASSIFIED',resultHash:sha('output')});
const request={tenantId,serviceActorId,kind:'PROCESS_INBOUND'};
function fixture(options={}){
  const calls=[],artifactBytes=Buffer.from(source);let current=claim(),binding=command();
  const queue={claimNext:async()=>{calls.push('claim');return current;},assertCurrent:async()=>{calls.push('assert');return true;},renew:async()=>{calls.push('renew');return true;},
    completeWithResult:async(c,r)=>{calls.push('complete');return {tenantId:c.tenantId,jobId:c.jobId,kind:c.kind,objectId:c.objectId,...r,attempt:c.attempt,workerId:c.workerId};},
    fail:async(c,o)=>{calls.push({fail:o});return true;},recoverExpired:async o=>{calls.push({recover:o});return [];},...options.queue};
  const domain={load:async()=>{calls.push('load');return binding;},...options.domain};
  const configuration={jobWorker:queue,domainLoader:domain,authorizeExecution:async c=>{calls.push({authorize:c.phase});return true;},
    loadPayload:async()=>({tenantId,id:payloadId,hash,state:'PROCESSING_ALLOWED',bytes:artifactBytes}),loadPolicy:async()=>({tenantId,id:policyVersionId,hash,state:'PUBLISHED',bytes:artifactBytes}),
    processInbound:async()=>result(),evaluatePolicy:async()=>result(),executionTimeoutMs:1000,heartbeatIntervalMs:100,...options.runtime};
  const runtime=new PostgresWorkerRuntime(configuration);
  return {runtime,calls,artifactBytes,configuration,setClaim:v=>{current=v;},setCommand:v=>{binding=v;}};
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<200;i++){if(check())return;await delay(5);}throw new Error('TEST_WAIT_TIMEOUT');}
test('V124 inbound bytes are verified and completion stores only bound result metadata',async()=>{
  let context;const f=fixture({runtime:{processInbound:async c=>{context=c;assert.equal(c.artifact.bytes.toString(),source.toString());assert.equal(JSON.stringify(c).includes('SECRET_CLAIM_TOKEN'),false);await c.checkpoint();return result();}}});
  assert.equal((await f.runtime.processNext(request)).status,'SUCCEEDED');assert.equal(context.idempotencyKey,commandId);assert.ok(context.artifact.bytes.every(b=>b===0));assert.deepEqual(f.artifactBytes,source);
  assert.deepEqual(f.calls.filter(c=>c.authorize).map(c=>c.authorize),['LOAD_ARTIFACT','EXECUTE','CHECKPOINT','COMMIT_RESULT']);assert.equal(f.calls.filter(c=>c==='complete').length,1);
  await assert.rejects(context.checkpoint(),/CHECKPOINT_CLOSED/);
});
test('V124 policy evaluation pins the published version and its actual byte hash',async()=>{
  const f=fixture();f.setClaim({...claim(),kind:'POLICY_EVALUATION'});f.setCommand({...command(),kind:'POLICY_EVALUATION',payloadId:null,payloadHash:null,policyVersionId,policyVersionHash:hash});
  assert.equal((await f.runtime.processNext({...request,kind:'POLICY_EVALUATION'})).status,'SUCCEEDED');
});
test('V124 absent queue is a committed idle result without artifact loading',async()=>{const f=fixture();f.setClaim(null);assert.equal(await f.runtime.processNext(request),null);assert.deepEqual(f.calls,['claim']);});
test('V124 rejects external-effect kinds, malformed scope and signals before claiming',async()=>{
  const f=fixture();for(const change of [{kind:'PROCLAIM_WRITEBACK'},{kind:'NOTIFICATION_DELIVERY'},{tenantId:'bad'},{serviceActorId:'bad'},{signal:{}}])await assert.rejects(f.runtime.processNext({...request,...change}),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
test('V124 incomplete or mismatched claims cannot load bytes or execute processors',async()=>{
  for(const change of [{tenantId:id(99)},{objectId:'bad'},{requestHash:'bad'},{workerId:'bad'},{attempt:11},{maxRunMs:3600001},{leaseMs:4999},{maxRunMs:500}]){
    const f=fixture();f.setClaim({...claim(),...change});assert.equal((await f.runtime.processNext(request)).status,'FAILED');assert.equal(f.calls.includes('load'),false);assert.equal(f.calls.includes('complete'),false);
  }
});
test('V124 a domain binding mismatch denies artifact access before execution',async()=>{
  for(const change of [{jobId:id(99)},{objectId:id(99)},{intentHash:sha('changed')},{traceHash:sha('changed')},{payloadId:'bad'},{payloadHash:'bad'},{commandId:'bad'},{requestHash:'bad'}]){
    const f=fixture();f.setCommand({...command(),...change});assert.equal((await f.runtime.processNext(request)).errorCode,'WORKER_BINDING_INVALID');assert.equal(f.calls.includes('complete'),false);
  }
});
test('V124 current authorization is mandatory at load, execute, checkpoints and commit',async()=>{
  for(const phase of ['LOAD_ARTIFACT','EXECUTE','CHECKPOINT','COMMIT_RESULT']){
    const f=fixture({runtime:{authorizeExecution:async c=>c.phase!==phase,processInbound:async c=>{await c.checkpoint();return result();}}});
    const r=await f.runtime.processNext(request);assert.equal(r.status,'FAILED');assert.equal(r.errorCode,'WORKER_AUTHORIZATION_DENIED');assert.equal(f.calls.includes('complete'),false);
  }
  for(const authorizeExecution of [async()=>1,async()=>{throw 'SECRET_DIRECTORY';}]){const f=fixture({runtime:{authorizeExecution}});assert.equal((await f.runtime.processNext(request)).errorCode,'WORKER_AUTHORIZATION_DENIED');}
});
test('V124 artifact tenant, reference, digest, state and bounded bytes are all verified',async()=>{
  const valid=()=>({tenantId,id:payloadId,hash,state:'PROCESSING_ALLOWED',bytes:Buffer.from(source)});
  for(const change of [{tenantId:id(99)},{id:id(99)},{hash:sha('changed')},{state:'QUARANTINED'},{bytes:Buffer.from('tampered')},{bytes:Buffer.alloc(0)},{bytes:'private string'},{extra:'private'}]){
    const f=fixture({runtime:{loadPayload:async()=>({...valid(),...change})}});assert.equal((await f.runtime.processNext(request)).errorCode,'WORKER_ARTIFACT_INVALID');assert.equal(f.calls.includes('complete'),false);
  }
  const f=fixture({runtime:{maxPayloadBytes:1}});assert.equal((await f.runtime.processNext(request)).errorCode,'WORKER_ARTIFACT_INVALID');
});
test('V124 artifact and processor result accessors are refused without invoking getters',async()=>{
  let reads=0;const artifact={tenantId,id:payloadId,hash,state:'PROCESSING_ALLOWED',get bytes(){reads++;return source;}};
  const f=fixture({runtime:{loadPayload:async()=>artifact}});assert.equal((await f.runtime.processNext(request)).errorCode,'WORKER_ARTIFACT_INVALID');assert.equal(reads,0);
  const g=fixture({runtime:{processInbound:async()=>({get resultCode(){reads++;return 'CLASSIFIED';},resultHash:sha('output')})}});assert.equal((await g.runtime.processNext(request)).status,'FAILED');assert.equal(reads,0);
});
test('V124 processor receives an owned snapshot even if the provider mutates its source',async()=>{
  let f;f=fixture({runtime:{processInbound:async c=>{f.artifactBytes.fill(1);assert.deepEqual(c.artifact.bytes,source);return result();}}});assert.equal((await f.runtime.processNext(request)).status,'SUCCEEDED');
});
test('V124 malformed processor output cannot enter the result ledger',async()=>{
  for(const returned of [null,{resultCode:'private text',resultHash:hash},{resultCode:'OK',resultHash:'bad'},{...result(),rawText:'private'}]){
    const f=fixture({runtime:{processInbound:async()=>returned}});assert.equal((await f.runtime.processNext(request)).status,'FAILED');assert.equal(f.calls.includes('complete'),false);
  }
});
test('V124 only fixed typed dependency failures request bounded retries',async()=>{
  for(const failure of [new WorkerRetryableError('PAYLOAD_DEPENDENCY_UNAVAILABLE'),new Error('SECRET_PAYLOAD'),null,'SECRET_PAYLOAD']){
    const f=fixture({runtime:{loadPayload:async()=>{throw failure;}}});const r=await f.runtime.processNext(request);assert.equal(r.retryRequested,failure instanceof WorkerRetryableError);assert.equal(JSON.stringify(r).includes('SECRET'),false);
  }
  assert.throws(()=>new WorkerRetryableError('arbitrary'),/RETRY_CODE_INVALID/);
});
test('V124 heartbeat renewal is serialized and keeps work admitted until settlement',async()=>{
  let active=0,max=0;const f=fixture({queue:{renew:async()=>{active++;max=Math.max(max,active);await delay(40);active--;return true;}},runtime:{processInbound:async()=>{await delay(320);return result();}}});assert.equal((await f.runtime.processNext(request)).status,'SUCCEEDED');assert.equal(max,1);assert.equal(active,0);
});
test('V124 heartbeat lease loss aborts execution and never completes or retries it',async()=>{
  let bytes;const f=fixture({queue:{renew:async()=>false},runtime:{processInbound:async c=>{bytes=c.artifact.bytes;await delay(160);return result();}}});const r=await f.runtime.processNext(request);assert.equal(r.status,'ABORTED');assert.equal(r.errorCode,'WORKER_CLAIM_LOST');assert.equal(f.calls.includes('complete'),false);assert.equal(f.calls.some(c=>c.fail),false);assert.ok(bytes.every(b=>b===0));
});
test('V124 stale execution checkpoints cannot reach result completion',async()=>{const f=fixture({queue:{assertCurrent:async()=>false}});assert.equal((await f.runtime.processNext(request)).status,'ABORTED');assert.equal(f.calls.includes('complete'),false);});
test('V124 changing the command after artifact loading fails the execution checkpoint',async()=>{
  let reads=0;const f=fixture({domain:{load:async()=>({...command(),requestHash:sha(++reads===1?'command':'changed')})}});assert.equal((await f.runtime.processNext(request)).errorCode,'WORKER_BINDING_INVALID');assert.equal(f.calls.includes('complete'),false);
});
test('V124 timeout waits for an uncooperative processor, wipes bytes and blocks overlapping work',async()=>{
  let finish,entered=false;const f=fixture({runtime:{executionTimeoutMs:100,processInbound:async()=>{entered=true;await new Promise(r=>{finish=r;});return result();}}});const task=f.runtime.processNext(request);await until(()=>entered);await delay(120);
  await assert.rejects(f.runtime.processNext(request),/BUSY/);await assert.rejects(f.runtime.recoverExpired({tenantId,kind:'PROCESS_INBOUND'}),/BUSY/);finish();assert.equal((await task).errorCode,'WORKER_EXECUTION_TIMEOUT');assert.equal(f.calls.includes('complete'),false);
});
test('V124 an abandoned checkpoint stays admitted until its lookup actually settles',async()=>{
  let finish,reads=0,escaped;const f=fixture({domain:{load:async()=>{if(++reads===3)await new Promise(r=>{finish=r;});return command();}},runtime:{processInbound:async c=>{escaped=c.checkpoint();return result();}}});const task=f.runtime.processNext(request);await until(()=>finish);await delay(20);await assert.rejects(f.runtime.processNext(request),/BUSY/);assert.equal(f.calls.includes('complete'),false);finish();await escaped.catch(()=>{});assert.equal((await task).status,'ABORTED');
});
test('V124 a swallowed checkpoint denial still prevents a success receipt',async()=>{
  const f=fixture({runtime:{authorizeExecution:async c=>c.phase!=='CHECKPOINT',processInbound:async c=>{await c.checkpoint().catch(()=>{});return result();}}});assert.equal((await f.runtime.processNext(request)).status,'FAILED');assert.equal(f.calls.includes('complete'),false);
});
test('V124 uncertain completion or bad result receipt never triggers failure/retry',async()=>{
  for(const completeWithResult of [async()=>{throw new Error('SECRET_COMMIT');},async()=>({...result(),tenantId:id(99)}),async()=>({tenantId,jobId,kind:'POLICY_EVALUATION',objectId,commandId,commandHash:command().requestHash,artifactHash:hash,...result(),attempt:1,workerId})]){
    const f=fixture({queue:{completeWithResult}});assert.equal((await f.runtime.processNext(request)).status,'OUTCOME_UNKNOWN');assert.equal(f.calls.some(c=>c.fail),false);
  }
});
test('V124 false completion and uncertain failure are reported without optimistic success',async()=>{
  const f=fixture({queue:{completeWithResult:async()=>false}});assert.equal((await f.runtime.processNext(request)).status,'STALE');
  const g=fixture({queue:{fail:async()=>{throw new Error('SECRET');}},runtime:{loadPayload:async()=>{throw new Error('bad');}}});assert.equal((await g.runtime.processNext(request)).status,'OUTCOME_UNKNOWN');
});
test('V124 pre-aborted scope does not claim and recovery accepts only internal kinds',async()=>{
  const f=fixture(),c=new AbortController();c.abort();await assert.rejects(f.runtime.processNext({...request,signal:c.signal}),/CLAIM_UNAVAILABLE/);assert.equal(f.calls.length,0);await assert.rejects(f.runtime.recoverExpired({tenantId,kind:'PROCLAIM_WRITEBACK'}),/INPUT_INVALID/);await f.runtime.recoverExpired({tenantId,kind:'PROCESS_INBOUND',limit:2});assert.equal(f.calls[0].recover.limit,2);
});
function supervisorFixture(options={}){
  const calls=[],leases=[],released=[];const drain={acquire:async v=>{leases.push(v);return {token:'lease',generation:1};},release:async v=>{released.push(v);}};
  const runtime={recoverExpired:async v=>{calls.push({recover:v});return [];},processNext:async v=>{calls.push(v);return {status:'SUCCEEDED'};},...options.runtime};
  const host=new WorkerSupervisor({runtime,getScopes:async()=>[{tenantId,actorId:serviceActorId}],authorizeScope:async v=>{calls.push({authorize:v.operation});return true;},drain,batchSize:3,pollIntervalMs:100,cycleTimeoutMs:500,...options,runtime});return {host,calls,leases,released};
}
test('V124 supervision recovers bounded claims and alternates job kinds across batches',async()=>{
  const f=supervisorFixture();assert.equal(f.calls.length,0);f.host.start();await until(()=>f.host.status().cycles===2);const s=await f.host.stop();assert.equal(s.drained,true);
  assert.deepEqual(f.calls.filter(v=>v.kind).slice(0,6).map(v=>v.kind),['PROCESS_INBOUND','POLICY_EVALUATION','PROCESS_INBOUND','POLICY_EVALUATION','PROCESS_INBOUND','POLICY_EVALUATION']);assert.equal(f.calls[0].authorize,'WORKER_EXECUTION_CYCLE');assert.match(f.leases[0].operationId,/^worker-execution:/);assert.equal(f.host.status().processed,6);assert.equal(f.leases.length,f.released.length);
});
test('V124 an empty pair of queues finishes a cycle without an unbounded claim loop',async()=>{const f=supervisorFixture({runtime:{processNext:async()=>null}});f.host.start();await until(()=>f.host.status().cycles===1);await f.host.stop();assert.equal(f.host.status().processed,0);});
test('V124 unknown or stale outcomes stop supervision and health cannot claim readiness',async()=>{
  for(const status of ['OUTCOME_UNKNOWN','ABORTED','STALE']){const f=supervisorFixture({runtime:{processNext:async()=>({status})}});f.host.start();await until(()=>f.host.status().state==='FAILED');assert.equal((await f.host.probe()).ok,false);assert.equal(f.host.status().errorCode,'WORKER_EXECUTION_CYCLE_FAILED');assert.equal((await f.host.stop()).drained,true);}
});
test('V124 supervision holds drain admission through an uncooperative worker shutdown',async()=>{
  let finish;const f=supervisorFixture({runtime:{processNext:async()=>{await new Promise(r=>{finish=r;});return {status:'ABORTED'};}}});f.host.start();await until(()=>finish);assert.equal((await f.host.stop({timeoutMs:10})).drained,false);assert.equal(f.released.length,0);assert.throws(()=>f.host.start(),/ALREADY_ACTIVE/);finish();await until(()=>!f.host.status().inFlight);assert.equal((await f.host.stop()).drained,true);assert.equal(f.released.length,1);
});
test('V124 withdrawn worker scopes cannot reach recovery or execution',async()=>{const f=supervisorFixture({authorizeScope:async()=>false});f.host.start();await until(()=>f.host.status().state==='FAILED');assert.equal(f.calls.length,0);await f.host.stop();});
function configuration(){
  const pool=()=>({connect:async()=>{throw new Error('CONSTRUCTION_MUST_NOT_CONNECT');}}),allow=async()=>true,drain={acquire:async()=>({token:'l',generation:1}),release:async()=>{}};
  return {domain:{domainPool:pool(),expectedDomainRole:'domain_runtime',relayPool:pool(),expectedRelayRole:'outbox_relay',producerPool:pool(),expectedProducerRole:'queue_producer',authorizeDomain:allow,authorizeAppend:allow,authorizeRelay:allow,authorizeEnqueue:allow,getScopes:async()=>[],authorizeScope:allow,drain},
    worker:{workerPool:pool(),expectedWorkerRole:'queue_worker',domainReaderPool:pool(),expectedDomainReaderRole:'domain_reader',workerId,authorizeWorker:allow,authorizeDomainRead:allow,authorizeExecution:allow,loadPayload:async()=>{},loadPolicy:async()=>{},processInbound:async()=>{},evaluatePolicy:async()=>{},getScopes:async()=>[],authorizeScope:allow,drain}};
}
test('V124 composition constructs five isolated pools, current gates and no auto-start',async()=>{const c=configuration(),p=createPostgresProcessingPipeline(c);assert.equal(p.status().relay.state,'IDLE');assert.equal(p.status().worker.state,'IDLE');assert.equal((await p.stop()).drained,true);assert.ok(Object.isFrozen(p));});
test('V124 composition rejects shared worker/domain/control pools or shared principals',()=>{
  for(const mutate of [c=>{c.worker.workerPool=c.domain.domainPool;},c=>{c.worker.expectedWorkerRole=c.domain.expectedProducerRole;},c=>{c.worker.domainReaderPool=c.worker.workerPool;},c=>{c.worker.drain={};}]){const c=configuration();mutate(c);assert.throws(()=>createPostgresProcessingPipeline(c),/SEPARATE_POOLS_REQUIRED|SHARED_DRAIN_REQUIRED/);}
});
test('V124 composition starts only explicitly and drains both lifecycles',async()=>{
  const p=createPostgresProcessingPipeline(configuration());await p.start();await until(()=>p.status().relay.cycles===1&&p.status().worker.cycles===1);await assert.rejects(p.start(),/ALREADY_ACTIVE/);assert.equal((await p.stop()).drained,true);assert.equal(p.status().worker.state,'STOPPED');
});
