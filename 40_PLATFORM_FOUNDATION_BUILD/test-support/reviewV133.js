// Synthetic transaction/catalog fixture only; actual PostgreSQL integration is required.
import crypto from 'node:crypto';
import {PostgresReviewDecisions} from '../src/postgresReviewDecisions.js';
import {REVIEW_FUNCTION_HASHES,REVIEW_SCOPE_FUNCTION_HASH} from '../src/postgresReviewFunctionHashes.js';
export const id=n=>`13010000-0000-4000-8000-${String(n).padStart(12,'0')}`,tenantId=id(1),userId=id(2),serviceId=id(3),eventId=id(4),matterId=id(5),resultJobId=id(6);
export const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
export const approve={tenantId,actorId:userId,eventId,decision:'APPROVE',matterId,decisionKey:'approve-1',traceId:'trace-v130'};
export const reject={tenantId,actorId:userId,eventId,decision:'REJECT',decisionKey:'reject-1',traceId:'trace-v130'};

export function reviewFixture({authorizeDecision=async()=>true,grants=true,triggers=true,unknownCommit=false,changeFails=false,enqueueFails=false,mutate=()=>{},catalogMutate=()=>{}}={}){
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
        if(sql.includes('FROM pg_trigger')){const rows=triggers?[{tgname:'domain_review_decision_binding',relname:'domain_review_decisions',proname:'check_domain_review_decision',function_schema:'public',tgtype:5,tgenabled:'O',tgdeferrable:true,tginitdeferred:true,unqualified:true,tgnargs:0,columns:[]},{tgname:'inbound_review_transition',relname:'inbound_events',proname:'check_inbound_review_transition',function_schema:'public',tgtype:19,tgenabled:'O',tgdeferrable:false,tginitdeferred:false,unqualified:true,tgnargs:0,columns:['status']}]:[];catalogMutate('triggers',rows);return {rows};}
        if(sql.includes("n.nspname='review_security'")){const rows=[{proname:'lock_scope',owned:false,prosecdef:true,pronargs:3,args:'2950 2950 2950',returns_boolean:true,executable:true,public_execute:false,source_hash:REVIEW_SCOPE_FUNCTION_HASH,proconfig:['search_path=pg_catalog','row_security=on']}];catalogMutate('scope',rows);return {rows};}
        if(sql.includes('review_security.lock_scope'))return {rows:[{locked:true}]};
        if(sql.includes('FROM pg_proc')){const rows=Object.entries(REVIEW_FUNCTION_HASHES).map(([proname,source_hash])=>({proname,source_hash,owned:false,prosecdef:false,pronargs:0,returns_trigger:true,public_execute:false,proconfig:['search_path=pg_catalog']}));catalogMutate('functions',rows);return {rows};}
        if(sql.includes('FROM pg_policies')){const rows=[{policyname:'domain_review_read',cmd:'SELECT',roles:['legaltech_domain_reviewer'],qual:'(tenant_id=app_current_tenant_id())',with_check:null},{policyname:'domain_review_append',cmd:'INSERT',roles:['legaltech_domain_reviewer'],qual:null,with_check:'((tenant_id=app_current_tenant_id()) AND (decided_by=app_current_actor_id()))'}];catalogMutate('policies',rows);return {rows};}
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
