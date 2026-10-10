// V130 durable human review decision: one immutable decision per adopted
// inbound result, atomic event transition and a single writeback intent.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresReviewDecisions,decisionKeyHash,normalizeReviewDecision,reviewRequestHash,writebackJobId} from '../src/postgresReviewDecisions.js';

const id=n=>`13010000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenantId=id(1),userId=id(2),serviceId=id(3),eventId=id(4),matterId=id(5),resultJobId=id(6);
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const approve={tenantId,actorId:userId,eventId,decision:'APPROVE',matterId,decisionKey:'approve-1',traceId:'trace-v130'};
const reject={tenantId,actorId:userId,eventId,decision:'REJECT',decisionKey:'reject-1',traceId:'trace-v130'};

function fixture({authorizeDecision=async()=>true,grants=true,triggers=true,unknownCommit=false,changeFails=false,enqueueFails=false,mutate=()=>{}}={}){
  const state={event:{id:eventId,tenant_id:tenantId,event_type:'INBOUND_DOCUMENT',status:'PROCESSED'},matter:{id:matterId,tenant_id:tenantId,status:'OPEN'},
    actors:[{id:userId,tenant_id:tenantId,actor_type:'USER',status:'ACTIVE',tenant_status:'ACTIVE'},{id:serviceId,tenant_id:tenantId,actor_type:'SERVICE',status:'ACTIVE',tenant_status:'ACTIVE'}],
    results:[{tenant_id:tenantId,job_id:resultJobId,kind:'PROCESS_INBOUND',object_id:eventId,result_hash:sha('result')}],decisions:[],intents:[]};
  mutate(state);const calls=[],auth=[];
  const outbox={async run(context,work){
    const local=structuredClone(state);
    const result=await work({signal:context.signal,
      enqueue:async intent=>{calls.push({enqueue:intent});if(enqueueFails)throw new Error('OUTBOX_APPEND_CONFLICT');
        if(!local.intents.some(i=>i.jobId===intent.jobId))local.intents.push(intent);return {tenantId:intent.tenantId,jobId:intent.jobId};},
      query:async(sql,v=[])=>{
        calls.push({sql,v});
        if(sql.endsWith('AS grants_safe'))return {rows:[{grants_safe:grants}]};
        if(sql.includes('FROM pg_trigger'))return {rows:triggers?[{tgname:'domain_review_decision_binding',tgenabled:'O',tgdeferrable:true,tginitdeferred:true},{tgname:'inbound_review_transition',tgenabled:'O'}]:[]};
        if(sql.includes('FROM public.actors a'))return {rows:local.actors.filter(a=>a.id===v[1])};
        if(sql.includes('FROM public.inbound_events'))return {rows:local.event?[local.event]:[]};
        if(sql.includes('FROM public.domain_job_results'))return {rows:local.results};
        if(sql.includes('FROM public.matters'))return {rows:local.matter?[local.matter]:[]};
        if(sql.startsWith('SELECT * FROM public.domain_review_decisions'))return {rows:local.decisions.filter(d=>d.event_id===v[1]||d.decision_key_hash===v[2])};
        if(sql.includes('INSERT INTO public.domain_review_decisions')){
          const cols=['tenant_id','event_id','result_job_id','result_hash','decision','matter_id','decided_by','decision_key_hash','request_hash','writeback_job_id'];
          const saved=Object.fromEntries(cols.map((c,i)=>[c,v[i]]));local.decisions.push(saved);return {rows:[saved]};
        }
        if(sql.startsWith('UPDATE public.inbound_events')){if(changeFails)return {rows:[]};local.event.status=v[2];return {rows:[{id:eventId,status:v[2]}]};}
        return {rows:[]};
      }});
    Object.assign(state,local);if(unknownCommit)throw new Error('OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN');return result;
  }};
  return {state,calls,auth,reviews:new PostgresReviewDecisions({domainOutbox:outbox,authorizeDecision:async c=>{auth.push(c);return authorizeDecision(c);}})};
}

test('V130 approval records the decision, moves the event to APPROVED and queues exactly one writeback',async()=>{
  const f=fixture(),r=await f.reviews.decide(approve);
  assert.equal(r.status,'DECIDED');assert.equal(r.replayed,false);assert.equal(r.matterId,matterId);assert.equal(r.resultJobId,resultJobId);
  assert.equal(f.state.event.status,'APPROVED');assert.equal(f.state.decisions.length,1);assert.equal(f.state.decisions[0].decided_by,userId);
  assert.deepEqual(f.state.intents,[{tenantId,jobId:writebackJobId(tenantId,eventId),kind:'PROCLAIM_WRITEBACK',objectId:eventId,traceId:'trace-v130',idempotencyKey:`review-writeback:${eventId}`}]);
  assert.equal(f.auth.length,1);assert.equal(f.auth[0].operation,'REVIEW_DECISION');assert.equal(f.auth[0].resultHash,sha('result'));
});
test('V130 rejection records the decision and queues nothing',async()=>{
  const f=fixture(),r=await f.reviews.decide(reject);
  assert.equal(r.decision,'REJECT');assert.equal(r.writebackJobId,null);assert.equal(f.state.event.status,'REJECTED');assert.equal(f.state.intents.length,0);assert.equal(f.state.decisions[0].matter_id,null);
});
test('V130 the identical decision replays without a second row, transition or writeback',async()=>{
  const f=fixture();await f.reviews.decide(approve);const r=await f.reviews.decide(approve);
  assert.equal(r.replayed,true);assert.equal(f.state.decisions.length,1);assert.equal(f.state.intents.length,1);
  assert.equal(f.calls.filter(c=>c.sql?.startsWith('UPDATE')).length,1);
});
test('V130 any changed decision, matter, trace or key for a decided event is a conflict',async()=>{
  for(const change of [{decision:'REJECT',matterId:undefined},{matterId:id(77)},{traceId:'other-trace'},{decisionKey:'approve-2'}]){
    const f=fixture({mutate:s=>{s.matter=s.matter;}});await f.reviews.decide(approve);
    const next={...approve,...change};if(next.matterId===undefined)delete next.matterId;
    await assert.rejects(f.reviews.decide(next),/REVIEW_DECISION_CONFLICT/);assert.equal(f.state.decisions.length,1);assert.equal(f.state.event.status,'APPROVED');
  }
  const g=fixture();await g.reviews.decide(approve);
  await assert.rejects(g.reviews.decide({...approve,eventId:id(88)}),/FORBIDDEN|CONFLICT/);
});
test('V130 only an active USER in an active tenant can decide - never a service identity',async()=>{
  for(const [actorId,mutate] of [[serviceId,()=>{}],[userId,s=>s.actors[0].status='DISABLED'],[userId,s=>s.actors[0].tenant_status='SUSPENDED'],[userId,s=>s.actors[0].tenant_id=id(99)],[id(98),()=>{}]]){
    const f=fixture({mutate});await assert.rejects(f.reviews.decide({...approve,actorId}),/FORBIDDEN/);assert.equal(f.state.decisions.length,0);assert.equal(f.state.event.status,'PROCESSED');
  }
});
test('V130 an event that was never adopted, or is missing, cannot be decided',async()=>{
  for(const mutate of [s=>s.results=[],s=>s.event.status='RECEIVED',s=>s.event=null,s=>s.event.event_type='OTHER',s=>s.results.push({...s.results[0],job_id:id(97)})]){
    const f=fixture({mutate});await assert.rejects(f.reviews.decide(approve),/FORBIDDEN/);assert.equal(f.state.decisions.length,0);
  }
});
test('V130 approval needs a visible open matter; rejection does not take one',async()=>{
  for(const mutate of [s=>s.matter.status='CLOSED',s=>s.matter=null,s=>s.matter.tenant_id=id(99)]){const f=fixture({mutate});await assert.rejects(f.reviews.decide(approve),/FORBIDDEN/);assert.equal(f.state.decisions.length,0);}
  await assert.rejects(fixture().reviews.decide({...reject,matterId}),/INPUT_INVALID/);
  await assert.rejects(fixture().reviews.decide({...approve,matterId:undefined}),/INPUT_INVALID/);
});
test('V130 current authority is required for first decisions and replays, and provider errors stay sanitized',async()=>{
  const f=fixture({authorizeDecision:async()=>false});await assert.rejects(f.reviews.decide(approve),/REVIEW_DECISION_FORBIDDEN/);assert.equal(f.state.decisions.length,0);
  let allowed=true;const g=fixture({authorizeDecision:async()=>allowed});await g.reviews.decide(approve);allowed=false;await assert.rejects(g.reviews.decide(approve),/FORBIDDEN/);
  const h=fixture({authorizeDecision:async()=>{throw new Error('SECRET_DIRECTORY_DETAIL');}});await assert.rejects(h.reviews.decide(approve),e=>e.message==='REVIEW_DECISION_AUTHORIZATION_UNAVAILABLE');
});
test('V130 unsafe grants, combined result-writer membership or disabled triggers stop before any read',async()=>{
  for(const options of [{grants:false},{triggers:false}]){const f=fixture(options);await assert.rejects(f.reviews.decide(approve),/REVIEW_DECISION_UNAVAILABLE/);
    assert.equal(f.calls.some(c=>c.sql?.includes('FROM public.inbound_events')),false);assert.equal(f.state.decisions.length,0);}
});
test('V130 a failed transition or writeback enqueue rolls the whole decision back',async()=>{
  for(const options of [{changeFails:true},{enqueueFails:true}]){const f=fixture(options);await assert.rejects(f.reviews.decide(approve),/UNAVAILABLE/);assert.equal(f.state.decisions.length,0);assert.equal(f.state.event.status,'PROCESSED');assert.equal(f.state.intents.length,0);}
});
test('V130 an unknown commit outcome is reported as ambiguous, never as success or failure',async()=>{
  const f=fixture({unknownCommit:true});await assert.rejects(f.reviews.decide(approve),/REVIEW_DECISION_COMMIT_OUTCOME_UNKNOWN/);
});
test('V130 input is checked before a transaction opens',async()=>{
  const f=fixture();
  for(const change of [{tenantId:'bad'},{actorId:'bad'},{eventId:'bad'},{decision:'MAYBE'},{decisionKey:''},{decisionKey:'has space'},{traceId:'x'.repeat(300)},{extra:true}])
    await assert.rejects(f.reviews.decide({...approve,...change}),/INPUT_INVALID/);
  assert.equal(f.calls.length,0);
  assert.throws(()=>new PostgresReviewDecisions({}),/CONFIGURATION_INVALID/);
});
test('V130 keys, job ids and request hashes are tenant-bound, stable and change with any decision field',()=>{
  assert.notEqual(decisionKeyHash(tenantId,'k'),decisionKeyHash(id(9),'k'));
  assert.equal(writebackJobId(tenantId,eventId),writebackJobId(tenantId,eventId));assert.notEqual(writebackJobId(tenantId,eventId),writebackJobId(id(9),eventId));
  assert.match(writebackJobId(tenantId,eventId),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const b={...normalizeReviewDecision(approve),resultJobId,resultHash:sha('result'),writebackJobId:writebackJobId(tenantId,eventId)};
  for(const change of [{decision:'REJECT'},{matterId:id(70)},{actorId:id(71)},{resultHash:sha('other')},{resultJobId:id(72)},{traceId:'other'}])assert.notEqual(reviewRequestHash({...b,...change}),reviewRequestHash(b));
});
