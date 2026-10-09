// V122 transactional outbox regression: stateful rollback and relay crash windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresDomainOutbox,PostgresOutboxRelay} from '../src/postgresOutbox.js';
import {prepareJobIntent,validateJobIntent,intentHash} from '../src/jobIntent.js';
import {canonicalAuditPayload} from '../src/securityMonitoring.js';

const tenantId='12200000-0000-4000-8000-000000000001',actorId='12200000-0000-4000-8000-000000000002';
const jobId='12200000-0000-4000-8000-000000000003',objectId='12200000-0000-4000-8000-000000000004';
const other='12200000-0000-4000-8000-000000000005';
const input=()=>({tenantId,jobId,objectId,kind:'PROCESS_INBOUND',traceId:'private-trace',idempotencyKey:'private-key'});
const context={tenantId,actorId};
function fixture({badGrants=false,badRls=false,badRole=false,commitUnknown=false,ackFailure=false,ackUnknown=false,mutateRow=null}={}) {
  const state={events:[],receipts:[],domain:[]},calls=[],releases=[];
  const pool={connect:async()=>{let local;return {query:async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.startsWith('BEGIN')){local=structuredClone(state);return {rows:[]};}
    if(sql==='COMMIT'){const receiptChanged=local.receipts.length>state.receipts.length;Object.assign(state,local);if(commitUnknown||(ackUnknown&&receiptChanged))throw new Error('SECRET_BACKEND');return {rows:[]};}
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:badRole?'owner':'runtime',login_role:'runtime',tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes('AS member,'))return {rows:[{member:true,privileged:false,owns_schema:false,outside_access:false}]};
    if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:!badGrants}]};
    if(sql.includes('AS forced,row_security_active'))return {rows:values[0].map(relname=>({relname,enabled:true,forced:!badRls,active:true}))};
    if(sql==='INSERT INTO public.matters'){local.domain.push(values[0]);return {rows:[]};}
    if(sql.startsWith('SELECT * FROM public.domain_outbox_events'))return {rows:local.events.filter(x=>x.tenant_id===values[0]&&(x.job_id===values[1]||(x.kind===values[2]&&x.key_hash===values[3])))};
    if(sql.includes('INSERT INTO public.domain_outbox_events')){
      let row={tenant_id:values[0],job_id:values[1],kind:values[2],object_id:values[3],key_hash:values[4],request_hash:values[5],intent:values[6]};
      if(mutateRow)row=mutateRow(row);local.events.push(row);return {rows:[row]};
    }
    if(sql.startsWith('SELECT e.*'))return {rows:local.events.filter(x=>x.tenant_id===values[0]&&!local.receipts.some(r=>r.tenant_id===x.tenant_id&&r.job_id===x.job_id)).slice(0,values[1])};
    if(sql.includes('INSERT INTO public.domain_outbox_receipts')){
      if(ackFailure)throw new Error('SECRET_ACK');
      const prior=local.receipts.some(r=>r.tenant_id===values[0]&&r.job_id===values[1]);
      if(!prior)local.receipts.push({tenant_id:values[0],job_id:values[1],request_hash:values[2]});return {rows:[],rowCount:prior?0:1};
    }
    if(sql.startsWith('SELECT request_hash FROM public.domain_outbox_receipts'))return {rows:local.receipts.filter(r=>r.tenant_id===values[0]&&r.job_id===values[1]).map(r=>({request_hash:r.request_hash}))};
    return {rows:[]};
  },release:destroy=>releases.push(destroy)}}};
  const producer={calls:[],jobs:new Map(),async enqueueIntent(intent){
    this.calls.push(intent);const hash=intentHash(intent),old=this.jobs.get(intent.jobId);
    if(old&&old!==hash)throw new Error('QUEUE_ENQUEUE_CONFLICT');this.jobs.set(intent.jobId,hash);
    return {...intent,status:'QUEUED',replayed:!!old};
  }};
  const options={pool,expectedRole:'runtime',timeoutMs:200};
  const domain=(authorizeAppend=async()=>true)=>new PostgresDomainOutbox({...options,authorizeAppend});
  const relay=(authorizeRelay=async()=>true,jobProducer=producer)=>new PostgresOutboxRelay({...options,authorizeRelay,jobProducer});
  return {state,calls,releases,producer,domain,relay};
}
async function append(f,raw=input()){return f.domain().run(context,async tx=>{await tx.query('INSERT INTO public.matters',[objectId]);return tx.enqueue(raw);});}

test('V122 domain row and metadata-only intent commit on one checked-out transaction',async()=>{
  const f=fixture(),receipt=await append(f);assert.equal(receipt.jobId,jobId);assert.deepEqual(f.state.domain,[objectId]);assert.equal(f.state.events.length,1);
  assert.equal(f.calls.filter(c=>c.sql==='BEGIN').length,1);assert.deepEqual(f.releases,[false]);assert.equal(f.producer.calls.length,0);
  assert.equal(JSON.stringify(f.state).includes('private-trace'),false);assert.equal(JSON.stringify(f.state).includes('private-key'),false);
});
test('V122 domain failure rolls back domain row and intent together',async()=>{
  const f=fixture();await assert.rejects(f.domain().run(context,async tx=>{await tx.query('INSERT INTO public.matters',[objectId]);await tx.enqueue(input());throw new Error('SECRET_DOMAIN');}),/OUTBOX_STORE_UNAVAILABLE/);
  assert.deepEqual(f.state,{events:[],receipts:[],domain:[]});assert.deepEqual(f.releases,[true]);
});
test('V122 swallowed append denial poisons the enclosing domain transaction',async()=>{
  const f=fixture();await assert.rejects(f.domain(async()=>false).run(context,async tx=>{await tx.query('INSERT INTO public.matters',[objectId]);await tx.enqueue(input()).catch(()=>{});}),/OUTBOX_FORBIDDEN/);
  assert.equal(f.state.domain.length,0);assert.equal(f.state.events.length,0);
});
test('V122 abandoned append promise prevents commit and late callbacks cannot persist',async()=>{
  const f=fixture();let release,escaped;
  const promise=f.domain(async()=>new Promise(resolve=>{release=resolve})).run(context,async tx=>{escaped=tx.enqueue;tx.enqueue(input());await tx.query('INSERT INTO public.matters',[objectId]);});
  await assert.rejects(promise,/OUTBOX_STORE_UNAVAILABLE/);release(true);await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(escaped(input()),/OUTBOX_STORE_UNAVAILABLE/);assert.equal(f.state.domain.length,0);
});
test('V122 append binds tenant and rejects arbitrary payloads before insert',async()=>{
  for(const raw of [{...input(),tenantId:other},{...input(),payload:'client-content'}]){const f=fixture();await assert.rejects(append(f,raw),/FORBIDDEN|INPUT_INVALID/);assert.equal(f.state.events.length,0);}
});
test('V122 immutable event replay matches all intent fields and rejects conflicts',async()=>{
  const f=fixture();await append(f);assert.equal((await append(f)).replayed,true);assert.equal(f.state.events.length,1);
  await assert.rejects(append(f,{...input(),maxAttempts:2}),/OUTBOX_APPEND_CONFLICT/);assert.equal(f.state.events.length,1);
});
test('V122 unknown domain commit returns no success and permits stable-ID reconciliation',async()=>{
  const f=fixture({commitUnknown:true});await assert.rejects(append(f),/OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN/);assert.equal(f.state.events.length,1);assert.deepEqual(f.releases,[true]);
});
test('V122 unsafe outbox grants, RLS or direct role fail before domain work',async()=>{
  for(const bad of [{badGrants:true},{badRls:true},{badRole:true}]){const f=fixture(bad);let ran=false;await assert.rejects(f.domain().run(context,async()=>{ran=true;}),/OUTBOX_STORE_UNAVAILABLE/);assert.equal(ran,false);}
});
test('V122 malformed database intent cannot commit or reach the queue',async()=>{
  for(const mutateRow of [r=>({...r,tenant_id:other}),r=>({...r,request_hash:'0'.repeat(64)}),r=>({...r,intent:'{}'})]){const f=fixture({mutateRow});await assert.rejects(append(f),/OUTBOX_STORE_UNAVAILABLE|QUEUE_INPUT_INVALID/);assert.equal(f.state.events.length,0);}
});
test('V122 relay commits queue first, then receipt, and subsequent scan is empty',async()=>{
  const f=fixture();await append(f);assert.deepEqual(await f.relay().relay(context),{ok:true,delivered:1,scanned:1});assert.equal(f.state.receipts.length,1);assert.equal(f.producer.jobs.size,1);
  assert.deepEqual(await f.relay().relay(context),{ok:true,delivered:0,scanned:0});
});
test('V122 crash between queue commit and receipt leaves intent pending; retry deduplicates',async()=>{
  const f=fixture({ackFailure:true});await append(f);await assert.rejects(f.relay().relay(context),/OUTBOX_STORE_UNAVAILABLE/);assert.equal(f.state.receipts.length,0);assert.equal(f.producer.jobs.size,1);
  const recovered=fixture();Object.assign(recovered.state,structuredClone(f.state));recovered.producer.jobs=f.producer.jobs;
  assert.equal((await recovered.relay().relay(context)).delivered,1);assert.equal(recovered.producer.jobs.size,1);assert.equal(recovered.state.receipts.length,1);
});
test('V122 uncertain queue commit never acknowledges an outbox event',async()=>{
  const f=fixture();await append(f);await assert.rejects(f.relay(async()=>true,{enqueueIntent:async()=>{throw new Error('QUEUE_ENQUEUE_OUTCOME_UNKNOWN')}}).relay(context),/QUEUE_ENQUEUE_OUTCOME_UNKNOWN/);assert.equal(f.state.receipts.length,0);
});
test('V122 queue receipt must match tenant, job, kind, object and trace digest',async()=>{
  for(const changed of [{tenantId:other},{jobId:other},{objectId:other},{kind:'POLICY_EVALUATION'},{traceHash:'0'.repeat(64)}]){const f=fixture();await append(f);await assert.rejects(f.relay(async()=>true,{enqueueIntent:async intent=>({...intent,...changed})}).relay(context),/OUTBOX_STORE_UNAVAILABLE/);assert.equal(f.state.receipts.length,0);}
});
test('V122 current relay authorization is checked at scan, enqueue and acknowledgement',async()=>{
  for(const denied of ['RELAY_SCAN','RELAY_ENQUEUE','RELAY_ACK']){const f=fixture();await append(f);await assert.rejects(f.relay(async b=>b.operation!==denied).relay(context),/OUTBOX_FORBIDDEN/);assert.equal(f.state.receipts.length,0);assert.equal(f.producer.jobs.size,denied==='RELAY_ACK'?1:0);}
});
test('V122 queue conflicts remain pending and never become false delivery receipts',async()=>{
  const f=fixture();await append(f);f.producer.jobs.set(jobId,'wrong');await assert.rejects(f.relay().relay(context),/QUEUE_ENQUEUE_CONFLICT/);assert.equal(f.state.receipts.length,0);
});
test('V122 cross-tenant scan is empty and invalid batch sizes reject before checkout',async()=>{
  const f=fixture();await append(f);assert.equal((await f.relay().relay({...context,tenantId:other})).scanned,0);
  for(const limit of [0,101,1.5])await assert.rejects(f.relay().relay({...context,limit}),/OUTBOX_INPUT_INVALID/);
});
test('V122 normalized intent refuses extra keys, nulls, uppercase UUIDs and unbounded policy',()=>{
  const intent=prepareJobIntent(input());assert.equal(Object.isFrozen(intent),true);assert.equal(intentHash(intent).length,64);
  for(const changed of [{payload:'secret'},{tenantId:null},{tenantId:tenantId.toUpperCase().replace('122','ABC')},{traceHash:null},{maxAttempts:11},{leaseMs:4999},{maxRunMs:1},{delayMs:-1},{retryDelayMs:0}])assert.throws(()=>validateJobIntent({...intent,...changed}),/QUEUE_INPUT_INVALID/);
  assert.equal(canonicalAuditPayload(intent).includes('private'),false);
});

test('V122 acknowledgement commit uncertainty is explicit and retry discovers committed receipt',async()=>{
  const f=fixture({ackUnknown:true});await append(f);await assert.rejects(f.relay().relay(context),/OUTBOX_ACK_OUTCOME_UNKNOWN/);
  assert.equal(f.state.receipts.length,1);assert.equal((await f.relay().relay(context)).scanned,0);assert.equal(f.producer.jobs.size,1);
});
test('V122 nonboolean or failing current authorization never commits domain work',async()=>{
  for(const authority of [async()=>1,async()=>({ok:true}),async()=>{throw new Error('SECRET_DIRECTORY')}]){
    const f=fixture();await assert.rejects(f.domain(authority).run(context,async tx=>{await tx.query('INSERT INTO public.matters',[objectId]);return tx.enqueue(input());}),/OUTBOX_FORBIDDEN|OUTBOX_AUTHORIZATION_UNAVAILABLE/);
    assert.equal(f.state.domain.length,0);
  }
});
test('V122 a late relay authority lookup times out and cannot acknowledge after deadline',async()=>{
  const f=fixture();await append(f);let release;
  const delayed=f.relay(async b=>b.operation==='RELAY_ACK'?new Promise(resolve=>{release=resolve}):true);
  await assert.rejects(delayed.relay(context),/OUTBOX_STORE_UNAVAILABLE/);release(true);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.state.receipts.length,0);assert.equal(f.producer.jobs.size,1);
});
