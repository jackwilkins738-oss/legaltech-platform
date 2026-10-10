// V125 managed processing adoption and canary: atomic domain adoption.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresResultAdopter} from '../src/postgresResultAdoption.js';
import {commandRequestHash} from '../src/domainCommandBinding.js';
const id=n=>`12510000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenantId=id(1),actorId=id(2),serviceActorId=id(3),commandId=id(4),jobId=id(5),objectId=id(6),payloadId=id(7),workerId=id(8);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex'),request={tenantId,serviceActorId,jobId};
function fixture({kind='PROCESS_INBOUND',authorizeAdoption=async()=>true,grants=true,triggers=true,unknownCommit=false,changeFails=false,mutate=()=>{}}={}){
  const b={tenantId,commandId,actorId,jobId,kind,objectId,inboundEventId:kind==='PROCESS_INBOUND'?objectId:null,matterId:kind==='POLICY_EVALUATION'?objectId:null,payloadId:kind==='PROCESS_INBOUND'?payloadId:null,payloadHash:kind==='PROCESS_INBOUND'?sha('artifact'):null,sourceHash:kind==='PROCESS_INBOUND'?sha('source'):null,policyVersionId:kind==='POLICY_EVALUATION'?id(9):null,policyVersionHash:kind==='POLICY_EVALUATION'?sha('artifact'):null,traceHash:sha('trace')};
  const map={tenantId:'tenant_id',commandId:'command_id',actorId:'actor_id',jobId:'job_id',kind:'kind',objectId:'object_id',inboundEventId:'inbound_event_id',matterId:'matter_id',payloadId:'payload_id',payloadHash:'payload_hash',sourceHash:'source_hash',policyVersionId:'policy_version_id',policyVersionHash:'policy_version_hash',traceHash:'trace_hash'};
  const row={...Object.fromEntries(Object.entries(map).map(([k,col])=>[col,b[k]])),request_hash:commandRequestHash(b,kind==='PROCESS_INBOUND'?'MANUAL_UPLOAD':null),intent_hash:sha('intent')};
  const state={command:row,event:{id:objectId,tenant_id:tenantId,event_type:'INBOUND_DOCUMENT',source_system:'MANUAL_UPLOAD',external_event_id:b.sourceHash,payload_ref:`object:${payloadId}`,trace_id:b.traceHash,status:'RECEIVED'},matter:{id:objectId,tenant_id:tenantId,status:'OPEN'},results:[],
    actors:[{id:actorId,tenant_id:tenantId,actor_type:'USER',status:'ACTIVE',tenant_status:'ACTIVE'},{id:serviceActorId,tenant_id:tenantId,actor_type:'SERVICE',status:'ACTIVE',tenant_status:'ACTIVE'}],
    queue:{tenantId,jobId,kind,objectId,commandId,commandHash:row.request_hash,artifactHash:sha('artifact'),resultHash:sha('result'),resultCode:'CLASSIFIED',attempt:1,workerId}};
  mutate(state);const calls=[],auth=[],outbox={async run(context,work){const local=structuredClone(state);const result=await work({signal:context.signal,query:async(sql,v=[])=>{
    calls.push({sql,v});if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:grants}]};
    if(sql.includes('FROM pg_trigger'))return {rows:triggers?[{tgname:'domain_result_binding',tgenabled:'O',tgdeferrable:true,tginitdeferred:true},{tgname:'inbound_result_transition',tgenabled:'O'}]:[]};
    if(sql.includes('FROM public.domain_job_commands'))return {rows:local.command?[local.command]:[]};
    if(sql.includes('FROM public.actors a'))return {rows:local.actors};
    if(sql.includes('FROM public.inbound_events'))return {rows:local.event?[local.event]:[]};
    if(sql.includes('FROM public.matters'))return {rows:local.matter?[local.matter]:[]};
    if(sql.startsWith('SELECT * FROM public.domain_job_results'))return {rows:local.results};
    if(sql.includes('INSERT INTO public.domain_job_results')){const columns=['tenant_id','job_id','kind','object_id','command_id','command_hash','artifact_hash','result_hash','result_code','attempt','worker_id','adopted_by'];const saved={...Object.fromEntries(columns.map((c,i)=>[c,v[i]])),adopted_at:'2026-10-09T14:00:00Z'};local.results.push(saved);return {rows:[saved]};}
    if(sql.startsWith('UPDATE public.inbound_events')){if(changeFails)return {rows:[]};local.event.status='PROCESSED';return {rows:[{id:objectId}]};}
    return {rows:[]};
  }});Object.assign(state,local);if(unknownCommit)throw new Error('OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN');return result;}};
  const reader={getResult:async v=>{calls.push({read:v});return state.queue;}};
  return {state,calls,auth,adopter:new PostgresResultAdopter({domainOutbox:outbox,jobReader:reader,authorizeAdoption:async c=>{auth.push(c);return authorizeAdoption(c);}})};
}
test('V125 adoption commits the exact receipt and inbound PROCESSED status in one transaction',async()=>{const f=fixture(),r=await f.adopter.adopt(request);assert.equal(r.status,'APPLIED');assert.equal(r.replayed,false);assert.equal(r.commandId,commandId);assert.equal(f.state.event.status,'PROCESSED');assert.equal(f.state.results.length,1);assert.deepEqual(f.auth.map(c=>c.phase),['READ_RESULT','COMMIT_ADOPTION']);assert.equal(r.token,undefined);assert.equal(f.calls.some(c=>c.sql?.includes('queue_security.')),false);});
test('V125 identical adoption replays without inserting a duplicate or changing ownership',async()=>{const f=fixture();await f.adopter.adopt(request);const r=await f.adopter.adopt(request);assert.equal(r.replayed,true);assert.equal(r.adoptedBy,serviceActorId);assert.equal(f.state.results.length,1);});
test('V125 unavailable queue result remains PENDING without changing domain state',async()=>{const f=fixture({mutate:s=>s.queue=null});assert.deepEqual(await f.adopter.adopt(request),{jobId,status:'PENDING'});assert.equal(f.state.event.status,'RECEIVED');assert.equal(f.state.results.length,0);});
test('V125 policy adoption records pinned evaluation evidence without changing a matter',async()=>{const f=fixture({kind:'POLICY_EVALUATION'});assert.equal((await f.adopter.adopt(request)).kind,'POLICY_EVALUATION');assert.equal(f.state.matter.status,'OPEN');assert.equal(f.calls.some(c=>c.sql?.startsWith('UPDATE')),false);});
test('V125 failed status update rolls back the adoption receipt',async()=>{const f=fixture({changeFails:true});await assert.rejects(f.adopter.adopt(request),/UNAVAILABLE/);assert.equal(f.state.results.length,0);assert.equal(f.state.event.status,'RECEIVED');});
test('V125 unknown domain commit returns an explicit ambiguous outcome without reprocessing',async()=>{const f=fixture({unknownCommit:true});await assert.rejects(f.adopter.adopt(request),/COMMIT_OUTCOME_UNKNOWN/);assert.equal(f.state.results.length,1);});
test('V125 current adoption authority is strict at receipt read, commit and replay',async()=>{
  for(const phase of ['READ_RESULT','COMMIT_ADOPTION']){const f=fixture({authorizeAdoption:async c=>c.phase!==phase});await assert.rejects(f.adopter.adopt(request),/FORBIDDEN/);assert.equal(f.state.results.length,0);}
  let allowed=true;const f=fixture({authorizeAdoption:async()=>allowed});await f.adopter.adopt(request);allowed=false;await assert.rejects(f.adopter.adopt(request),/FORBIDDEN/);assert.equal(f.state.results.length,1);
});
test('V125 disabled identities, suspended tenant or non-service adoption identity are denied',async()=>{
  for(const mutate of [s=>s.actors[0].status='DISABLED',s=>s.actors[1].status='DISABLED',s=>s.actors[1].actor_type='USER',s=>s.actors[0].tenant_status='SUSPENDED',s=>s.actors[0].tenant_id=id(99),s=>s.actors.pop()]){const f=fixture({mutate});await assert.rejects(f.adopter.adopt(request),/FORBIDDEN/);assert.equal(f.state.results.length,0);}
});
test('V125 absent or changed domain commands and event metadata cannot adopt a receipt',async()=>{
  for(const mutate of [s=>s.command=null,s=>s.command.request_hash=sha('wrong'),s=>s.command.payload_hash=sha('wrong'),s=>s.event.payload_ref=`object:${id(99)}`,s=>s.event.trace_id=sha('wrong'),s=>s.event.source_system='OTHER',s=>s.event.status='REJECTED',s=>s.event=null]){const f=fixture({mutate});await assert.rejects(f.adopter.adopt(request),/UNAVAILABLE/);assert.equal(f.state.results.length,0);}
});
test('V125 result tenant, command, object, version digest and outcome metadata bind exactly',async()=>{
  for(const change of [{tenantId:id(99)},{jobId:id(99)},{kind:'POLICY_EVALUATION'},{objectId:id(99)},{commandId:id(99)},{commandHash:sha('wrong')},{artifactHash:sha('wrong')},{resultHash:'bad'},{resultCode:'private text'},{attempt:11},{workerId:'bad'}]){const f=fixture({mutate:s=>Object.assign(s.queue,change)});await assert.rejects(f.adopter.adopt(request),/UNAVAILABLE/);assert.equal(f.state.results.length,0);}
});
test('V125 conflicting prior adoption and orphan processed events cannot produce success',async()=>{const f=fixture();await f.adopter.adopt(request);f.state.results[0].result_hash=sha('changed');await assert.rejects(f.adopter.adopt(request),/UNAVAILABLE/);const g=fixture({mutate:s=>s.event.status='PROCESSED'});await assert.rejects(g.adopter.adopt(request),/UNAVAILABLE/);});
test('V125 closed or invisible policy matters cannot adopt old evaluation evidence',async()=>{for(const mutate of [s=>s.matter.status='CLOSED',s=>s.matter=null]){const f=fixture({kind:'POLICY_EVALUATION',mutate});await assert.rejects(f.adopter.adopt(request),/FORBIDDEN/);}});
test('V125 unsafe grants and disabled result triggers block queue reads and domain mutation',async()=>{for(const options of [{grants:false},{triggers:false}]){const f=fixture(options);await assert.rejects(f.adopter.adopt(request),/UNAVAILABLE/);assert.equal(f.calls.some(c=>c.read),false);assert.equal(f.state.results.length,0);}});
test('V125 invalid scope is refused before opening a transaction',async()=>{const f=fixture();for(const change of [{tenantId:'bad'},{serviceActorId:'bad'},{jobId:'bad'}])await assert.rejects(f.adopter.adopt({...request,...change}),/INPUT_INVALID/);assert.equal(f.calls.length,0);});
test('V125 unavailable current authority is sanitized without leaking provider errors',async()=>{const f=fixture({authorizeAdoption:async()=>{throw new Error('SECRET_DIRECTORY');}});await assert.rejects(f.adopter.adopt(request),e=>e.message==='DOMAIN_RESULT_UNAVAILABLE');assert.equal(f.state.results.length,0);});
