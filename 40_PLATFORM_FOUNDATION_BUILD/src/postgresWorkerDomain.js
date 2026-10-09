import crypto from 'node:crypto';
import {securityOptions,securityTransaction} from './postgresSecurityBoundary.js';
import {decodeDomainCommand} from './domainCommandBinding.js';
import {validateJobIntent,intentHash} from './jobIntent.js';
import {canonicalAuditPayload} from './securityMonitoring.js';

const group='legaltech_job_domain_reader',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HEX=/^[a-f0-9]{64}$/;
const tables=['actors','matters','inbound_events','domain_job_commands','domain_outbox_events','matter_actor_access','matter_break_glass_grants','actor_security_zones'];
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const invalid=()=>new Error('WORKER_DOMAIN_BINDING_INVALID');
async function posture(tx){
  const result=await tx.query(`SELECT c.relname,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,row_security_active(c.oid) AS active
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tables]);
  if(result.rows.length!==tables.length||new Set(result.rows.map(r=>r.relname)).size!==tables.length||result.rows.some(r=>!tables.includes(r.relname)||r.enabled!==true||r.forced!==true||r.active!==true))throw invalid();
  await tx.query('SELECT 1 FROM public.tenants LIMIT 0');
}
export class PostgresWorkerDomainLoader {
  #options;#authorize;
  constructor({authorizeRead,...options}={}){if(typeof authorizeRead!=='function')throw new Error('WORKER_DOMAIN_CONFIGURATION_INVALID');this.#options=securityOptions(options);this.#authorize=authorizeRead;}
  async load(claim,{serviceActorId,signal}={}) {
    if(!claim||typeof claim.tenantId!=='string'||!UUID.test(claim.tenantId)||typeof claim.jobId!=='string'||!UUID.test(claim.jobId)
      ||typeof claim.objectId!=='string'||!UUID.test(claim.objectId)||typeof claim.workerId!=='string'||!UUID.test(claim.workerId)||!['PROCESS_INBOUND','POLICY_EVALUATION'].includes(claim.kind)
      ||!HEX.test(claim.requestHash??'')||!HEX.test(claim.traceHash??'')||typeof serviceActorId!=='string'||!UUID.test(serviceActorId))throw invalid();
    const context={tenantId:claim.tenantId.toLowerCase(),actorId:serviceActorId.toLowerCase()};let failure;
    try{return await securityTransaction(this.#options,group,async tx=>{
      try{
        await posture(tx);
        const check=async binding=>{
          let ok;try{ok=await this.#authorize(Object.freeze({...binding,serviceActorId:context.actorId,workerId:claim.workerId,operation:'LOAD_WORKER_DOMAIN',signal:tx.signal}));}catch{throw new Error('WORKER_DOMAIN_AUTHORIZATION_UNAVAILABLE');}
          if(ok!==true)throw new Error('WORKER_DOMAIN_FORBIDDEN');
        };
        await check({tenantId:context.tenantId,jobId:claim.jobId,kind:claim.kind,objectId:claim.objectId});
        const rows=await tx.query('SELECT * FROM public.domain_job_commands WHERE tenant_id=$1::uuid AND job_id=$2::uuid',[context.tenantId,claim.jobId]);
        if(rows.rows.length!==1)throw invalid();const row=rows.rows[0];
        const identity=await tx.query(`SELECT a.id,a.tenant_id,a.actor_type,a.status,t.status AS tenant_status FROM public.actors a
          JOIN public.tenants t ON t.id=a.tenant_id WHERE a.tenant_id=$1::uuid AND (a.id=$2::uuid OR a.id=$3::uuid)`,[context.tenantId,context.actorId,row.actor_id]);
        const service=identity.rows.find(r=>r.id===context.actorId),author=identity.rows.find(r=>r.id===row.actor_id);
        if(!service||!author||identity.rows.length!==(context.actorId===row.actor_id?1:2)||service.actor_type!=='SERVICE'
          ||identity.rows.some(r=>r.tenant_id!==context.tenantId||r.status!=='ACTIVE'||r.tenant_status!=='ACTIVE')||!['USER','SERVICE'].includes(author.actor_type))throw new Error('WORKER_DOMAIN_FORBIDDEN');
        let sourceSystem=null;
        if(claim.kind==='PROCESS_INBOUND'){
          const events=await tx.query('SELECT id,tenant_id,source_system,external_event_id,event_type,payload_ref,trace_id,status FROM public.inbound_events WHERE tenant_id=$1::uuid AND id=$2::uuid',[context.tenantId,claim.objectId]);
          const event=events.rows[0];if(events.rows.length!==1||event.id!==claim.objectId||event.tenant_id!==context.tenantId||event.event_type!=='INBOUND_DOCUMENT'
            ||event.external_event_id!==row.source_hash||event.payload_ref!==`object:${row.payload_id}`||event.trace_id!==row.trace_hash||event.status!=='RECEIVED')throw invalid();sourceSystem=event.source_system;
        }else{
          const matters=await tx.query('SELECT id,tenant_id,status FROM public.matters WHERE tenant_id=$1::uuid AND id=$2::uuid',[context.tenantId,claim.objectId]);
          if(matters.rows.length!==1||matters.rows[0].id!==claim.objectId||matters.rows[0].tenant_id!==context.tenantId||matters.rows[0].status!=='OPEN')throw new Error('WORKER_DOMAIN_FORBIDDEN');
        }
        const command=decodeDomainCommand(row,sourceSystem);
        if(command.tenantId!==context.tenantId||command.jobId!==claim.jobId||command.kind!==claim.kind||command.objectId!==claim.objectId||command.traceHash!==claim.traceHash||command.intentHash!==claim.requestHash)throw invalid();
        const intents=await tx.query('SELECT intent,request_hash FROM public.domain_outbox_events WHERE tenant_id=$1::uuid AND job_id=$2::uuid',[context.tenantId,claim.jobId]);
        if(intents.rows.length!==1)throw invalid();const stored=intents.rows[0],intent=validateJobIntent(JSON.parse(stored.intent));
        if(canonicalAuditPayload(intent)!==stored.intent||intentHash(intent)!==stored.request_hash||stored.request_hash!==command.intentHash||intent.tenantId!==command.tenantId
          ||intent.jobId!==command.jobId||intent.kind!==command.kind||intent.objectId!==command.objectId||intent.traceHash!==command.traceHash||intent.keyHash!==sha(`domain-command:${command.commandId}`))throw invalid();
        await check(command);return command;
      }catch(error){failure=error;throw error;}
    },{context,signal,readOnly:true,isolation:'REPEATABLE READ'});}catch{
      if(failure&&['WORKER_DOMAIN_FORBIDDEN','WORKER_DOMAIN_AUTHORIZATION_UNAVAILABLE','WORKER_DOMAIN_BINDING_INVALID'].includes(failure.message))throw failure;
      throw new Error('WORKER_DOMAIN_UNAVAILABLE');
    }
  }
  async probe(){try{return await securityTransaction(this.#options,group,async tx=>{await posture(tx);return Object.freeze({ok:true});},{readOnly:true});}catch{throw new Error('WORKER_DOMAIN_UNAVAILABLE');}}
}
