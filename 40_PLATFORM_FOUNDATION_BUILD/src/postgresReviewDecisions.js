import crypto from 'node:crypto';
import {REVIEW_FUNCTION_HASHES,REVIEW_SCOPE_FUNCTION_HASH} from './postgresReviewFunctionHashes.js';
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
const KEYS=['tenantId','actorId','eventId','decision','matterId','decisionKey','traceId','signal','expectedResultJobId','expectedResultHash'];
const registered=new WeakSet();
export const isPostgresReviewDecisions=value=>registered.has(value);
function signalCheck(signal){if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw invalid();}
function active(signal){if(signal?.aborted)throw unavailable();}

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
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).some(k=>!KEYS.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)??{},'value')))throw invalid();
  signalCheck(input.signal);
  const hasJob=Object.hasOwn(input,'expectedResultJobId'),hasHash=Object.hasOwn(input,'expectedResultHash');
  if(hasJob!==hasHash||hasHash&&(typeof input.expectedResultHash!=='string'||!HEX.test(input.expectedResultHash)))throw invalid();
  const pinned=hasJob?{expectedResultJobId:uuid(input.expectedResultJobId),expectedResultHash:input.expectedResultHash}:{};
  const tenantId=uuid(input.tenantId),actorId=uuid(input.actorId),eventId=uuid(input.eventId);
  if(!['APPROVE','REJECT'].includes(input.decision))throw invalid();
  const decision=input.decision;
  const matterId=decision==='APPROVE'?uuid(input.matterId):(input.matterId===undefined||input.matterId===null?null:(()=>{throw invalid();})());
  return Object.freeze({tenantId,actorId,eventId,decision,matterId,decisionKey:identifier(input.decisionKey),traceId:identifier(input.traceId),...pinned});
}

const columns={tenantId:'tenant_id',eventId:'event_id',resultJobId:'result_job_id',resultHash:'result_hash',decision:'decision',matterId:'matter_id',actorId:'decided_by',keyHash:'decision_key_hash',requestHash:'request_hash',writebackJobId:'writeback_job_id'};
function matches(row,b){return row&&Object.entries(columns).every(([k,col])=>row[col]===b[k]);}
function receipt(b,replayed){
  return Object.freeze({tenantId:b.tenantId,eventId:b.eventId,decision:b.decision,matterId:b.matterId,resultJobId:b.resultJobId,resultHash:b.resultHash,writebackJobId:b.writebackJobId,status:'DECIDED',replayed});
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
    AND has_table_privilege(current_user,'public.inbound_events','SELECT')
    AND NOT has_table_privilege(current_user,'public.inbound_events','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege(current_user,'public.inbound_events','INSERT')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.inbound_events'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname='status'))
    AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
      AND c.relname NOT IN ('domain_review_decisions','domain_outbox_events','inbound_events')
      AND (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE')))
    AND row_security_active('public.domain_review_decisions'::regclass)
    AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.domain_review_decisions'::regclass) AS grants_safe`);
  if(result.rows.length!==1||result.rows[0].grants_safe!==true)throw unavailable();
  const functions=(await tx.query("SELECT p.proname,p.prosecdef,p.proconfig,p.pronargs,p.prorettype='pg_catalog.trigger'::regtype AS returns_trigger,pg_has_role(current_user,p.proowner,'MEMBER') AS owned,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS source_hash,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1::text[])",[Object.keys(REVIEW_FUNCTION_HASHES)])).rows;
  if(functions.length!==2||new Set(functions.map(f=>f.proname)).size!==2||functions.some(f=>REVIEW_FUNCTION_HASHES[f.proname]!==f.source_hash||f.owned!==false||f.prosecdef!==false||f.pronargs!==0||f.returns_trigger!==true||f.public_execute!==false||JSON.stringify(f.proconfig)!==JSON.stringify(['search_path=pg_catalog'])))throw unavailable();
  const scope=(await tx.query("SELECT p.proname,p.prosecdef,p.proconfig,p.pronargs,p.proargtypes::text AS args,p.prorettype='pg_catalog.bool'::regtype AS returns_boolean,pg_has_role(current_user,p.proowner,'MEMBER') AS owned,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS source_hash,has_function_privilege(current_user,p.oid,'EXECUTE') AS executable,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='review_security'")).rows;
  if(scope.length!==1||scope[0].proname!=='lock_scope'||scope[0].owned!==false||scope[0].prosecdef!==true||scope[0].pronargs!==3||scope[0].args!=='2950 2950 2950'||scope[0].returns_boolean!==true||scope[0].executable!==true||scope[0].public_execute!==false||scope[0].source_hash!==REVIEW_SCOPE_FUNCTION_HASH||JSON.stringify(scope[0].proconfig)!==JSON.stringify(['search_path=pg_catalog','row_security=on']))throw unavailable();
  const triggers=(await tx.query(`SELECT t.tgname,t.tgtype,t.tgenabled,t.tgdeferrable,t.tginitdeferred,t.tgqual IS NULL AS unqualified,t.tgnargs,
    ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr) ORDER BY a.attnum) AS columns,p.proname,pn.nspname AS function_schema,c.relname
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND t.tgname=ANY($1::text[]) AND NOT t.tgisinternal`,[['domain_review_decision_binding','inbound_review_transition']])).rows;
  const expected={domain_review_decision_binding:['domain_review_decisions','check_domain_review_decision',5,true,[]],inbound_review_transition:['inbound_events','check_inbound_review_transition',19,false,['status']]};
  if(triggers.length!==2||new Set(triggers.map(t=>t.tgname)).size!==2||triggers.some(t=>{const e=expected[t.tgname];return !e||t.relname!==e[0]||t.proname!==e[1]||t.function_schema!=='public'||t.tgtype!==e[2]||t.tgdeferrable!==e[3]||t.tginitdeferred!==e[3]||t.unqualified!==true||t.tgnargs!==0||JSON.stringify(t.columns)!==JSON.stringify(e[4])||!['O','A'].includes(t.tgenabled);}))throw unavailable();
  const policies=(await tx.query("SELECT policyname,cmd,roles::text[] AS roles,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename='domain_review_decisions'")).rows;
  const expr=v=>typeof v==='string'?v.replaceAll('public.','').replace(/\s+/g,'').replace(/[()]/g,''):null;
  if(policies.length!==3||new Set(policies.map(p=>p.policyname)).size!==3||policies.some(p=>JSON.stringify(p.roles)!==JSON.stringify([p.policyname==='domain_decision_human_read'?'legaltech_review_reader':'legaltech_domain_reviewer'])||(['domain_review_read','domain_decision_human_read'].includes(p.policyname)?(p.cmd!=='SELECT'||expr(p.qual)!=='tenant_id=app_current_tenant_id'||p.with_check!==null):p.policyname==='domain_review_append'?(p.cmd!=='INSERT'||p.qual!==null||expr(p.with_check)!=='tenant_id=app_current_tenant_idANDdecided_by=app_current_actor_id'):true)))throw unavailable();
}

export class PostgresReviewDecisions {
  #outbox;#authorize;
  constructor({domainOutbox,authorizeDecision}={}){
    if(typeof domainOutbox?.run!=='function'||typeof authorizeDecision!=='function')throw new Error('REVIEW_DECISION_CONFIGURATION_INVALID');
    this.#outbox=Object.freeze({run:domainOutbox.run.bind(domainOutbox)});this.#authorize=authorizeDecision;registered.add(this);Object.freeze(this);
  }
  async probe({signal}={}){
    signalCheck(signal);try{await this.#outbox.run({tenantId:'00000000-0000-0000-0000-000000000000',actorId:'00000000-0000-0000-0000-000000000000',signal},async tx=>{active(tx.signal);await posture(tx);active(tx.signal);});return Object.freeze({ok:true,code:'REVIEW_STORE_VERIFIED'});}catch{return Object.freeze({ok:false,code:'REVIEW_STORE_UNVERIFIED'});}
  }
  async decide(input){
    const r=normalizeReviewDecision(input),signal=input.signal;
    active(signal);
    const keyHash=decisionKeyHash(r.tenantId,r.decisionKey),wbJob=r.decision==='APPROVE'?writebackJobId(r.tenantId,r.eventId):null;
    let failure;
    try{return await this.#outbox.run({tenantId:r.tenantId,actorId:r.actorId,signal},async tx=>{
      try{
        active(tx.signal);await posture(tx);active(tx.signal);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['review-decision-v130',r.tenantId,r.eventId])]);
        await lockScope(tx,r,null);
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
        if(adopted.kind!=='PROCESS_INBOUND'||adopted.tenant_id!==r.tenantId||adopted.object_id!==r.eventId||!HEX.test(adopted.result_hash)||!UUID.test(adopted.job_id))throw unavailable();
        if(r.expectedResultJobId!==undefined&&(r.expectedResultJobId!==adopted.job_id||r.expectedResultHash!==adopted.result_hash))throw conflict();
        const b=Object.freeze({...r,keyHash,resultJobId:adopted.job_id,resultHash:adopted.result_hash,writebackJobId:wbJob});
        const requestHash=reviewRequestHash(b),bound=Object.freeze({...b,requestHash});
        const gate=async phase=>{
          active(tx.signal);let allowed;
          try{allowed=await this.#authorize(Object.freeze({tenantId:b.tenantId,actorId:b.actorId,eventId:b.eventId,decision:b.decision,matterId:b.matterId,resultJobId:b.resultJobId,resultHash:b.resultHash,operation:'REVIEW_DECISION',phase,signal:tx.signal}));}catch{throw new Error('REVIEW_DECISION_AUTHORIZATION_UNAVAILABLE');}
          active(tx.signal);if(allowed!==true)throw forbidden();
        };
        await gate('ADMIT');
        const prior=await tx.query('SELECT * FROM public.domain_review_decisions WHERE tenant_id=$1::uuid AND (event_id=$2::uuid OR decision_key_hash=$3)',[r.tenantId,r.eventId,keyHash]);
        if(prior.rows.length){
          // Replay only the identical decision under the identical key; anything else is a conflict.
          if(prior.rows.length!==1||!matches(prior.rows[0],bound))throw conflict();
          if(event.status!==(b.decision==='APPROVE'?'APPROVED':'REJECTED'))throw unavailable();
          if(b.decision==='APPROVE'){await openMatter(tx,r);await tx.enqueue(writebackIntent(b));}
          await gate('COMMIT');return receipt(b,true);
        }
        if(event.status!=='PROCESSED')throw forbidden();
        if(b.decision==='APPROVE')await openMatter(tx,r);
        const saved=await tx.query(`INSERT INTO public.domain_review_decisions(tenant_id,event_id,result_job_id,result_hash,decision,matter_id,decided_by,decision_key_hash,request_hash,writeback_job_id)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7::uuid,$8,$9,$10::uuid) RETURNING *`,
          [b.tenantId,b.eventId,b.resultJobId,b.resultHash,b.decision,b.matterId,b.actorId,keyHash,requestHash,b.writebackJobId]);
        if(saved.rows.length!==1||!matches(saved.rows[0],bound))throw unavailable();
        const next=b.decision==='APPROVE'?'APPROVED':'REJECTED';
        const changed=await tx.query("UPDATE public.inbound_events SET status=$3 WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='PROCESSED' RETURNING id,status",[r.tenantId,r.eventId,next]);
        if(changed.rows.length!==1||changed.rows[0].id!==r.eventId||changed.rows[0].status!==next)throw unavailable();
        if(b.decision==='APPROVE')await tx.enqueue(writebackIntent(b));
        await gate('COMMIT');return receipt(b,false);
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

async function openMatter(tx,r){
  await lockScope(tx,r,r.matterId);
  const matter=await tx.query('SELECT id,tenant_id,status FROM public.matters WHERE tenant_id=$1::uuid AND id=$2::uuid',[r.tenantId,r.matterId]);
  if(matter.rows.length!==1||matter.rows[0].id!==r.matterId||matter.rows[0].tenant_id!==r.tenantId||matter.rows[0].status!=='OPEN')throw forbidden();
}

async function lockScope(tx,r,matterId){
  const result=await tx.query('SELECT review_security.lock_scope($1::uuid,$2::uuid,$3::uuid) AS locked',[r.tenantId,r.actorId,matterId]);
  if(result.rows.length!==1||result.rows[0].locked!==true)throw forbidden();
}
