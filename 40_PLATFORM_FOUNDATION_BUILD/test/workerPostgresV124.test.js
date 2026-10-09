// V124 verified worker execution: binding, role posture and atomic ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresWorkerDomainLoader} from '../src/postgresWorkerDomain.js';
import {PostgresJobWorker,PostgresJobReader} from '../src/postgresJobs.js';
import {commandRequestHash,decodeDomainCommand} from '../src/domainCommandBinding.js';
import {prepareJobIntent,intentHash} from '../src/jobIntent.js';
import {canonicalAuditPayload} from '../src/securityMonitoring.js';
const id=n=>`12410000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenantId=id(1),actorId=id(2),serviceActorId=id(3),workerId=id(4),jobId=id(5),objectId=id(6),commandId=id(7),payloadId=id(8),policyVersionId=id(9);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function fixture({kind='PROCESS_INBOUND',unsafe={},mutate=()=>{},failCommit=false}={}){
  const binding={tenantId,actorId,jobId,objectId,commandId,kind,inboundEventId:kind==='PROCESS_INBOUND'?objectId:null,matterId:kind==='POLICY_EVALUATION'?objectId:null,
    payloadId:kind==='PROCESS_INBOUND'?payloadId:null,payloadHash:kind==='PROCESS_INBOUND'?sha('bytes'):null,sourceHash:kind==='PROCESS_INBOUND'?sha('source'):null,
    policyVersionId:kind==='POLICY_EVALUATION'?policyVersionId:null,policyVersionHash:kind==='POLICY_EVALUATION'?sha('policy'):null,traceHash:sha('trace')};
  const sourceSystem=kind==='PROCESS_INBOUND'?'MANUAL_UPLOAD':null;
  const intent=prepareJobIntent({tenantId,jobId,kind,objectId,traceId:'trace',idempotencyKey:`domain-command:${commandId}`});
  const columns=['tenant_id','actor_id','job_id','object_id','command_id','kind','inbound_event_id','matter_id','payload_id','payload_hash','source_hash','policy_version_id','policy_version_hash','trace_hash'];
  const row=Object.fromEntries(columns.map((c,i)=>[c,Object.values(binding)[i]]));
  const state={command:row,event:{id:objectId,tenant_id:tenantId,event_type:'INBOUND_DOCUMENT',source_system:sourceSystem,external_event_id:binding.sourceHash,payload_ref:`object:${payloadId}`,trace_id:binding.traceHash,status:'RECEIVED'},
    matter:{id:objectId,tenant_id:tenantId,status:'OPEN'},identity:[{id:actorId,tenant_id:tenantId,actor_type:'USER',status:'ACTIVE',tenant_status:'ACTIVE'},{id:serviceActorId,tenant_id:tenantId,actor_type:'SERVICE',status:'ACTIVE',tenant_status:'ACTIVE'}],outbox:{intent:canonicalAuditPayload(intent),request_hash:intentHash(intent)}};
  row.request_hash=commandRequestHash(binding,sourceSystem);row.intent_hash=intentHash(intent);mutate(state);
  const calls=[],releases=[];
  const pool={connect:async()=>({query:async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:unsafe.role??'reader_runtime',login_role:unsafe.role??'reader_runtime',tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes('AS member,'))return {rows:[{member:true,privileged:false,owns_schema:false,outside_access:false,...unsafe}]};
    if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:unsafe.grants_safe??true}]};
    if(sql.startsWith('SELECT c.relname'))return {rows:values[0].map(relname=>({relname,enabled:true,forced:true,active:unsafe.active??true}))};
    if(sql.startsWith('SELECT * FROM public.domain_job_commands'))return {rows:state.command?[state.command]:[]};
    if(sql.includes('FROM public.actors a'))return {rows:state.identity};
    if(sql.includes('FROM public.inbound_events'))return {rows:state.event?[state.event]:[]};
    if(sql.includes('FROM public.matters'))return {rows:state.matter?[state.matter]:[]};
    if(sql.includes('FROM public.domain_outbox_events'))return {rows:state.outbox?[state.outbox]:[]};
    if(sql==='COMMIT'&&failCommit)throw new Error('SECRET_COMMIT');return {rows:[]};
  },release:v=>releases.push(v)})};
  const claim={tenantId,jobId,kind,objectId,workerId,requestHash:row.intent_hash,traceHash:sha('trace')};return {pool,state,calls,releases,claim,binding};
}
const loader=(f,authorizeRead=async()=>true)=>new PostgresWorkerDomainLoader({pool:f.pool,expectedRole:'reader_runtime',timeoutMs:100,authorizeRead});
test('V124 domain loader verifies complete inbound and policy command/intent bindings in a read-only snapshot',async()=>{
  for(const kind of ['PROCESS_INBOUND','POLICY_EVALUATION']){const f=fixture({kind}),contexts=[];const value=await loader(f,async c=>{contexts.push(c);return true;}).load(f.claim,{serviceActorId});assert.equal(value.commandId,commandId);assert.equal(value.intentHash,f.claim.requestHash);assert.equal(contexts.length,2);assert.equal(contexts[1].actorId,actorId);assert.ok(f.calls.some(c=>/BEGIN.*REPEATABLE READ.*READ ONLY/.test(c.sql)));assert.deepEqual(f.releases,[false]);assert.ok(Object.isFrozen(value));}
});
test('V124 read-only loader refuses private-role overlap, widened grants and inactive RLS',async()=>{
  for(const unsafe of [{member:false},{privileged:true},{outside_access:true},{owns_schema:true},{grants_safe:false},{active:false},{role:'owner'}]){const f=fixture({unsafe});await assert.rejects(loader(f).load(f.claim,{serviceActorId}),/UNAVAILABLE|BINDING_INVALID/);assert.equal(f.calls.some(c=>c.sql.startsWith('SELECT * FROM public.domain_job_commands')),false);}
});
test('V124 service identity and original author must both remain active in the active tenant',async()=>{
  for(const mutate of [s=>s.identity[0].status='DISABLED',s=>s.identity[1].status='DISABLED',s=>s.identity[1].actor_type='USER',s=>s.identity[0].tenant_status='SUSPENDED',s=>s.identity[1].tenant_id=id(99),s=>s.identity.pop()]){const f=fixture({mutate});await assert.rejects(loader(f).load(f.claim,{serviceActorId}),/FORBIDDEN/);}
});
test('V124 current domain read authorization is strict at both broad and exact-command gates',async()=>{
  for(const authorizeRead of [async()=>1,async c=>c.commandId===undefined,async()=>{throw new Error('SECRET_DIRECTORY');}]){const f=fixture();await assert.rejects(loader(f,authorizeRead).load(f.claim,{serviceActorId}),/FORBIDDEN|AUTHORIZATION_UNAVAILABLE/);}
});
test('V124 changed command metadata, hash, source binding or payload reference is refused',async()=>{
  for(const mutate of [s=>s.command.payload_hash=sha('changed'),s=>s.command.request_hash=sha('changed'),s=>s.command.tenant_id=id(99),s=>s.event.payload_ref=`object:${id(99)}`,s=>s.event.external_event_id=sha('changed'),s=>s.event.source_system='OTHER',s=>s.event.trace_id=sha('changed'),s=>s.event.status='REJECTED',s=>s.event=null,s=>s.command=null]){const f=fixture({mutate});await assert.rejects(loader(f).load(f.claim,{serviceActorId}),/BINDING_INVALID/);}
});
test('V124 closed or invisible policy matters cannot be loaded by a worker',async()=>{
  for(const mutate of [s=>s.matter.status='CLOSED',s=>s.matter=null,s=>s.matter.tenant_id=id(99)]){const f=fixture({kind:'POLICY_EVALUATION',mutate});await assert.rejects(loader(f).load(f.claim,{serviceActorId}),/FORBIDDEN/);}
});
test('V124 noncanonical, changed or absent outbox intent cannot authorize execution',async()=>{
  for(const mutate of [s=>s.outbox.intent+=' ',s=>s.outbox.request_hash=sha('other'),s=>s.outbox=null,s=>{const v=JSON.parse(s.outbox.intent);v.objectId=id(99);s.outbox.intent=canonicalAuditPayload(v);s.outbox.request_hash=intentHash(v);}]){const f=fixture({mutate});await assert.rejects(loader(f).load(f.claim,{serviceActorId}),/BINDING_INVALID/);}
});
test('V124 command decoder rejects inconsistent nullable fields and policy/inbound shapes',()=>{
  const f=fixture();assert.throws(()=>decodeDomainCommand({...f.state.command,matter_id:objectId},'MANUAL_UPLOAD'),/BINDING_INVALID/);assert.throws(()=>decodeDomainCommand(f.state.command,null),/BINDING_INVALID/);const p=fixture({kind:'POLICY_EVALUATION'});assert.throws(()=>decodeDomainCommand({...p.state.command,source_hash:sha('x')},null),/BINDING_INVALID/);
});
test('V124 loader probe checks all forced domain RLS without opening queue permissions',async()=>{const f=fixture();assert.equal((await loader(f).probe()).ok,true);assert.equal(f.calls.some(c=>c.sql.includes('queue_security.jobs')),false);});
function queueFixture({prior=null,status='RUNNING',locked=true,changed=true,failCommit=false,triggerSafe=true,mutateSaved=r=>r}={}){
  const calls=[],releases=[];let saved;
  const claim={tenantId,jobId,objectId,kind:'PROCESS_INBOUND',attempt:1,workerId,token:crypto.randomBytes(32).toString('base64url'),requestHash:sha('intent')};
  const metadata={commandId,commandHash:sha('command'),artifactHash:sha('artifact'),resultHash:sha('result'),resultCode:'CLASSIFIED'};
  const stored={tenant_id:tenantId,job_id:jobId,kind:claim.kind,object_id:objectId,command_id:commandId,command_hash:metadata.commandHash,artifact_hash:metadata.artifactHash,result_hash:metadata.resultHash,result_code:metadata.resultCode,attempt:1,worker_id:workerId,token_hash:sha(claim.token),completed_at:'2026-10-09T12:00:00Z'};
  const pool={connect:async()=>({query:async(sql,values=[])=>{
    calls.push({sql,values});
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:'queue_runtime',login_role:'queue_runtime',tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes('AS member,'))return {rows:[{member:true,privileged:false,owns_schema:false,outside_access:false}]};
    if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:true}]};
    if(sql.includes('FROM pg_trigger'))return {rows:sql.includes("c.relname='job_results'")?[{tgname:'worker_result_claim',tgenabled:'O'},{tgname:'worker_result_completion',tgenabled:triggerSafe?'O':'D',tgdeferrable:true,tginitdeferred:triggerSafe}]:[{tgenabled:'O'}]};
    if(sql.startsWith('SELECT * FROM queue_security.jobs'))return {rows:locked?[{status,result_code:'CLASSIFIED'}]:[]};
    if(sql.startsWith('SELECT * FROM queue_security.job_results'))return {rows:prior?[typeof prior==='function'?prior(stored):stored]:[]};
    if(sql.includes('INSERT INTO queue_security.job_results')){saved=mutateSaved(stored);return {rows:[saved]};}
    if(sql.includes('UPDATE queue_security.jobs'))return {rows:changed?[{job_id:jobId}]:[]};
    if(sql==='COMMIT'&&failCommit)throw new Error('SECRET_COMMIT');return {rows:[]};
  },release:v=>releases.push(v)})};
  return {calls,releases,claim,metadata,pool,get saved(){return saved;},worker:new PostgresJobWorker({pool,expectedRole:'queue_runtime',workerId,authorizeWorker:async()=>true,timeoutMs:100})};
}
test('V124 result insertion and successful settlement use one transaction and hashed claim credentials',async()=>{
  const f=queueFixture(),r=await f.worker.completeWithResult(f.claim,f.metadata);assert.equal(r.commandId,commandId);assert.equal(r.tokenHash,undefined);assert.equal(JSON.stringify(f.calls).includes(f.claim.token),false);
  const events=f.calls.map(c=>c.sql);assert.equal(events.filter(s=>s==='COMMIT').length,1);assert.ok(events.findIndex(s=>s.includes('INSERT INTO queue_security.job_results'))<events.findIndex(s=>s.includes('UPDATE queue_security.jobs')));assert.deepEqual(f.releases,[false]);
});
test('V124 identical committed result replays without insertion; altered metadata cannot replay',async()=>{
  const f=queueFixture({prior:true,status:'SUCCEEDED'});assert.equal((await f.worker.completeWithResult(f.claim,f.metadata)).resultHash,f.metadata.resultHash);assert.equal(f.saved,undefined);
  const g=queueFixture({prior:r=>({...r,result_hash:sha('different')}),status:'SUCCEEDED'});await assert.rejects(g.worker.completeWithResult(g.claim,g.metadata),/UNAVAILABLE/);assert.deepEqual(g.releases,[true]);
});
test('V124 recovered, terminal or missing claims cannot create result receipts',async()=>{
  for(const option of [{locked:false},{status:'DEAD'}]){const f=queueFixture(option);assert.equal(await f.worker.completeWithResult(f.claim,f.metadata),false);assert.equal(f.saved,undefined);}
});
test('V124 missing live completion rolls back its result insert',async()=>{const f=queueFixture({changed:false});await assert.rejects(f.worker.completeWithResult(f.claim,f.metadata),/UNAVAILABLE/);assert.deepEqual(f.releases,[true]);assert.equal(f.calls.some(c=>c.sql==='COMMIT'),false);assert.deepEqual(f.releases,[true]);});
test('V124 disabled or nondeferred result protection prevents any insertion',async()=>{const f=queueFixture({triggerSafe:false});await assert.rejects(f.worker.completeWithResult(f.claim,f.metadata),/UNAVAILABLE/);assert.equal(f.saved,undefined);});
test('V124 uncertain atomic result commit is distinct and never returns success',async()=>{const f=queueFixture({failCommit:true});await assert.rejects(f.worker.completeWithResult(f.claim,f.metadata),/SETTLEMENT_OUTCOME_UNKNOWN/);assert.deepEqual(f.releases,[true]);});
test('V124 returned result tenant/fence/hash must match exactly before commit',async()=>{
  for(const change of [{tenant_id:id(99)},{attempt:2},{artifact_hash:sha('wrong')},{token_hash:sha('wrong')}]){const f=queueFixture({mutateSaved:r=>({...r,...change})});await assert.rejects(f.worker.completeWithResult(f.claim,f.metadata),/UNAVAILABLE/);assert.equal(f.calls.some(c=>c.sql==='COMMIT'),false);}
});
test('V124 current result metadata authorization protects read and settlement',async()=>{
  const f=queueFixture({prior:true,status:'SUCCEEDED'}),seen=[];const reader=new PostgresJobReader({pool:f.pool,expectedRole:'queue_runtime',timeoutMs:100,authorizeRead:async c=>{seen.push(c);return true;}});
  const result=await reader.getResult({tenantId,jobId});assert.equal(result.commandId,commandId);assert.equal(result.tokenHash,undefined);assert.equal(seen[1].objectId,objectId);assert.equal(seen[1].operation,'READ_RESULT');
  const denied=new PostgresJobWorker({pool:f.pool,expectedRole:'queue_runtime',workerId,authorizeWorker:async()=>false});await assert.rejects(denied.completeWithResult(f.claim,f.metadata),/FORBIDDEN/);
  const hidden=new PostgresJobReader({pool:f.pool,expectedRole:'queue_runtime',authorizeRead:async c=>c.objectId===undefined});await assert.rejects(hidden.getResult({tenantId,jobId}),/FORBIDDEN/);
});
test('V124 result metadata rejects arbitrary fields, external kinds and malformed hashes before checkout',async()=>{
  for(const change of [{rawText:'private'},{commandId:'bad'},{artifactHash:'bad'},{resultCode:'private text'}]){const f=queueFixture();await assert.rejects(f.worker.completeWithResult(f.claim,{...f.metadata,...change}),/INPUT_INVALID/);assert.equal(f.calls.length,0);}
  const f=queueFixture();await assert.rejects(f.worker.completeWithResult({...f.claim,kind:'PROCLAIM_WRITEBACK'},f.metadata),/INPUT_INVALID/);assert.equal(f.calls.length,0);
});
