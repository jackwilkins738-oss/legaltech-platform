import {decodeDomainCommand} from './domainCommandBinding.js';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const columns={tenantId:'tenant_id',jobId:'job_id',kind:'kind',objectId:'object_id',commandId:'command_id',commandHash:'command_hash',artifactHash:'artifact_hash',resultHash:'result_hash',resultCode:'result_code',attempt:'attempt',workerId:'worker_id'};
const failure=()=>new Error('DOMAIN_RESULT_UNAVAILABLE');
function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw new Error('DOMAIN_RESULT_INPUT_INVALID');return value.toLowerCase();}
function matches(row,result){return row&&Object.entries(columns).every(([k,col])=>row[col]===result[k]);}
function receipt(row,replayed){return Object.freeze({...Object.fromEntries(Object.entries(columns).map(([k,col])=>[k,row[col]])),adoptedBy:row.adopted_by,adoptedAt:new Date(row.adopted_at).toISOString(),status:'APPLIED',replayed});}
async function posture(tx){
  const result=await tx.query(`SELECT pg_has_role(current_user,'legaltech_domain_result_writer','MEMBER')
    AND has_table_privilege(current_user,'public.domain_job_results','SELECT')
    AND NOT has_table_privilege(current_user,'public.domain_job_results','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege(current_user,'public.domain_job_results','UPDATE')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.domain_job_results'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY['tenant_id','job_id','kind','object_id','command_id','command_hash','artifact_hash','result_hash','result_code','attempt','worker_id','adopted_by']::name[])))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.inbound_events'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname='status'))
    AND row_security_active('public.domain_job_results'::regclass)
    AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.domain_job_results'::regclass) AS grants_safe`);
  if(result.rows.length!==1||result.rows[0].grants_safe!==true)throw failure();
  const triggers=await tx.query(`SELECT t.tgname,t.tgenabled,t.tgdeferrable,t.tginitdeferred FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND ((c.relname='domain_job_results' AND t.tgname='domain_result_binding') OR (c.relname='inbound_events' AND t.tgname='inbound_result_transition')) AND NOT t.tgisinternal`);
  if(triggers.rows.length!==2||!triggers.rows.some(r=>r.tgname==='domain_result_binding'&&r.tgdeferrable===true&&r.tginitdeferred===true)
    ||!triggers.rows.some(r=>r.tgname==='inbound_result_transition')||triggers.rows.some(r=>!['O','A'].includes(r.tgenabled)))throw failure();
}
export class PostgresResultAdopter {
  #outbox;#reader;#authorize;
  constructor({domainOutbox,jobReader,authorizeAdoption}={}){
    if(typeof domainOutbox?.run!=='function'||typeof jobReader?.getResult!=='function'||typeof authorizeAdoption!=='function')throw new Error('DOMAIN_RESULT_CONFIGURATION_INVALID');
    this.#outbox=Object.freeze({run:domainOutbox.run.bind(domainOutbox)});this.#reader=Object.freeze({getResult:jobReader.getResult.bind(jobReader)});this.#authorize=authorizeAdoption;
  }
  async adopt({tenantId,serviceActorId,jobId,signal}={}){
    tenantId=uuid(tenantId);serviceActorId=uuid(serviceActorId);jobId=uuid(jobId);let denied;
    try{return await this.#outbox.run({tenantId,actorId:serviceActorId,signal},async tx=>{
      try{
        await posture(tx);await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['domain-result-v125',tenantId,jobId])]);
        const records=await tx.query('SELECT * FROM public.domain_job_commands WHERE tenant_id=$1::uuid AND job_id=$2::uuid',[tenantId,jobId]);
        if(records.rows.length!==1)throw failure();const row=records.rows[0];
        const identities=await tx.query(`SELECT a.id,a.tenant_id,a.actor_type,a.status,t.status AS tenant_status FROM public.actors a JOIN public.tenants t ON t.id=a.tenant_id
          WHERE a.tenant_id=$1::uuid AND (a.id=$2::uuid OR a.id=$3::uuid)`,[tenantId,serviceActorId,row.actor_id]);
        const service=identities.rows.find(r=>r.id===serviceActorId),author=identities.rows.find(r=>r.id===row.actor_id);
        if(!service||!author||service.actor_type!=='SERVICE'||!['USER','SERVICE'].includes(author.actor_type)
          ||identities.rows.length!==(serviceActorId===row.actor_id?1:2)||identities.rows.some(r=>r.tenant_id!==tenantId||r.status!=='ACTIVE'||r.tenant_status!=='ACTIVE'))throw new Error('DOMAIN_RESULT_FORBIDDEN');
        let event,source=null;
        if(row.kind==='PROCESS_INBOUND'){
          const events=await tx.query('SELECT * FROM public.inbound_events WHERE tenant_id=$1::uuid AND id=$2::uuid FOR UPDATE',[tenantId,row.object_id]);event=events.rows[0];
          if(events.rows.length!==1||event.tenant_id!==tenantId||event.id!==row.object_id||event.event_type!=='INBOUND_DOCUMENT'||event.external_event_id!==row.source_hash
            ||event.payload_ref!==`object:${row.payload_id}`||event.trace_id!==row.trace_hash||!['RECEIVED','PROCESSED'].includes(event.status))throw failure();source=event.source_system;
        }else{
          const matters=await tx.query('SELECT id,tenant_id,status FROM public.matters WHERE tenant_id=$1::uuid AND id=$2::uuid',[tenantId,row.object_id]);
          if(matters.rows.length!==1||matters.rows[0].tenant_id!==tenantId||matters.rows[0].id!==row.object_id||matters.rows[0].status!=='OPEN')throw new Error('DOMAIN_RESULT_FORBIDDEN');
        }
        const command=decodeDomainCommand(row,source);
        if(command.tenantId!==tenantId||command.jobId!==jobId)throw failure();
        const check=async(phase,result)=>{if(await this.#authorize(Object.freeze({...command,serviceActorId,phase,result,signal:tx.signal}))!==true)throw new Error('DOMAIN_RESULT_FORBIDDEN');};
        await check('READ_RESULT');const result=await this.#reader.getResult({tenantId,jobId,signal:tx.signal});
        if(result===null)return Object.freeze({jobId,status:'PENDING'});
        if(!result||typeof result.resultHash!=='string'||!/^[a-f0-9]{64}$/.test(result.resultHash)||typeof result.resultCode!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(result.resultCode)
          ||!Number.isInteger(result.attempt)||result.attempt<1||result.attempt>10||typeof result.workerId!=='string'||!UUID.test(result.workerId)||result.tenantId!==tenantId||result.jobId!==jobId||result.kind!==command.kind||result.objectId!==command.objectId||result.commandId!==command.commandId||result.commandHash!==command.requestHash
          ||result.artifactHash!==(command.kind==='PROCESS_INBOUND'?command.payloadHash:command.policyVersionHash))throw failure();
        // Snapshot only the validated metadata; caller-owned readers cannot
        // mutate later authorization arguments to change the inserted binding.
        const bound=Object.freeze(Object.fromEntries(Object.keys(columns).map(k=>[k,result[k]])));
        const prior=await tx.query('SELECT * FROM public.domain_job_results WHERE tenant_id=$1::uuid AND job_id=$2::uuid',[tenantId,jobId]);
        await check('COMMIT_ADOPTION',bound);
        if(prior.rows.length){if(prior.rows.length!==1||!matches(prior.rows[0],bound)||event&&event.status!=='PROCESSED')throw failure();return receipt(prior.rows[0],true);}
        if(event&&event.status!=='RECEIVED')throw failure();
        const saved=await tx.query(`INSERT INTO public.domain_job_results(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id,adopted_by)
          VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11::uuid,$12::uuid) RETURNING *`,[...Object.keys(columns).map(k=>bound[k]),serviceActorId]);
        if(saved.rows.length!==1||!matches(saved.rows[0],bound)||saved.rows[0].adopted_by!==serviceActorId)throw failure();
        if(event){const changed=await tx.query("UPDATE public.inbound_events SET status='PROCESSED' WHERE tenant_id=$1::uuid AND id=$2::uuid AND status='RECEIVED' RETURNING id",[tenantId,command.objectId]);if(changed.rows.length!==1||changed.rows[0].id!==command.objectId)throw failure();}
        return receipt(saved.rows[0],false);
      }catch(error){denied=error;throw error;}
    });}catch(error){
      if(error?.message==='OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN')throw new Error('DOMAIN_RESULT_COMMIT_OUTCOME_UNKNOWN');
      if(denied?.message==='DOMAIN_RESULT_FORBIDDEN')throw denied;throw failure();
    }
  }
}
