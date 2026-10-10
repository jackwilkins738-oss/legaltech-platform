// Synthetic protocol/catalog fixture; actual PostgreSQL cases attest the real boundary.
import {PostgresReviewReader} from '../src/postgresReviewReader.js';
import {id,ready,fixtureDrain} from './processingV126.js';
import {ManagedReviewReads} from '../src/managedReviewReads.js';
export {id,ready,fixtureDrain};
export const key=Buffer.alloc(32,134),tenantId=id(1),actorId=id(2),request={tenantId,actorId};
export const row=(n=3,over={})=>({tenant_id:tenantId,event_id:id(n),status:'PROCESSED',job_id:id(n+100),result_hash:'a'.repeat(64),artifact_hash:'b'.repeat(64),result_code:'CLASSIFIED',decision:null,matter_id:null,writeback_job_id:null,decision_job_id:null,decision_result_hash:null,...over});
export function readerFixture({rows=[row()],authorizeRead=async()=>true,grants=true,policies=undefined,active=true,poolOverride,timeoutMs=1000}={}){
  const calls=[],auth=[],state={rows,active};let connections=0;
  const pool={async connect(){connections++;let tenant=null,actor=null;
    return {release:destroy=>{calls.push({release:destroy});},async query(sql,v=[]){calls.push({sql,v});
      if(sql.startsWith('SELECT current_user'))return {rows:[{effective_role:'review_reader_test',login_role:'review_reader_test',tenant_context:null,actor_context:null}]};
      if(sql.startsWith("SELECT set_config('app.tenant_id'")){[tenant,actor]=v;return {rows:[]};}
      if(sql==='COMMIT'){tenant=null;actor=null;return {rows:[]};}
      if(sql.startsWith('SELECT NULLIF'))return {rows:[{tenant_context:tenant,actor_context:actor}]};
      if(sql.endsWith('AS safe'))return {rows:[{safe:grants}]};
      if(sql.includes('FROM pg_policies'))return {rows:policies??[{tablename:'actors',policyname:'tenant_isolation_actors',cmd:'ALL',permissive:'PERMISSIVE',roles:['public'],qual:'tenant_id=app_current_tenant_id()',with_check:'tenant_id=app_current_tenant_id()'},{tablename:'inbound_events',policyname:'tenant_isolation_inbound_events',cmd:'ALL',permissive:'PERMISSIVE',roles:['public'],qual:'tenant_id=app_current_tenant_id()',with_check:'tenant_id=app_current_tenant_id()'},{tablename:'domain_job_results',policyname:'domain_result_human_read',cmd:'SELECT',permissive:'PERMISSIVE',roles:['legaltech_review_reader'],qual:'(tenant_id = app_current_tenant_id())',with_check:null},{tablename:'domain_review_decisions',policyname:'domain_decision_human_read',cmd:'SELECT',permissive:'PERMISSIVE',roles:['legaltech_review_reader'],qual:'(tenant_id = app_current_tenant_id())',with_check:null}]};
      if(sql.startsWith('SELECT a.id'))return {rows:state.active&&tenant===tenantId&&actor===actorId?[{id:actorId}]:[]};
      if(sql.startsWith('SELECT e.tenant_id')){let items=state.rows.filter(r=>r.tenant_id===tenant);if(v.length===2)items=items.filter(r=>r.event_id===v[1]);else items=items.filter(r=>(v[1]===null||r.event_id>v[1])&&(v[2]==='ALL'||(v[2]==='PENDING')===(r.status==='PROCESSED'))).sort((a,b)=>a.event_id.localeCompare(b.event_id)).slice(0,v[3]);return {rows:items};}
      return {rows:[]};
    }};
  }};
  const reader=new PostgresReviewReader({pool:poolOverride??pool,expectedRole:'review_reader_test',cursorKey:key,authorizeRead:async c=>{auth.push(c);return authorizeRead(c,state);},timeoutMs});
  return {reader,pool,calls,auth,state,connections:()=>connections};
}
export function managedFixture({readerOptions={},audit=async()=>{},probeRead=async()=>({ok:true}),drainOptions={},...options}={}){
  const store=readerFixture(readerOptions),drain=fixtureDrain(drainOptions),audits=[];
  const reads=new ManagedReviewReads({reader:store.reader,drain:drain.drain,readiness:ready(),audit:async c=>{audits.push(c);return audit(c);},probeRead,...options});return {...store,reads,drain,audits};
}
