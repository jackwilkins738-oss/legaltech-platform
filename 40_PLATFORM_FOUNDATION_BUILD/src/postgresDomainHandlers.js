import crypto from 'node:crypto';
import {commandRequestHash} from './domainCommandBinding.js';
import {prepareJobIntent,intentHash} from './jobIntent.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/;
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const unavailable=()=>new Error('DOMAIN_COMMAND_UNAVAILABLE');
function uuid(v){if(typeof v!=='string'||!UUID.test(v))throw new Error('DOMAIN_COMMAND_INPUT_INVALID');return v.toLowerCase();}
function hash(v){if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('DOMAIN_COMMAND_INPUT_INVALID');return v;}
function identifier(v){if(typeof v!=='string'||!ID.test(v))throw new Error('DOMAIN_COMMAND_INPUT_INVALID');return v;}
function shape(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).some(k=>!keys.includes(k)))throw new Error('DOMAIN_COMMAND_INPUT_INVALID');}
const columns={tenantId:'tenant_id',commandId:'command_id',actorId:'actor_id',jobId:'job_id',kind:'kind',objectId:'object_id',inboundEventId:'inbound_event_id',matterId:'matter_id',payloadId:'payload_id',payloadHash:'payload_hash',sourceHash:'source_hash',policyVersionId:'policy_version_id',policyVersionHash:'policy_version_hash',traceHash:'trace_hash'};
function matches(row,binding,requestHash,intentDigest){return row&&Object.entries(columns).every(([key,col])=>row[col]===binding[key])&&row.request_hash===requestHash&&row.intent_hash===intentDigest;}
function receipt(b,replayed){return Object.freeze({tenantId:b.tenantId,commandId:b.commandId,jobId:b.jobId,kind:b.kind,objectId:b.objectId,status:'ACCEPTED',replayed});}
function matchesInbound(row,b,sourceSystem){return row&&row.id===b.inboundEventId&&row.tenant_id===b.tenantId&&row.source_system===sourceSystem&&row.external_event_id===b.sourceHash
  &&row.event_type==='INBOUND_DOCUMENT'&&row.payload_ref===`object:${b.payloadId}`&&row.trace_id===b.traceHash;}

export class PostgresDomainJobHandlers {
  #outbox;#authorize;
  constructor({domainOutbox,authorizeDomain}={}) {
    if(typeof domainOutbox?.run!=='function'||typeof authorizeDomain!=='function')throw new Error('DOMAIN_COMMAND_CONFIGURATION_INVALID');
    this.#outbox=domainOutbox;this.#authorize=authorizeDomain;
  }
  registerInbound(input) {
    shape(input,['tenantId','actorId','commandId','jobId','eventId','payloadId','payloadHash','sourceSystem','externalEventId','traceId','signal']);
    const tenantId=uuid(input.tenantId),actorId=uuid(input.actorId),commandId=uuid(input.commandId),jobId=uuid(input.jobId),eventId=uuid(input.eventId),payloadId=uuid(input.payloadId),traceId=identifier(input.traceId);
    if(!['MANUAL','MANUAL_UPLOAD','MICROSOFT_GRAPH'].includes(input.sourceSystem))throw new Error('DOMAIN_COMMAND_INPUT_INVALID');
    const sourceSystem=input.sourceSystem,sourceHash=sha(identifier(input.externalEventId));
    const b={tenantId,actorId,commandId,jobId,kind:'PROCESS_INBOUND',objectId:eventId,inboundEventId:eventId,matterId:null,payloadId,payloadHash:hash(input.payloadHash),sourceHash,policyVersionId:null,policyVersionHash:null,traceHash:sha(traceId)};
    return this.#execute(b,{traceId,sourceSystem},input.signal);
  }
  requestPolicyEvaluation(input) {
    shape(input,['tenantId','actorId','commandId','jobId','matterId','policyVersionId','policyVersionHash','traceId','signal']);
    const tenantId=uuid(input.tenantId),actorId=uuid(input.actorId),commandId=uuid(input.commandId),jobId=uuid(input.jobId),matterId=uuid(input.matterId),policyVersionId=uuid(input.policyVersionId),traceId=identifier(input.traceId);
    const b={tenantId,actorId,commandId,jobId,kind:'POLICY_EVALUATION',objectId:matterId,inboundEventId:null,matterId,payloadId:null,payloadHash:null,sourceHash:null,policyVersionId,policyVersionHash:hash(input.policyVersionHash),traceHash:sha(traceId)};
    return this.#execute(b,{traceId,sourceSystem:null},input.signal);
  }
  async #execute(b,{traceId,sourceSystem},signal) {
    const enqueue={tenantId:b.tenantId,jobId:b.jobId,kind:b.kind,objectId:b.objectId,traceId,idempotencyKey:`domain-command:${b.commandId}`};
    const digest=intentHash(prepareJobIntent(enqueue)),requestHash=commandRequestHash(b,sourceSystem);
    let failure;
    try{return await this.#outbox.run({tenantId:b.tenantId,actorId:b.actorId,signal},async tx=>{
      try{
        const grants=await tx.query(`SELECT pg_has_role(current_user,'legaltech_domain_commands','MEMBER')
          AND has_table_privilege(current_user,'public.domain_job_commands','SELECT')
          AND NOT has_table_privilege(current_user,'public.domain_job_commands','UPDATE,DELETE,TRUNCATE')
          AND NOT has_any_column_privilege(current_user,'public.domain_job_commands','UPDATE')
          AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.domain_job_commands'::regclass AND a.attnum>0 AND NOT a.attisdropped
            AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname<>'created_at'))
          AND row_security_active('public.domain_job_commands'::regclass)
          AND (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.domain_job_commands'::regclass) AS grants_safe`);
        if(grants.rows.length!==1||grants.rows[0].grants_safe!==true)throw unavailable();
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['domain-command-v123',b.tenantId])]);
        const identity=await tx.query(`SELECT a.id,a.tenant_id,a.status,a.actor_type,t.status AS tenant_status FROM public.actors a
          JOIN public.tenants t ON t.id=a.tenant_id WHERE a.tenant_id=$1::uuid AND a.id=$2::uuid`,[b.tenantId,b.actorId]);
        if(identity.rows.length!==1||identity.rows[0].id!==b.actorId||identity.rows[0].tenant_id!==b.tenantId||identity.rows[0].status!=='ACTIVE'||identity.rows[0].tenant_status!=='ACTIVE'||!['USER','SERVICE'].includes(identity.rows[0].actor_type))throw new Error('DOMAIN_COMMAND_FORBIDDEN');
        let authorized;
        try{authorized=await this.#authorize(Object.freeze({...b,sourceSystem,operation:b.kind==='PROCESS_INBOUND'?'REGISTER_INBOUND':'REQUEST_POLICY_EVALUATION',signal:tx.signal}));}catch{throw new Error('DOMAIN_COMMAND_AUTHORIZATION_UNAVAILABLE');}
        if(authorized!==true)throw new Error('DOMAIN_COMMAND_FORBIDDEN');
        const prior=await tx.query('SELECT * FROM public.domain_job_commands WHERE tenant_id=$1::uuid AND (command_id=$2::uuid OR job_id=$3::uuid)',[b.tenantId,b.commandId,b.jobId]);
        if(prior.rows.length){
          if(prior.rows.length!==1||!matches(prior.rows[0],b,requestHash,digest))throw new Error('DOMAIN_COMMAND_CONFLICT');
        }
        if(b.kind==='PROCESS_INBOUND'){
          const existing=await tx.query('SELECT id,tenant_id,source_system,external_event_id,event_type,payload_ref,trace_id FROM public.inbound_events WHERE tenant_id=$1::uuid AND (id=$2::uuid OR (source_system=$3 AND external_event_id=$4))',[b.tenantId,b.inboundEventId,sourceSystem,b.sourceHash]);
          if(prior.rows.length){
            if(existing.rows.length!==1||!matchesInbound(existing.rows[0],b,sourceSystem))throw unavailable();
          }else{
            if(existing.rows.length)throw new Error('DOMAIN_COMMAND_CONFLICT');
            const saved=await tx.query(`INSERT INTO public.inbound_events(id,tenant_id,source_system,external_event_id,event_type,occurred_at,payload_ref,status,trace_id)
              VALUES($1::uuid,$2::uuid,$3,$4,'INBOUND_DOCUMENT',clock_timestamp(),$5,'RECEIVED',$6) RETURNING id,tenant_id,source_system,external_event_id,event_type,payload_ref,trace_id`,[b.inboundEventId,b.tenantId,sourceSystem,b.sourceHash,`object:${b.payloadId}`,b.traceHash]);
            if(saved.rows.length!==1||!matchesInbound(saved.rows[0],b,sourceSystem))throw unavailable();
          }
        }else{
          const matter=await tx.query('SELECT id,tenant_id,status FROM public.matters WHERE tenant_id=$1::uuid AND id=$2::uuid',[b.tenantId,b.matterId]);
          if(matter.rows.length!==1||matter.rows[0].id!==b.matterId||matter.rows[0].tenant_id!==b.tenantId||matter.rows[0].status!=='OPEN')throw new Error('DOMAIN_COMMAND_FORBIDDEN');
        }
        if(!prior.rows.length){
          const saved=await tx.query(`INSERT INTO public.domain_job_commands(tenant_id,command_id,actor_id,job_id,kind,object_id,inbound_event_id,matter_id,payload_id,payload_hash,source_hash,policy_version_id,policy_version_hash,trace_hash,request_hash,intent_hash)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid,$7::uuid,$8::uuid,$9::uuid,$10,$11,$12::uuid,$13,$14,$15,$16) RETURNING *`,
            [b.tenantId,b.commandId,b.actorId,b.jobId,b.kind,b.objectId,b.inboundEventId,b.matterId,b.payloadId,b.payloadHash,b.sourceHash,b.policyVersionId,b.policyVersionHash,b.traceHash,requestHash,digest]);
          if(saved.rows.length!==1||!matches(saved.rows[0],b,requestHash,digest))throw unavailable();
        }
        await tx.enqueue(enqueue);return receipt(b,prior.rows.length===1);
      }catch(error){failure=error;throw error;}
    });}catch(error){
      if(error.message==='OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN')throw new Error('DOMAIN_COMMAND_COMMIT_OUTCOME_UNKNOWN');
      if(failure&&['DOMAIN_COMMAND_FORBIDDEN','DOMAIN_COMMAND_AUTHORIZATION_UNAVAILABLE','DOMAIN_COMMAND_CONFLICT'].includes(failure.message))throw failure;
      throw unavailable();
    }
  }
}
