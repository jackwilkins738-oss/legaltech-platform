import fs from 'node:fs';
import {PostgresTenantTransactions} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';
import {canonicalAuditPayload} from './securityMonitoring.js';
import {prepareJobIntent,validateJobIntent,intentHash} from './jobIntent.js';
import {securityOptions,securityTransaction} from './postgresSecurityBoundary.js';

const runtimeSql=fs.readFileSync(new URL('../../30_PRODUCTION_SHAPE_SCAFFOLD/db/verification/runtime_security.sql',import.meta.url),'utf8');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable=()=>new Error('OUTBOX_STORE_UNAVAILABLE');
function scope(input){
  if(!UUID.test(input?.tenantId??'')||!UUID.test(input?.actorId??'')||typeof input.tenantId!=='string'||typeof input.actorId!=='string')throw new Error('OUTBOX_INPUT_INVALID');
  return Object.freeze({tenantId:input.tenantId.toLowerCase(),actorId:input.actorId.toLowerCase()});
}
async function authorize(fn,binding,signal){
  let allowed;try{allowed=await fn(Object.freeze({...binding,signal}));}catch{throw new Error('OUTBOX_AUTHORIZATION_UNAVAILABLE');}
  if(allowed!==true)throw new Error('OUTBOX_FORBIDDEN');
}
function storedIntent(row){
  const intent=validateJobIntent(JSON.parse(row.intent));
  if(row.tenant_id!==intent.tenantId||row.job_id!==intent.jobId||row.kind!==intent.kind||row.object_id!==intent.objectId||row.key_hash!==intent.keyHash
    ||row.request_hash!==intentHash(intent)||row.intent!==canonicalAuditPayload(intent))throw unavailable();
  return intent;
}
async function posture(tx,tables){
  const rows=await tx.query(`SELECT c.relname,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,row_security_active(c.oid) AS active
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,[tables]);
  if(rows.rows.length!==tables.length||new Set(rows.rows.map(r=>r.relname)).size!==tables.length||rows.rows.some(r=>!tables.includes(r.relname)||r.enabled!==true||r.forced!==true||r.active!==true))throw unavailable();
}

// Trusted domain callback only. Use tx.query for domain writes and await tx.enqueue;
// both use this ONE transaction. No queue connection is acquired before commit.
export class PostgresDomainOutbox {
  #transactions;#role;#authorize;
  constructor({authorizeAppend,...options}={}) {
    if(typeof authorizeAppend!=='function')throw new Error('OUTBOX_CONFIGURATION_INVALID');
    this.#transactions=new PostgresTenantTransactions(options);this.#role=options.expectedRole;this.#authorize=authorizeAppend;
  }
  async run(input,work){
    const context=scope(input);if(typeof work!=='function')throw new Error('OUTBOX_CONFIGURATION_INVALID');
    let failure;
    try{return await this.#transactions.run({...context,signal:input.signal},async tx=>{
      await tx.query("SELECT set_config('verification.expected_role',$1,true),set_config('verification.schema','public',true)",[this.#role]);
      await tx.query(runtimeSql);
      await posture(tx,['domain_outbox_events']);
      const grants=await tx.query(`SELECT pg_has_role(current_user,'legaltech_outbox_writer','MEMBER')
        AND has_table_privilege(current_user,'public.domain_outbox_events','SELECT')
        AND NOT has_table_privilege(current_user,'public.domain_outbox_events','UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user,'public.domain_outbox_events','UPDATE')
        AND NOT has_table_privilege(current_user,'public.domain_outbox_receipts','INSERT,UPDATE,DELETE,TRUNCATE')
        AND NOT has_any_column_privilege(current_user,'public.domain_outbox_receipts','INSERT,UPDATE')
        AND NOT has_column_privilege(current_user,'public.domain_outbox_events','created_at','INSERT')
        AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.domain_outbox_events'::regclass AND a.attnum>0 AND NOT a.attisdropped
          AND a.attname<>'created_at' AND NOT has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')) AS grants_safe`);
      if(grants.rows.length!==1||grants.rows[0].grants_safe!==true)throw unavailable();
      let active=true,pending=0;
      const enqueue=raw=>{
        const operation=(async()=>{
        if(!active){failure=unavailable();throw failure;}pending++;
        try{
          const intent=prepareJobIntent(raw),hash=intentHash(intent);
          if(intent.tenantId!==context.tenantId)throw new Error('OUTBOX_FORBIDDEN');
          await authorize(this.#authorize,{...intent,actorId:context.actorId,operation:'DOMAIN_APPEND'},tx.signal);
          if(!active)throw unavailable();
          await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['outbox-append-v122',context.tenantId])]);
          const prior=await tx.query('SELECT * FROM public.domain_outbox_events WHERE tenant_id=$1::uuid AND (job_id=$2::uuid OR (kind=$3 AND key_hash=$4))',[context.tenantId,intent.jobId,intent.kind,intent.keyHash]);
          if(prior.rows.length){
            if(prior.rows.length!==1||intentHash(storedIntent(prior.rows[0]))!==hash)throw new Error('OUTBOX_APPEND_CONFLICT');
          }else{
            const saved=await tx.query(`INSERT INTO public.domain_outbox_events(tenant_id,job_id,kind,object_id,key_hash,request_hash,intent)
              VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7) RETURNING *`,[intent.tenantId,intent.jobId,intent.kind,intent.objectId,intent.keyHash,hash,canonicalAuditPayload(intent)]);
            if(saved.rows.length!==1||intentHash(storedIntent(saved.rows[0]))!==hash)throw unavailable();
          }
          return Object.freeze({tenantId:intent.tenantId,jobId:intent.jobId,requestHash:hash,replayed:prior.rows.length===1});
        }catch(error){failure=error;throw error;}finally{pending--;}
        })();
        operation.catch(()=>{});return operation;
      };
      let result;try{result=await work(Object.freeze({query:tx.query,enqueue,signal:tx.signal}));}finally{active=false;}
      if(pending!==0||failure)throw failure??unavailable();return result;
    });}catch(error){
      if(error.message==='POSTGRES_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN');
      throw failure&&/^(OUTBOX_|QUEUE_INPUT_INVALID)/.test(failure.message)?failure:unavailable();
    }
  }
}

export class PostgresOutboxRelay {
  #options;#authorize;#producer;
  constructor({authorizeRelay,jobProducer,...options}={}) {
    if(typeof authorizeRelay!=='function'||typeof jobProducer?.enqueueIntent!=='function')throw new Error('OUTBOX_CONFIGURATION_INVALID');
    this.#options=securityOptions(options);this.#authorize=authorizeRelay;this.#producer=jobProducer;
  }
  async #run(context,signal,work,{readOnly=false}={}) {
    let failure;
    try{return await securityTransaction(this.#options,'legaltech_outbox_relay',async tx=>{
      await posture(tx,['domain_outbox_events','domain_outbox_receipts']);
      try{return await work(tx);}catch(error){failure=error;throw error;}
    },{context,signal,readOnly});}catch(error){
      if(failure&&['OUTBOX_FORBIDDEN','OUTBOX_AUTHORIZATION_UNAVAILABLE'].includes(failure.message))throw failure;
      throw error;
    }
  }
  async relay(input={}) {
    const context=scope(input),limit=input.limit??25,signal=input.signal;
    if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('OUTBOX_INPUT_INVALID');
    let delivered=0;
    try{
      const intents=await this.#run(context,signal,async tx=>{
        await authorize(this.#authorize,{...context,operation:'RELAY_SCAN'},tx.signal);
        const rows=await tx.query(`SELECT e.* FROM public.domain_outbox_events e WHERE e.tenant_id=$1::uuid
          AND NOT EXISTS(SELECT 1 FROM public.domain_outbox_receipts r WHERE r.tenant_id=e.tenant_id AND r.job_id=e.job_id)
          ORDER BY e.created_at,e.job_id LIMIT $2`,[context.tenantId,limit]);
        if(rows.rows.length>limit||new Set(rows.rows.map(r=>r.job_id)).size!==rows.rows.length)throw unavailable();
        return rows.rows.map(row=>{const intent=storedIntent(row);if(intent.tenantId!==context.tenantId)throw unavailable();return intent;});
      },{readOnly:true});
      for(const intent of intents){
        if(signal?.aborted)throw unavailable();
        await this.#run(context,signal,tx=>authorize(this.#authorize,{...intent,actorId:context.actorId,operation:'RELAY_ENQUEUE'},tx.signal),{readOnly:true});
        const receipt=await this.#producer.enqueueIntent(intent,{signal});
        if(!receipt||receipt.tenantId!==intent.tenantId||receipt.jobId!==intent.jobId||receipt.kind!==intent.kind||receipt.objectId!==intent.objectId||receipt.traceHash!==intent.traceHash)throw unavailable();
        await this.#run(context,signal,async tx=>{
          await authorize(this.#authorize,{...intent,actorId:context.actorId,operation:'RELAY_ACK'},tx.signal);
          const result=await tx.query(`INSERT INTO public.domain_outbox_receipts(tenant_id,job_id,request_hash) VALUES($1::uuid,$2::uuid,$3)
            ON CONFLICT(tenant_id,job_id) DO NOTHING`,[intent.tenantId,intent.jobId,intentHash(intent)]);
          if(![0,1].includes(result.rowCount))throw unavailable();
          const saved=await tx.query('SELECT request_hash FROM public.domain_outbox_receipts WHERE tenant_id=$1::uuid AND job_id=$2::uuid',[intent.tenantId,intent.jobId]);
          if(saved.rows.length!==1||saved.rows[0].request_hash!==intentHash(intent))throw unavailable();
        });
        delivered++;
      }
      return Object.freeze({ok:true,delivered,scanned:intents.length});
    }catch(error){
      // Earlier jobs in this bounded batch may already be committed. Repeat the
      // scan; the queue replay contract closes the queue/receipt crash window.
      if(error.message==='POSTGRES_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('OUTBOX_ACK_OUTCOME_UNKNOWN');
      if(/^(OUTBOX_FORBIDDEN|OUTBOX_AUTHORIZATION_UNAVAILABLE|QUEUE_ENQUEUE_)/.test(error.message))throw error;
      throw unavailable();
    }
  }
}
