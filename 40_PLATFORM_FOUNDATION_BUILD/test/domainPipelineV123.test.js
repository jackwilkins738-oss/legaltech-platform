// V123 domain pipeline regression: concrete handlers, replay and supervisor lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresDomainJobHandlers} from '../src/postgresDomainHandlers.js';
import {createPostgresDomainPipeline} from '../src/postgresDomainPipeline.js';
import {OutboxRelaySupervisor} from '../src/outboxRelaySupervisor.js';

const tenantId='12300000-0000-4000-8000-000000000001',actorId='12300000-0000-4000-8000-000000000002',commandId='12300000-0000-4000-8000-000000000003';
const jobId='12300000-0000-4000-8000-000000000004',eventId='12300000-0000-4000-8000-000000000005',payloadId='12300000-0000-4000-8000-000000000006';
const matterId='12300000-0000-4000-8000-000000000007',policyVersionId='12300000-0000-4000-8000-000000000008',other='12300000-0000-4000-8000-000000000009';
const scope={tenantId,actorId};
const inbound=()=>({...scope,commandId,jobId,eventId,payloadId,payloadHash:'a'.repeat(64),sourceSystem:'MANUAL_UPLOAD',externalEventId:'opaque-provider-event',traceId:'opaque-trace'});
const policy=()=>({...scope,commandId,jobId,matterId,policyVersionId,policyVersionHash:'b'.repeat(64),traceId:'opaque-trace'});
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function domainFixture({grants=true,actorStatus='ACTIVE',actorTenant=tenantId,tenantStatus='ACTIVE',matterStatus='OPEN',matterFound=true,enqueueFails=false,unknownCommit=false,mutateCommand=null,mutateEvent=null,authorizeDomain=async()=>true}={}){
  const state={commands:[],events:[],jobs:[]},calls=[],auth=[];
  const outbox={async run(context,work){
    const local=structuredClone(state);
    const tx={signal:new AbortController().signal,query:async(sql,values=[])=>{
      calls.push({sql,values});
      if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:grants}]};
      if(sql.includes('FROM public.actors'))return {rows:[{id:values[1],tenant_id:actorTenant,status:actorStatus,tenant_status:tenantStatus,actor_type:'USER'}]};
      if(sql.startsWith('SELECT * FROM public.domain_job_commands'))return {rows:local.commands.filter(r=>r.tenant_id===values[0]&&(r.command_id===values[1]||r.job_id===values[2]))};
      if(sql.includes('FROM public.inbound_events'))return {rows:local.events.filter(r=>r.tenant_id===values[0]&&(r.id===values[1]||(r.source_system===values[2]&&r.external_event_id===values[3])))};
      if(sql.includes('INSERT INTO public.inbound_events')){
        let row={id:values[0],tenant_id:values[1],source_system:values[2],external_event_id:values[3],payload_ref:values[4],trace_id:values[5],event_type:'INBOUND_DOCUMENT'};
        if(mutateEvent)row=mutateEvent(row);local.events.push(row);return {rows:[row]};
      }
      if(sql.includes('FROM public.matters'))return {rows:matterFound?[{id:values[1],tenant_id:values[0],status:matterStatus}]:[]};
      if(sql.includes('INSERT INTO public.domain_job_commands')){
        const cols=['tenant_id','command_id','actor_id','job_id','kind','object_id','inbound_event_id','matter_id','payload_id','payload_hash','source_hash','policy_version_id','policy_version_hash','trace_hash','request_hash','intent_hash'];
        let row=Object.fromEntries(cols.map((col,i)=>[col,values[i]]));if(mutateCommand)row=mutateCommand(row);local.commands.push(row);return {rows:[row]};
      }
      return {rows:[]};
    },enqueue:async input=>{if(enqueueFails)throw new Error('OUTBOX_FORBIDDEN');if(!local.jobs.some(r=>r.jobId===input.jobId))local.jobs.push(input);return {jobId:input.jobId};}};
    const result=await work(tx);Object.assign(state,local);if(unknownCommit)throw new Error('OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN');return result;
  }};
  const handler=new PostgresDomainJobHandlers({domainOutbox:outbox,authorizeDomain:async b=>{auth.push(b);return authorizeDomain(b);}});
  return {handler,state,calls,auth};
}
test('V123 inbound registration writes the real event, command and intent in one unit of work',async()=>{
  const f=domainFixture(),result=await f.handler.registerInbound(inbound());assert.equal(result.status,'ACCEPTED');assert.equal(result.replayed,false);
  assert.equal(f.state.events.length,1);assert.equal(f.state.commands.length,1);assert.equal(f.state.jobs.length,1);
  assert.equal(f.state.events[0].external_event_id,sha('opaque-provider-event'));assert.equal(f.state.events[0].trace_id,sha('opaque-trace'));
  assert.equal(f.state.events[0].payload_ref,`object:${payloadId}`);assert.equal(f.state.jobs[0].kind,'PROCESS_INBOUND');assert.equal(f.state.jobs[0].objectId,eventId);
  assert.equal(JSON.stringify(f.calls).includes('opaque-provider-event'),false);assert.equal(JSON.stringify(f.calls).includes('opaque-trace'),false);
});
test('V123 policy evaluation creates an immutable domain request and bound matter job',async()=>{
  const f=domainFixture();const receipt=await f.handler.requestPolicyEvaluation(policy());assert.equal(receipt.objectId,matterId);
  assert.equal(f.state.commands[0].policy_version_id,policyVersionId);assert.equal(f.state.commands[0].matter_id,matterId);assert.equal(f.state.events.length,0);
  assert.equal(f.state.jobs[0].kind,'POLICY_EVALUATION');assert.equal(f.auth[0].operation,'REQUEST_POLICY_EVALUATION');
});
test('V123 exact command replay does not recreate domain objects or add jobs',async()=>{
  for(const method of ['registerInbound','requestPolicyEvaluation']){const f=domainFixture(),input=method==='registerInbound'?inbound():policy();await f.handler[method](input);
    assert.equal((await f.handler[method](input)).replayed,true);assert.equal(f.state.commands.length,1);assert.equal(f.state.jobs.length,1);}
});
test('V123 command replay binds job, actor, payload, source, trace and policy version',async()=>{
  for(const changed of [{jobId:other},{actorId:other},{payloadId:other},{payloadHash:'c'.repeat(64)},{externalEventId:'changed'},{traceId:'changed'},{eventId:other},{sourceSystem:'MICROSOFT_GRAPH'}]){
    const f=domainFixture();await f.handler.registerInbound(inbound());await assert.rejects(f.handler.registerInbound({...inbound(),...changed}),/DOMAIN_COMMAND_CONFLICT/);assert.equal(f.state.commands.length,1);
  }
  const f=domainFixture();await f.handler.requestPolicyEvaluation(policy());await assert.rejects(f.handler.requestPolicyEvaluation({...policy(),policyVersionId:other}),/DOMAIN_COMMAND_CONFLICT/);
});
test('V123 source event deduplication cannot be bypassed with a new command or job',async()=>{
  const f=domainFixture();await f.handler.registerInbound(inbound());await assert.rejects(f.handler.registerInbound({...inbound(),commandId:other,jobId:policyVersionId,eventId:matterId}),/DOMAIN_COMMAND_CONFLICT/);assert.equal(f.state.events.length,1);
});
test('V123 an outbox denial rolls back event and command as well as the job',async()=>{
  const f=domainFixture({enqueueFails:true});await assert.rejects(f.handler.registerInbound(inbound()),/DOMAIN_COMMAND_UNAVAILABLE/);assert.deepEqual(f.state,{events:[],commands:[],jobs:[]});
});
test('V123 unknown domain commit cannot return an accepted command',async()=>{
  const f=domainFixture({unknownCommit:true});await assert.rejects(f.handler.registerInbound(inbound()),/DOMAIN_COMMAND_COMMIT_OUTCOME_UNKNOWN/);assert.equal(f.state.events.length,1);
});
test('V123 current domain authority must return strict true before any write, including replay',async()=>{
  for(const authority of [async()=>false,async()=>1,async()=>{throw new Error('SECRET_DIRECTORY')}]){
    const f=domainFixture({authorizeDomain:authority});await assert.rejects(f.handler.registerInbound(inbound()),/DOMAIN_COMMAND_FORBIDDEN|DOMAIN_COMMAND_AUTHORIZATION_UNAVAILABLE/);assert.equal(f.state.events.length,0);
  }
  let allowed=true;const f=domainFixture({authorizeDomain:async()=>allowed});await f.handler.registerInbound(inbound());allowed=false;
  await assert.rejects(f.handler.registerInbound(inbound()),/DOMAIN_COMMAND_FORBIDDEN/);assert.equal(f.state.jobs.length,1);
});
test('V123 disabled actors, suspended tenants, wrong tenant identity and closed/invisible matters fail closed',async()=>{
  for(const option of [{actorStatus:'DISABLED'},{tenantStatus:'SUSPENDED'},{actorTenant:other}]){const f=domainFixture(option);await assert.rejects(f.handler.registerInbound(inbound()),/DOMAIN_COMMAND_FORBIDDEN/);assert.equal(f.state.commands.length,0);}
  for(const option of [{matterStatus:'CLOSED'},{matterFound:false}]){const f=domainFixture(option);await assert.rejects(f.handler.requestPolicyEvaluation(policy()),/DOMAIN_COMMAND_FORBIDDEN/);assert.equal(f.state.jobs.length,0);}
});
test('V123 widened command grants or mismatched stored bindings never acknowledge work',async()=>{
  for(const option of [{grants:false},{mutateCommand:r=>({...r,actor_id:other})},{mutateEvent:r=>({...r,tenant_id:other})},{mutateEvent:r=>({...r,payload_ref:`object:${other}`})},{mutateEvent:r=>({...r,trace_id:'0'.repeat(64)})}]){const f=domainFixture(option);await assert.rejects(f.handler.registerInbound(inbound()),/DOMAIN_COMMAND_UNAVAILABLE/);assert.equal(f.state.commands.length,0);}
  const f=domainFixture();await f.handler.registerInbound(inbound());f.state.events[0].payload_ref=`object:${other}`;
  await assert.rejects(f.handler.registerInbound(inbound()),/DOMAIN_COMMAND_UNAVAILABLE/);
});
test('V123 input validation refuses raw bodies, attachments, malformed UUIDs and unbound policy data',()=>{
  const f=domainFixture();for(const change of [{body:'private text'},{attachments:[]},{tenantId:'ta'},{sourceSystem:'OTHER'},{payloadId:'https://storage.invalid/content'},{externalEventId:''}])assert.throws(()=>f.handler.registerInbound({...inbound(),...change}),/INPUT_INVALID/);
  assert.throws(()=>f.handler.requestPolicyEvaluation({...policy(),definition:{}}),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});

async function until(check){const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw new Error('TEST_STATE_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,5));}}
function supervisorFixture({getScopes=async()=>[scope],authorizeScope=async()=>true,relay,releaseFails=false,cycleTimeoutMs=500,pollIntervalMs=100}={}){
  const calls=[],leases=[],released=[];
  const drain={acquire:async input=>{leases.push(input);return {token:`lease-${leases.length}`,generation:1};},release:async lease=>{released.push(lease);if(releaseFails)throw new Error('SECRET_DRAIN');}};
  const host=new OutboxRelaySupervisor({getScopes,authorizeScope,drain,cycleTimeoutMs,pollIntervalMs,relay:relay??{relay:async input=>{calls.push(input);return {ok:true,scanned:1,delivered:1};}}});
  return {host,calls,leases,released,drain};
}
test('V123 supervisor starts explicitly, reports health after a complete cycle, and drains on stop',async()=>{
  const f=supervisorFixture();assert.equal(f.calls.length,0);assert.equal((await f.host.probe()).ok,false);f.host.start();await until(()=>f.host.status().cycles===1);
  assert.equal((await f.host.probe()).ok,true);assert.equal(f.calls[0].tenantId,tenantId);assert.equal(f.calls[0].actorId,actorId);assert.equal(f.calls[0].limit,25);assert.equal(f.leases[0].kind,'BACKGROUND');
  assert.equal((await f.host.stop()).drained,true);assert.equal(f.host.status().state,'STOPPED');assert.equal(f.released.length,1);assert.equal((await f.host.probe()).ok,false);
});
test('V123 supervisor refreshes scopes every cycle and never retains a withdrawn tenant',async()=>{
  let current=[scope];const f=supervisorFixture({getScopes:async()=>current});f.host.start();await until(()=>f.host.status().cycles===1);current=[];
  await until(()=>f.host.status().cycles>=2);await f.host.stop();assert.equal(f.calls.length,1);
});
test('V123 overlapping starts and cycles are forbidden while a relay is pending',async()=>{
  let resolve,active=0,max=0;const f=supervisorFixture({relay:{relay:async()=>{max=Math.max(max,++active);await new Promise(r=>{resolve=r});active--;return {ok:true,scanned:0,delivered:0};}}});
  f.host.start();await until(()=>!!resolve);assert.throws(()=>f.host.start(),/ALREADY_ACTIVE/);assert.equal(max,1);
  const stopping=f.host.stop();resolve();assert.equal((await stopping).drained,true);assert.equal(f.host.status().cycles,0);
});
test('V123 stop timeout aborts work, reports undrained, and refuses restart until actual settlement',async()=>{
  let resolve,received;const f=supervisorFixture({relay:{relay:async input=>{received=input;await new Promise(r=>{resolve=r});return {ok:true,scanned:0,delivered:0};}}});
  f.host.start();await until(()=>!!resolve);assert.equal((await f.host.stop({timeoutMs:10})).drained,false);assert.equal(received.signal.aborted,true);
  assert.equal(f.host.status().state,'STOP_TIMEOUT');assert.throws(()=>f.host.start(),/ALREADY_ACTIVE/);assert.equal(f.released.length,0);
  resolve();await until(()=>!f.host.status().inFlight);assert.equal(f.released.length,1);assert.equal(f.host.status().state,'STOPPED');
});
test('V123 cycle deadline fails closed without releasing the drain lease before effects settle',async()=>{
  let resolve,received;const f=supervisorFixture({cycleTimeoutMs:100,relay:{relay:async input=>{received=input;await new Promise(r=>{resolve=r});return {ok:true,scanned:0,delivered:0};}}});
  f.host.start();await until(()=>f.host.status().state==='FAILED');assert.equal(f.host.status().errorCode,'OUTBOX_RELAY_CYCLE_TIMEOUT');assert.equal(received.signal.aborted,true);
  assert.equal(f.released.length,0);assert.throws(()=>f.host.start(),/ALREADY_ACTIVE/);resolve();await until(()=>!f.host.status().inFlight);assert.equal(f.released.length,1);assert.equal((await f.host.probe()).ok,false);
});
test('V123 duplicate/malformed scopes and denied current scope authority do not reach the relay',async()=>{
  for(const values of [[scope,scope],[{tenantId,actorId,extra:'secret'}],[{tenantId:'ta',actorId}]]){const f=supervisorFixture({getScopes:async()=>values});f.host.start();await until(()=>!f.host.status().inFlight);assert.equal(f.host.status().state,'FAILED');assert.equal(f.calls.length,0);await f.host.stop();}
  for(const authorizeScope of [async()=>false,async()=>({ok:true})]){const f=supervisorFixture({authorizeScope});f.host.start();await until(()=>!f.host.status().inFlight);assert.equal(f.calls.length,0);await f.host.stop();}
});
test('V123 relay exceptions stop polling and health reveals only a machine error',async()=>{
  const f=supervisorFixture({relay:{relay:async()=>{throw new Error('SECRET_DATABASE_CREDENTIAL')}}});f.host.start();await until(()=>!f.host.status().inFlight);
  assert.equal(f.host.status().state,'FAILED');assert.equal(f.released.length,1);assert.equal(JSON.stringify(f.host.status()).includes('SECRET'),false);await f.host.stop();
});
test('V123 uncertain drain release prevents a clean-drain claim and restart',async()=>{
  const f=supervisorFixture({releaseFails:true});f.host.start();await until(()=>!f.host.status().inFlight);assert.equal(f.host.status().errorCode,'OUTBOX_RELAY_DRAIN_RELEASE_FAILED');
  assert.equal((await f.host.stop()).drained,false);assert.throws(()=>f.host.start(),/ALREADY_ACTIVE/);
});
test('V123 shutdown signal aborts the current cycle and prevents new tenant work',async()=>{
  const controller=new AbortController();let resolve;const f=supervisorFixture({getScopes:async()=>new Promise(r=>{resolve=r})});f.host.start({signal:controller.signal});await until(()=>!!resolve);controller.abort();resolve([scope]);
  await until(()=>!f.host.status().inFlight);assert.equal(f.host.status().state,'STOPPED');assert.equal(f.calls.length,0);assert.equal(f.released.length,1);
  assert.throws(()=>f.host.start({signal:controller.signal}),/ABORTED/);
});
test('V123 supervisor refuses unbounded polling, deadline, scopes and batch configuration',()=>{
  const f=supervisorFixture();for(const bad of [{pollIntervalMs:0},{cycleTimeoutMs:60001},{maxScopes:1001},{batchSize:101}])assert.throws(()=>new OutboxRelaySupervisor({relay:{relay:async()=>{}},getScopes:async()=>[],authorizeScope:async()=>true,drain:f.drain,...bad}),/CONFIGURATION_INVALID/);
});
test('V123 production factory requires separate pools/roles and current gates and starts nothing',async()=>{
  const pool=()=>({connect:async()=>{throw new Error('NOT_STARTED')}});
  const options={domainPool:pool(),expectedDomainRole:'domain_runtime',relayPool:pool(),expectedRelayRole:'relay_runtime',producerPool:pool(),expectedProducerRole:'queue_runtime',
    authorizeDomain:async()=>true,authorizeAppend:async()=>true,authorizeRelay:async()=>true,authorizeEnqueue:async()=>true,getScopes:async()=>[],authorizeScope:async()=>true,drain:supervisorFixture().drain};
  const root=createPostgresDomainPipeline(options);assert.equal(Object.isFrozen(root),true);assert.equal(root.supervisor.status().state,'IDLE');assert.equal((await root.relayProbe()).ok,false);
  assert.throws(()=>createPostgresDomainPipeline({...options,relayPool:options.domainPool}),/SEPARATE_POOLS_REQUIRED/);
  assert.throws(()=>createPostgresDomainPipeline({...options,expectedProducerRole:'domain_runtime'}),/SEPARATE_POOLS_REQUIRED/);
  for(const key of ['authorizeDomain','authorizeAppend','authorizeRelay','authorizeEnqueue','getScopes','authorizeScope','drain'])assert.throws(()=>createPostgresDomainPipeline({...options,[key]:null}),/CONFIGURATION_INVALID/);
});
test('V123 malformed relay receipts fail supervision without a healthy-cycle report',async()=>{
  for(const result of [{ok:true,scanned:1,delivered:0},{ok:true,scanned:101,delivered:101},{ok:1,scanned:0,delivered:0}]){
    const f=supervisorFixture({relay:{relay:async()=>result}});f.host.start();await until(()=>!f.host.status().inFlight);
    assert.equal(f.host.status().state,'FAILED');assert.equal(f.host.status().cycles,0);await f.host.stop();
  }
});
test('V123 a drain lease acquired after shutdown is released before reporting stopped',async()=>{
  let resolve,released=0;const host=new OutboxRelaySupervisor({relay:{relay:async()=>{throw new Error('UNREACHABLE')}},getScopes:async()=>[scope],authorizeScope:async()=>true,
    drain:{acquire:async input=>{assert.equal(input.signal,undefined);return new Promise(r=>{resolve=r});},release:async()=>{released++;}}});
  host.start();await until(()=>!!resolve);assert.equal((await host.stop({timeoutMs:10})).drained,false);assert.throws(()=>host.start(),/ALREADY_ACTIVE/);
  resolve({token:'late-lease',generation:1});await until(()=>!host.status().inFlight);assert.equal(released,1);assert.equal(host.status().state,'STOPPED');
});
test('V123 a pending drain release cannot be mistaken for completed shutdown',async()=>{
  let resolve;const host=new OutboxRelaySupervisor({relay:{relay:async()=>({ok:true,scanned:0,delivered:0})},getScopes:async()=>[scope],authorizeScope:async()=>true,
    drain:{acquire:async()=>({token:'held',generation:1}),release:async()=>new Promise(r=>{resolve=r})}});
  host.start();await until(()=>!!resolve);assert.equal((await host.stop({timeoutMs:10})).drained,false);assert.throws(()=>host.start(),/ALREADY_ACTIVE/);
  resolve();await until(()=>!host.status().inFlight);assert.equal((await host.stop()).drained,true);
});
test('V123 unknown drain acquisition outcome prevents a clean-drain claim or restart',async()=>{
  let invoked=false;const host=new OutboxRelaySupervisor({relay:{relay:async()=>{invoked=true;}},getScopes:async()=>[scope],authorizeScope:async()=>true,
    drain:{acquire:async()=>{throw new Error('SECRET_REMOTE_LEASE_REPLY_LOST')},release:async()=>{throw new Error('NO_RETURNED_LEASE')}}});
  host.start();await until(()=>!host.status().inFlight);assert.equal(invoked,false);assert.equal((await host.stop()).drained,false);assert.throws(()=>host.start(),/ALREADY_ACTIVE/);
});
