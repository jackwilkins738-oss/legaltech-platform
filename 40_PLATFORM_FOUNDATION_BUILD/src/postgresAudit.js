import crypto from 'node:crypto';
import {canonicalAuditPayload,auditEntryHash} from './securityMonitoring.js';
import {securityOptions,securityTransaction,securityProbe} from './postgresSecurityBoundary.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/,CODE=/^[A-Z][A-Z0-9_]{0,63}$/;
const GENESIS='0'.repeat(64),writer='legaltech_audit_writer',reader='legaltech_audit_reader';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=()=>new Error('AUDIT_STORE_UNAVAILABLE');
function uuid(value){if(typeof value!=='string'||!UUID.test(value))throw new Error('AUDIT_INPUT_INVALID');return value.toLowerCase();}
function idHash(value,nullable=false){if(nullable&&value===null)return null;if(typeof value!=='string'||!ID.test(value))throw new Error('AUDIT_INPUT_INVALID');return sha(value);}
function code(value,max=64,nullable=false){if(nullable&&value===null)return null;if(typeof value!=='string'||value.length>max||!CODE.test(value))throw new Error('AUDIT_INPUT_INVALID');return value;}
function shape(value,keys){if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).some(k=>!keys.includes(k)))throw new Error('AUDIT_INPUT_INVALID');}
function position(value,min=0){const n=typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)?Number(value):value;if(!Number.isSafeInteger(n)||n<min)throw fail();return n;}
function normalize(input){
  shape(input,['tenantId','eventId','actorId','traceId','action','outcome','objectId','matterId','reasonCode']);
  return {version:1,tenantId:uuid(input.tenantId),eventId:uuid(input.eventId),actorHash:idHash(input.actorId),traceHash:idHash(input.traceId),
    objectHash:idHash(input.objectId??null,true),matterHash:idHash(input.matterId??null,true),action:code(input.action),outcome:code(input.outcome,32),reasonCode:code(input.reasonCode??null,64,true)};
}
function head(row){if(!row)return {auditCount:0,headHash:GENESIS};const auditCount=position(row.position);if(!HEX.test(row.head_hash)||auditCount===0&&row.head_hash!==GENESIS)throw fail();return {auditCount,headHash:row.head_hash};}
function entry(row,tenantId){
  let payload;try{payload=JSON.parse(row.canonical_payload);}catch{throw fail();}
  shape(payload,['version','tenantId','eventId','actorHash','traceHash','objectHash','matterHash','action','outcome','reasonCode','position','createdAt','requestHash']);
  if(Object.keys(payload).length!==13||payload.version!==1||payload.tenantId!==tenantId||uuid(payload.eventId)!==row.event_id
    ||position(payload.position,1)!==position(row.position,1)||row.tenant_id!==tenantId
    ||!HEX.test(payload.actorHash)||!HEX.test(payload.traceHash)||!HEX.test(payload.requestHash)
    ||[payload.objectHash,payload.matterHash].some(x=>x!==null&&!HEX.test(x))
    ||code(payload.action)!==payload.action||code(payload.outcome,32)!==payload.outcome||code(payload.reasonCode,64,true)!==payload.reasonCode
    ||typeof payload.createdAt!=='string'||new Date(payload.createdAt).toISOString()!==payload.createdAt
    ||new Date(row.created_at).toISOString()!==payload.createdAt||canonicalAuditPayload(payload)!==row.canonical_payload
    ||!HEX.test(row.previous_hash)||!HEX.test(row.entry_hash))throw fail();
  const {position:ignoredPosition,createdAt:ignoredAt,requestHash,...base}=payload;
  if(sha(canonicalAuditPayload(base))!==requestHash||requestHash!==row.request_hash||auditEntryHash(row.previous_hash,payload)!==row.entry_hash)throw fail();
  return Object.freeze({...payload,previousHash:row.previous_hash,entryHash:row.entry_hash});
}
async function triggers(tx){
  const result=await tx.query(`SELECT c.relname,t.tgname,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='audit_security' AND NOT t.tgisinternal`);
  const required=[['tenant_heads','protect_audit_head'],['entries','validate_audit_entry'],['entries','advance_audit_head'],['entries','audit_entries_no_update_delete'],['entries','audit_entries_no_truncate']];
  if(required.some(([table,name])=>!result.rows.some(x=>x.relname===table&&x.tgname===name&&['O','A'].includes(x.tgenabled))))throw fail();
}

export class PostgresAuditWriter {
  #options;
  constructor(options){this.#options=securityOptions(options);}
  async append(input,{signal}={}) {
    const base=normalize(input),requestHash=sha(canonicalAuditPayload(base));let conflict=false;
    try{return await securityTransaction(this.#options,writer,async tx=>{
      await triggers(tx);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['audit-v120',base.tenantId])]);
      await tx.query('INSERT INTO audit_security.tenant_heads(tenant_id,position,head_hash) VALUES($1::uuid,0,$2) ON CONFLICT DO NOTHING',[base.tenantId,GENESIS]);
      const found=await tx.query('SELECT position,head_hash FROM audit_security.tenant_heads WHERE tenant_id=$1::uuid FOR UPDATE',[base.tenantId]);
      if(found.rows.length!==1)throw fail();const current=head(found.rows[0]);
      const existing=await tx.query('SELECT * FROM audit_security.entries WHERE tenant_id=$1::uuid AND event_id=$2::uuid',[base.tenantId,base.eventId]);
      if(existing.rows.length>1)throw fail();
      if(existing.rows.length===1){
        const old=entry(existing.rows[0],base.tenantId);if(old.requestHash!==requestHash){conflict=true;throw fail();}
        if(old.position>current.auditCount)throw fail();
        return Object.freeze({...old,replayed:true});
      }
      if(current.auditCount>0){
        const last=await tx.query('SELECT * FROM audit_security.entries WHERE tenant_id=$1::uuid AND position=$2::bigint',[base.tenantId,current.auditCount]);
        if(last.rows.length!==1||entry(last.rows[0],base.tenantId).entryHash!==current.headHash)throw fail();
      }
      if(current.auditCount===Number.MAX_SAFE_INTEGER)throw fail();
      const clock=await tx.query('SELECT clock_timestamp() AS stamp');if(clock.rows.length!==1)throw fail();
      const payload={...base,position:current.auditCount+1,createdAt:new Date(clock.rows[0].stamp).toISOString(),requestHash};
      const canonical=canonicalAuditPayload(payload),entryHash=auditEntryHash(current.headHash,payload);
      const inserted=await tx.query(`INSERT INTO audit_security.entries(tenant_id,position,event_id,created_at,request_hash,previous_hash,entry_hash,canonical_payload)
        VALUES($1::uuid,$2::bigint,$3::uuid,$4::timestamptz,$5,$6,$7,$8) RETURNING *`,[base.tenantId,payload.position,base.eventId,payload.createdAt,requestHash,current.headHash,entryHash,canonical]);
      if(inserted.rows.length!==1)throw fail();const receipt=entry(inserted.rows[0],base.tenantId);
      const advanced=await tx.query('SELECT position,head_hash FROM audit_security.tenant_heads WHERE tenant_id=$1::uuid',[base.tenantId]);
      if(advanced.rows.length!==1||head(advanced.rows[0]).auditCount!==payload.position||advanced.rows[0].head_hash!==entryHash)throw fail();
      return Object.freeze({...receipt,replayed:false});
    },{signal});}catch(error){
      if(error.message==='POSTGRES_TRANSACTION_OUTCOME_UNKNOWN')throw new Error('AUDIT_APPEND_OUTCOME_UNKNOWN');
      if(conflict)throw new Error('AUDIT_EVENT_CONFLICT');throw fail();
    }
  }
  async probe({tenantId,eventId}={}) {
    try{await securityProbe(this.#options,writer);await this.append({tenantId,eventId,actorId:'system:audit-probe',traceId:'audit-probe',action:'AUDIT_SINK_PROBE',outcome:'SUCCESS'});return Object.freeze({ok:true});}
    catch{throw fail();}
  }
}

export class PostgresAuditReader {
  #options;#anchor;#max;
  constructor({resolveTrustedAnchor=null,maxVerificationEntries=10000,...options}={}){
    if(resolveTrustedAnchor!==null&&typeof resolveTrustedAnchor!=='function'||!Number.isInteger(maxVerificationEntries)||maxVerificationEntries<1||maxVerificationEntries>100000)throw new Error('SHARED_AUDIT_CONFIGURATION_INVALID');
    this.#options=securityOptions(options);this.#anchor=resolveTrustedAnchor;this.#max=maxVerificationEntries;
  }
  async verify({tenantId,signal}={}) {
    tenantId=uuid(tenantId);
    try{return await securityTransaction(this.#options,reader,async tx=>{
      await triggers(tx);
      const found=await tx.query('SELECT position,head_hash FROM audit_security.tenant_heads WHERE tenant_id=$1::uuid',[tenantId]);
      if(found.rows.length>1)throw fail();const current=head(found.rows[0]);
      if(current.auditCount>this.#max)throw fail();
      let anchor=null;
      if(this.#anchor){
        anchor=await this.#anchor(Object.freeze({tenantId,signal:tx.signal}));
        shape(anchor,['tenantId','auditCount','headHash']);
        if(uuid(anchor.tenantId)!==tenantId||position(anchor.auditCount,1)>current.auditCount||!HEX.test(anchor.headHash))throw fail();
        anchor=Object.freeze({tenantId,auditCount:position(anchor.auditCount,1),headHash:anchor.headHash});
      }
      let previous=GENESIS,anchorMatched=false,expected=1;
      let previousAt=-Infinity;
      while(expected<=current.auditCount){
        const rows=await tx.query('SELECT * FROM audit_security.entries WHERE tenant_id=$1::uuid AND position>=$2::bigint AND position<=$3::bigint ORDER BY position LIMIT 1000',[tenantId,expected,current.auditCount]);
        if(rows.rows.length===0)throw fail();
        for(const row of rows.rows){
          const item=entry(row,tenantId),at=Date.parse(item.createdAt);
          if(item.position!==expected++||item.previousHash!==previous||at<previousAt)throw fail();previous=item.entryHash;previousAt=at;
          if(anchor&&item.position===position(anchor.auditCount,1)){if(item.entryHash!==anchor.headHash)throw fail();anchorMatched=true;}
        }
      }
      const count=await tx.query('SELECT count(*)::text AS total FROM audit_security.entries WHERE tenant_id=$1::uuid',[tenantId]);
      if(count.rows.length!==1||position(count.rows[0].total)!==current.auditCount||previous!==current.headHash||anchor&&!anchorMatched)throw fail();
      return Object.freeze({ok:true,tenantId,...current,anchorVerified:anchorMatched});
    },{readOnly:true,isolation:'REPEATABLE READ',signal});}catch{throw new Error('AUDIT_INTEGRITY_UNAVAILABLE');}
  }
  async probe(tenantId){
    if(!this.#anchor)throw new Error('AUDIT_TRUSTED_ANCHOR_REQUIRED');
    await securityProbe(this.#options,reader);const result=await this.verify({tenantId});
    if(!result.anchorVerified)throw new Error('AUDIT_TRUSTED_ANCHOR_REQUIRED');return Object.freeze({ok:true});
  }
}

export function createPostgresAuditBoundary({writerPool,expectedWriterRole,readerPool,expectedReaderRole,resolveTrustedAnchor,readinessTenantId,probeEventId,maxVerificationEntries=10000,timeoutMs=5000}={}) {
  uuid(readinessTenantId);uuid(probeEventId);if(typeof resolveTrustedAnchor!=='function')throw new Error('AUDIT_TRUSTED_ANCHOR_REQUIRED');
  const auditWriter=new PostgresAuditWriter({pool:writerPool,expectedRole:expectedWriterRole,timeoutMs});
  const auditReader=new PostgresAuditReader({pool:readerPool,expectedRole:expectedReaderRole,resolveTrustedAnchor,maxVerificationEntries,timeoutMs});
  return Object.freeze({auditWriter,auditReader,auditProbe:async()=>{
    await auditWriter.probe({tenantId:readinessTenantId,eventId:probeEventId});return auditReader.probe(readinessTenantId);
  }});
}
