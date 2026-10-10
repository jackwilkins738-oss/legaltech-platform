import crypto from 'node:crypto';
import {canonicalAuditPayload} from './securityMonitoring.js';

// V130: the durable human review decision on an adopted inbound result
// (migration 056). One immutable decision per event, by an active USER, bound
// to the exact adopted result hash. APPROVE names an open matter and queues one
// PROCLAIM_WRITEBACK outbox intent for the event in the SAME transaction;
// REJECT queues nothing. A decision does not prove any external write - the
// writeback job is executed and reconciled separately.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/;
const HEX=/^[a-f0-9]{64}$/;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const unavailable=()=>new Error('REVIEW_DECISION_UNAVAILABLE');
const forbidden=()=>new Error('REVIEW_DECISION_FORBIDDEN');
const conflict=()=>new Error('REVIEW_DECISION_CONFLICT');
const invalid=()=>new Error('REVIEW_DECISION_INPUT_INVALID');
const KEYS=['tenantId','actorId','eventId','decision','matterId','decisionKey','traceId','signal'];

function uuid(v){if(typeof v!=='string'||!UUID.test(v))throw invalid();return v.toLowerCase();}
function identifier(v){if(typeof v!=='string'||!ID.test(v))throw invalid();return v;}

/** The decision key's stored form: tenant-scoped, so one key can never name another tenant's decision. */
export const decisionKeyHash=(tenantId,key)=>sha(JSON.stringify(['review-decision-v130',tenantId,key]));

/** A stable writeback job id for one event: a replayed approval always names the same job. */
export function writebackJobId(tenantId,eventId){
  const h=sha(JSON.stringify(['review-writeback-job-v130',tenantId,eventId]));
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${(8|(parseInt(h[16],16)&3)).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
}

/** Everything a decision means, hashed - a replay must match it exactly. */
export function reviewRequestHash(b){
  return sha(canonicalAuditPayload({v:'review-decision-v130',tenantId:b.tenantId,eventId:b.eventId,decision:b.decision,matterId:b.matterId,
    decidedBy:b.actorId,resultJobId:b.resultJobId,resultHash:b.resultHash,writebackJobId:b.writebackJobId,traceHash:sha(b.traceId)}));
}

export function normalizeReviewDecision(input){
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).some(k=>!KEYS.includes(k)))throw invalid();
  const tenantId=uuid(input.tenantId),actorId=uuid(input.actorId),eventId=uuid(input.eventId);
  if(!['APPROVE','REJECT'].includes(input.decision))throw invalid();
  const decision=input.decision;
  const matterId=decision==='APPROVE'?uuid(input.matterId):(input.matterId===undefined||input.matterId===null?null:(()=>{throw invalid();})());
  return Object.freeze({tenantId,actorId,eventId,decision,matterId,decisionKey:identifier(input.decisionKey),traceId:identifier(input.traceId)});
}

const columns={tenantId:'tenant_id',eventId:'event_id',resultJobId:'result_job_id',resultHash:'result_hash',decision:'decision',matterId:'matter_id',actorId:'decided_by',keyHash:'decision_key_hash',requestHash:'request_hash',writebackJobId:'writeback_job_id'};
function matches(row,b){return row&&Object.entries(columns).every(([k,col])=>row[col]===b[k]);}
function receipt(b,replayed){
  return Object.freeze({tenantId:b.tenantId,eventId:b.eventId,decision:b.decision,matterId:b.matterId,resultJobId:b.resultJobId,writebackJobId:b.writebackJobId,status:'DECIDED',replayed});
}

// The posture this principal must hold: the reviewer group, append-only
// decisions with exactly the decided_at/generated columns withheld, forced RLS,
// and NONE of the result-writer or command-author groups (separation of duties).
async function posture(tx){
  const result=await tx.query(`SELECT pg_has_role(current_user,'legaltech_domain_reviewer','MEMBER')
    AND NOT pg_has_role(current_user,'legaltech_domain_result_writer','MEMBER')
    AND NOT pg_has_role(current_user,'legaltech_domain_commands','MEMBER')
    AND has_table_privilege(current_user,'public.domain_review_decisions','SELECT')
    AND NOT has_table_privilege(current_user,'public.domain_review_decisions','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege(current_user,'public.domain_review_decisions','UPDATE')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.domain_review_decisions'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY['tenant_id','event_id','result_job_id','result_hash','decision','matter_id','decided_by','decision_key_hash','request_hash','writeback_job_id']::name[])))
    AND NOT has_table_privilege(current_user,'public.domain_job_results','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'public.domain_job_results','INSERT,UPDATE')
    AND row_security_active('public.domain_review_decisions'::regclass)
    AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.domain_review_decisions'::regclass) AS grants_safe`);
  if(result.rows.length!==1||result.rows[0].grants_safe!==true)throw unavailable();
  const triggers=await tx.query(`SELECT t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND ((c.relname='domain_review_decisions' AND t.tgname='domain_review_decision_binding') OR (c.relname='inbound_events' AND t.tgname='inbound_review_transition')) AND NOT t.tgisinternal`);
  if(triggers.rows.length!==2||!triggers.rows.some(r=>r.tgname==='domain_review_decision_binding'&&r.tgdeferrable===true&&r.tginitdeferred===true)
    ||!triggers.rows.some(r=>r.tgname==='inbound_review_transition')||triggers.rows.some(r=>!['O','A'].includes(r.tgenabled)))throw unavailable();
}

export class PostgresReviewDecisions {
  #outbox;#authorize;
  constructor({domainOutbox,authorizeDecision}={}){
    if(typeof domainOutbox?.run!=='function'||typeof authorizeDecision!=='function')throw new Error('REVIEW_DECISION_CONFIGURATION_INVALID');
    this.#outbox=Object.freeze({run:domainOutbox.run.bind(domainOutbox)});this.#authorize=authorizeDecision;
  }
  async decide(input){
    const r=normalizeReviewDecision(input),signal=input.signal;
    const keyHash=decisionKeyHash(r.tenantId,r.decisionKey),wbJob=r.decision==='APPROVE'?writebackJobId(r.tenantId,r.eventId):null;
    let failure;
    try{return await this.#outbox.run({tenantId:r.tenantId,actorId:r.actorId,signal},async tx=>{
      try{
        await posture(tx);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-decision-v130',r.tenantId,r.eventId])]);
        const identity=await tx.query(`SELECT a.id,a.tenant_id,a.actor_type,a.status,t.status AS tenant_status FROM public.actors a JOIN public.tenants t ON t.id=a.tenant_id
          WHERE a.tenant_id=$1::uuid AND a.id=$2::uuid`,[r.tenantId,r.actorId]);
        const who=identity.rows[0];
        if(identity.rows.length!==1||who.id!==r.actorId||who.tenant_id!==r.tenantId||who.actor_type!=='USER'||who.status!=='ACTIVE'||who.tenant_status!=='ACTIVE')throw forbidden();
        const events=await tx.query('SELECT id,tenant_id,event_type,status FROM public.inbound_events WHERE tenant_id=$1::uuid AND id=$2::uuid FOR UPDATE',[r.tenantId,r.eventId]);
        const event=events.rows[0];
        if(events.rows.length!==1||event.id!==r.eventId||event.tenant_id!==r.tenantId||event.event_type!=='INBOUND_DOCUMENT')throw forbidden();
        const results=await tx.query("SELECT tenant_id,job_id,kind,object_id,result_hash FROM public.domain_job_results WHERE tenant_id=$1::uuid AND object_id=$2::uuid AND kind='PROCESS_INBOUND'",[r.tenantId,r.eventId]);
        if(results.rows.length!==1)throw forbidden();
        const adopted=results.rows[0];
        if(adopted.tenant_id!==r.tenantId||adopted.object_id!==r.eventId||!HEX.test(adopted.result_hash)||!UUID.test(adopted.job_id))throw unavailable();
        const b=Object.freeze({...r,keyHash,resultJobId:adopted.job_id,resultHash:adopted.result_hash,writebackJobId:wbJob});
        const requestHash=reviewRequestHash(b),bound=Object.freeze({...b,requestHash});
        let allowed;
        try{allowed=await this.#authorize(Object.freeze({tenantId:b.tenantId,actorId:b.actorId,eventId:b.eventId,decision:b.decision,matterId:b.matterId,
          resultJobId:b.resultJobId,resultHash:b.resultHash,operation:'REVIEW_DECISION',signal:tx.signal}));}catch{throw new Error('REVIEW_DECISION_AUTHORIZATION_UNAVAILABLE');}
        if(allowed!==true)throw forbidden();
        const prior=await tx.query('SELECT * FROM public.domain_review_decisions WHERE tenant_id=$1::uuid AND (event_id=$2::uuid OR decision_key_hash=$3)',[r.tenantId,r.eventId,keyHash]);
        if(prior.rows.length){
          // Replay only the identical decision under the identical key; anything else is a conflict.
          if(prior.rows.length!==1||!matches(prior.rows[0],bound))throw conflict();
          if(event.status!==(b.decision==='APPROVE'?'APPROVED':'REJECTED'))throw unavailable();
          if(b.decision==='APPROVE')await tx.enqueue(writebackIntent(b));
          return receipt(b,true);
        }
        if(event.status!=='PROCESSED')throw forbidden();
        if(b.decision==='APPROVE'){
          const matter=await tx.query('SELECT id,tenant_id,status FROM public.matters WHERE tenant_id=$1::uuid AND id=$2::uuid',[r.tenantId,b.matterId]);
          if(matter.rows.length!==1||matter.rows[0].id!==b.matterId||matter.rows[0].tenant_id!==r.tenantId||matter.rows[0].status!=='OPEN')throw forbidden();
        }
        const saved=await tx.query(`INSERT INTO public.domain_review_decisions(tenant_id,event_id,result_job_id,result_hash,decision,matter_id,decided_by,decision_key_hash,request_hash,writeback_job_id)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid,$8,$9,$10::uuid) RETURNING *`,
          [b.tenantId,b.eventId,b.resultJobId,b.resultHash,b.decision,b.matterId,b.actorId,keyHash,requestHash,b.writebackJobId]);
        if(saved.rows.length!==1||!matches(saved.rows[0],bound))throw unavailable();
        const next=b.decision==='APPROVE'?'APPROVED':'REJECTED';
        const changed=await tx.query("UPDATE public.inbound_events SET status=$3 WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='PROCESSED' RETURNING id,status",[r.tenantId,r.eventId,next]);
        if(changed.rows.length!==1||changed.rows[0].id!==r.eventId||changed.rows[0].status!==next)throw unavailable();
        if(b.decision==='APPROVE')await tx.enqueue(writebackIntent(b));
        return receipt(b,false);
      }catch(error){failure=error;throw error;}
    });}catch(error){
      if(error?.message==='OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN')throw new Error('REVIEW_DECISION_COMMIT_OUTCOME_UNKNOWN');
      if(failure&&['REVIEW_DECISION_FORBIDDEN','REVIEW_DECISION_CONFLICT','REVIEW_DECISION_AUTHORIZATION_UNAVAILABLE'].includes(failure.message))throw failure;
      throw unavailable();
    }
  }
}

// One writeback per event: the idempotency key names the event, so a second
// approval path can never queue a second write for the same document.
function writebackIntent(b){
  return {tenantId:b.tenantId,jobId:b.writebackJobId,kind:'PROCLAIM_WRITEBACK',objectId:b.eventId,traceId:b.traceId,idempotencyKey:`review-writeback:${b.eventId}`};
}
