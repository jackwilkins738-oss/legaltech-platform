import fs from 'node:fs';
import {PostgresTenantTransactions} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';
import {ReviewCursorCodec} from './reviewCursor.js';
const runtimeSql=fs.readFileSync(new URL('../../30_PRODUCTION_SHAPE_SCAFFOLD/db/verification/runtime_security.sql',import.meta.url),'utf8');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,HEX=/^[a-f0-9]{64}$/;
const registered=new WeakSet(),fail=code=>new Error(`REVIEW_READ_${code}`);
export const isPostgresReviewReader=v=>registered.has(v);
const columns=Object.freeze({tenants:['id','status'],actors:['id','tenant_id','actor_type','status'],inbound_events:['id','tenant_id','event_type','status'],domain_job_results:['tenant_id','job_id','kind','object_id','result_hash','result_code','artifact_hash'],domain_review_decisions:['tenant_id','event_id','result_job_id','result_hash','decision','matter_id','writeback_job_id']});
export function reviewReadInput(value,detail=false){
  const keys=detail?['tenantId','actorId','eventId']:['tenantId','actorId','status','limit','cursor'];
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).some(k=>!keys.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value'))||typeof value.tenantId!=='string'||!UUID.test(value.tenantId)||typeof value.actorId!=='string'||!UUID.test(value.actorId)||detail&&(typeof value.eventId!=='string'||!UUID.test(value.eventId)))throw fail('INPUT_INVALID');
  if(detail)return Object.freeze({...value});const status=value.status??'PENDING',limit=value.limit??25,cursor=value.cursor??null;
  if(!['PENDING','DECIDED','ALL'].includes(status)||!Number.isInteger(limit)||limit<1||limit>100||cursor!==null&&(typeof cursor!=='string'||cursor.length>1600))throw fail('INPUT_INVALID');return Object.freeze({tenantId:value.tenantId,actorId:value.actorId,status,limit,cursor});
}
function check(signal){if(signal?.aborted)throw fail('UNAVAILABLE');}
function signalCheck(signal){if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal.addEventListener!=='function'||typeof signal.removeEventListener!=='function'))throw fail('INPUT_INVALID');}
function item(row,r){
  if(row.tenant_id!==r.tenantId||!UUID.test(row.event_id)||!UUID.test(row.job_id)||!HEX.test(row.result_hash)||!HEX.test(row.artifact_hash)||!/^([A-Z][A-Z0-9_]{0,63})$/.test(row.result_code)||!['PROCESSED','APPROVED','REJECTED'].includes(row.status))throw fail('UNAVAILABLE');
  const pending=row.status==='PROCESSED';if(pending?(row.decision!==null||row.matter_id!==null||row.writeback_job_id!==null||row.decision_job_id!==null||row.decision_result_hash!==null):
    row.decision!==(row.status==='APPROVED'?'APPROVE':'REJECT')||row.decision_job_id!==row.job_id||row.decision_result_hash!==row.result_hash||row.status==='APPROVED'&&(!UUID.test(row.matter_id)||!UUID.test(row.writeback_job_id))||row.status==='REJECTED'&&(row.matter_id!==null||row.writeback_job_id!==null))throw fail('UNAVAILABLE');
  return Object.freeze({eventId:row.event_id,status:row.status,resultJobId:row.job_id,resultHash:row.result_hash,resultCode:row.result_code,artifactHash:row.artifact_hash,decision:row.decision,matterId:row.matter_id,writebackJobId:row.writeback_job_id});
}
const select=`SELECT e.tenant_id,e.id AS event_id,e.status,r.job_id,r.result_hash,r.result_code,r.artifact_hash,d.decision,d.matter_id,d.writeback_job_id,d.result_job_id AS decision_job_id,d.result_hash AS decision_result_hash
  FROM public.inbound_events e JOIN public.domain_job_results r ON r.tenant_id=e.tenant_id AND r.object_id=e.id AND r.kind='PROCESS_INBOUND'
  LEFT JOIN public.domain_review_decisions d ON d.tenant_id=e.tenant_id AND d.event_id=e.id
  WHERE e.tenant_id=$1::uuid AND e.event_type='INBOUND_DOCUMENT' AND e.status IN ('PROCESSED','APPROVED','REJECTED')`;
export class PostgresReviewReader {
  #transactions;#role;#authorize;#cursor;#connections=new Set();
  constructor({pool,expectedRole,authorizeRead,cursorKey,cursorTtlMs,now,timeoutMs=5000}={}){
    if(typeof authorizeRead!=='function')throw fail('CONFIGURATION_INVALID');if(typeof pool?.connect!=='function')throw fail('CONFIGURATION_INVALID');const trackedPool={connect:()=>{const task=Promise.resolve().then(()=>pool.connect());this.#connections.add(task);task.finally(()=>this.#connections.delete(task)).catch(()=>{});return task;}};this.#transactions=new PostgresTenantTransactions({pool:trackedPool,expectedRole,timeoutMs});this.#role=expectedRole;this.#authorize=authorizeRead;this.#cursor=new ReviewCursorCodec({key:cursorKey,...(cursorTtlMs===undefined?{}:{ttlMs:cursorTtlMs}),...(now===undefined?{}:{now})});registered.add(this);Object.freeze(this);
  }
  async #posture(tx){
    await tx.query("SELECT set_config('verification.expected_role',$1,true),set_config('verification.schema','public',true)",[this.#role]);await tx.query(runtimeSql);
    const grants=(await tx.query(`SELECT pg_has_role(current_user,'legaltech_review_reader','MEMBER') AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname NOT IN (current_user,'legaltech_review_reader') AND pg_has_role(current_user,oid,'MEMBER'))
      AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE')))
      AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,c.oid,a.attnum,'SELECT')<>COALESCE(($1::jsonb->c.relname)?a.attname,false)) AS safe`,[JSON.stringify(columns)])).rows;
    if(grants.length!==1||grants[0].safe!==true)throw fail('UNAVAILABLE');
    const policies=(await tx.query("SELECT tablename,policyname,cmd,permissive,roles::text[] AS roles,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=ANY(ARRAY['actors','inbound_events','domain_job_results','domain_review_decisions']) AND ('legaltech_review_reader'=ANY(roles::text[]) OR 'public'=ANY(roles::text[]))")).rows;
    const expected={domain_result_human_read:'domain_job_results',domain_decision_human_read:'domain_review_decisions',tenant_isolation_actors:'actors',tenant_isolation_inbound_events:'inbound_events'};
    const expr=v=>typeof v==='string'?v.replaceAll('public.','').replace(/[()\s]/g,''):null;
    if(policies.length!==4||new Set(policies.map(p=>p.policyname)).size!==4||policies.some(p=>{const base=['actors','inbound_events'].includes(p.tablename);return expected[p.policyname]!==p.tablename||p.cmd!==(base?'ALL':'SELECT')||p.permissive!=='PERMISSIVE'||JSON.stringify(p.roles)!==JSON.stringify([base?'public':'legaltech_review_reader'])||expr(p.qual)!=='tenant_id=app_current_tenant_id'||(base?expr(p.with_check)!=='tenant_id=app_current_tenant_id':p.with_check!==null);}))throw fail('UNAVAILABLE');
  }
  async #identity(tx,r){check(tx.signal);const rows=(await tx.query("SELECT a.id FROM public.actors a JOIN public.tenants t ON t.id=a.tenant_id WHERE a.tenant_id=$1::uuid AND a.id=$2::uuid AND a.actor_type='USER' AND a.status='ACTIVE' AND t.status='ACTIVE'",[r.tenantId,r.actorId])).rows;if(rows.length!==1||rows[0].id!==r.actorId)throw fail('FORBIDDEN');}
  async #gate(r,phase,eventId,signal){check(signal);let result;try{result=await this.#authorize(Object.freeze({tenantId:r.tenantId,actorId:r.actorId,eventId,operation:'REVIEW_READ',phase,signal}));}catch{throw fail('UNAVAILABLE');}check(signal);return result===true;}
  async probe({signal}={}){signalCheck(signal);let workDone;try{await this.#transactions.run({tenantId:'00000000-0000-0000-0000-000000000000',actorId:'00000000-0000-0000-0000-000000000000',readOnly:true,signal},tx=>(workDone=this.#posture(tx)));return Object.freeze({ok:true,code:'REVIEW_READER_VERIFIED'});}catch{return Object.freeze({ok:false,code:'REVIEW_READER_UNVERIFIED'});}finally{await Promise.allSettled([...this.#connections,...(workDone?[workDone]:[])]);}}
  list(value,options={}){return this.#read(reviewReadInput(value),false,options);}
  get(value,options={}){return this.#read(reviewReadInput(value,true),true,options);}
  async #read(r,detail,{signal,beforeRelease}={}){signalCheck(signal);if(beforeRelease!==undefined&&typeof beforeRelease!=='function')throw fail('INPUT_INVALID');check(signal);let after=null;if(!detail&&r.cursor!==null)try{after=this.#cursor.decode(r.cursor,r);}catch{throw fail('INPUT_INVALID');}
    let failure,workDone;try{return await this.#transactions.run({...r,readOnly:true,signal},tx=>(workDone=(async()=>{try{
      await this.#posture(tx);await this.#identity(tx,r);if(!await this.#gate(r,'ADMIT',detail?r.eventId:null,tx.signal))throw fail('FORBIDDEN');
      const rows=(await tx.query(detail?select+' AND e.id=$2::uuid':select+" AND ($2::uuid IS NULL OR e.id>$2::uuid) AND ($3='ALL' OR ($3='PENDING' AND e.status='PROCESSED') OR ($3='DECIDED' AND e.status IN ('APPROVED','REJECTED'))) ORDER BY e.id LIMIT $4",detail?[r.tenantId,r.eventId]:[r.tenantId,after,r.status,r.limit])).rows;
      if(rows.length>(detail?1:r.limit)||new Set(rows.map(row=>row.event_id)).size!==rows.length)throw fail('UNAVAILABLE');
      const items=[];for(const row of rows){const output=item(row,r);if(!await this.#gate(r,'ITEM',output.eventId,tx.signal))continue;items.push(output);}
      if(beforeRelease){await beforeRelease(Object.freeze({itemCount:items.length}));check(tx.signal);}
      await this.#identity(tx,r);for(const output of items)if(!await this.#gate(r,'RELEASE',output.eventId,tx.signal))throw fail('FORBIDDEN');
      await this.#identity(tx,r);
      if(detail){if(items.length!==1)throw fail('FORBIDDEN');return items[0];}
      return Object.freeze({items:Object.freeze(items),nextCursor:rows.length===r.limit?this.#cursor.encode(rows.at(-1).event_id,r):null});
    }catch(e){failure=e;throw e;}})()));}catch{if(failure&&['REVIEW_READ_FORBIDDEN','REVIEW_READ_UNAVAILABLE'].includes(failure.message))throw failure;throw fail('UNAVAILABLE');}finally{await Promise.allSettled([...this.#connections,...(workDone?[workDone]:[])]);}
  }
}
