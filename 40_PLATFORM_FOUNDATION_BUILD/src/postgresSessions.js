import crypto from 'node:crypto';
import {normalizeSession} from './auth.js';
import {appError} from './errors.js';
import {runPostgresTransaction} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ROLE=/^[a-z_][a-z0-9_]{0,62}$/;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const authError=()=>appError('authentication required',{status:401,code:'AUTH_REQUIRED'});
const tokenValid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value)&&Buffer.from(value,'base64url').length===32&&Buffer.from(value,'base64url').toString('base64url')===value;
const brokerSql=`SELECT pg_has_role(current_user,'legaltech_session_broker','MEMBER') AS broker,
  EXISTS (SELECT 1 FROM pg_roles z WHERE pg_has_role(current_user,z.oid,'MEMBER')
    AND (z.rolsuper OR z.rolbypassrls OR z.rolcreatedb OR z.rolcreaterole OR z.rolreplication
      OR z.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program',
        'legaltech_security_reader','legaltech_security_operator','legaltech_rate_limiter','legaltech_audit_writer','legaltech_audit_reader','legaltech_queue_producer','legaltech_queue_worker','legaltech_queue_reader','legaltech_outbox_writer','legaltech_outbox_relay','legaltech_domain_commands','legaltech_job_domain_reader','legaltech_domain_result_writer','legaltech_drain_owner','legaltech_drain_worker','legaltech_drain_operator','legaltech_drain_reader')))
    OR has_database_privilege(current_user,current_database(),'CREATE') AS privileged,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='identity_security' AND pg_has_role(current_user,c.relowner,'MEMBER')) AS owns_relations,
  EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname='identity_security'
    AND (pg_has_role(current_user,n.nspowner,'MEMBER') OR has_schema_privilege(current_user,n.oid,'CREATE'))) AS owns_schema,
  EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','operational_security','audit_security','queue_security','drain_security') AND c.relkind IN ('r','p','v','m','f')
      AND (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')
        OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='drain_security' AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS can_access_domain
  FROM pg_roles r WHERE r.rolname=current_user`;

export class PostgresServerSessionStore {
  #options;#resolve;#namespace;#absolute;#idle;
  constructor({brokerPool,expectedRole,resolveIdentity,providerNamespace,absoluteTtlMs=8*60*60_000,idleTtlMs=30*60_000,timeoutMs=5000}={}) {
    let namespace;
    try {if(typeof providerNamespace!=='string'||providerNamespace.length>512)throw authError();namespace=new URL(providerNamespace);if(namespace.protocol!=='https:'||namespace.username||namespace.password||namespace.hash||namespace.search)throw authError();}catch{throw new Error('SHARED_SESSION_CONFIGURATION_INVALID');}
    if(typeof brokerPool?.connect!=='function'||!ROLE.test(expectedRole??'')||typeof resolveIdentity!=='function'
      ||!Number.isInteger(absoluteTtlMs)||absoluteTtlMs<300000||absoluteTtlMs>86400000
      ||!Number.isInteger(idleTtlMs)||idleTtlMs<60000||idleTtlMs>7200000||idleTtlMs>absoluteTtlMs
      ||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)throw new Error('SHARED_SESSION_CONFIGURATION_INVALID');
    this.#options={pool:brokerPool,expectedRole,timeoutMs};this.#resolve=resolveIdentity;
    this.#namespace=namespace.href;this.#absolute=absoluteTtlMs;this.#idle=idleTtlMs;
  }
  #providerHash(sid) {
    if(sid===null||sid===undefined)return null;
    if(typeof sid!=='string'||!sid||sid.length>512)throw authError();
    return hash(JSON.stringify([this.#namespace,sid]));
  }
  async #run(work,signal) {
    try {
      return await runPostgresTransaction({...this.#options,signal},async tx=>{
        const result=await tx.query(brokerSql),role=result.rows?.[0];
        if(result.rows?.length!==1||role.broker!==true||role.privileged!==false||role.owns_relations!==false||role.owns_schema!==false||role.can_access_domain!==false)throw authError();
        return work(tx);
      });
    } catch {throw authError();}
  }
  async issue(session,{signal}={}) {
    const normalized=normalizeSession(session);
    if(!UUID.test(normalized.tenantId)||!UUID.test(normalized.actorId)||normalized.authContext.method!=='OIDC'||normalized.authContext.expiresAt===null)throw authError();
    const token=crypto.randomBytes(32).toString('base64url'),tokenHash=hash(token),sessionId=crypto.randomUUID();
    const providerHash=this.#providerHash(normalized.authContext.providerSessionId);
    return this.#run(async tx=>{
      const result=await tx.query(`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS stamp)
        INSERT INTO identity_security.server_sessions
        (token_hash,session_id,tenant_id,actor_id,mfa_verified,auth_time,provider_session_hash,created_at,expires_at,idle_timeout_ms,last_seen_at)
        SELECT $1,$2::uuid,$3::uuid,$4::uuid,$5,$6::timestamptz,$7::text,stamp,
          LEAST(stamp+($8::bigint*interval '1 millisecond'),$9::timestamptz),$10,stamp
        FROM moment
        WHERE LEAST(stamp+($8::bigint*interval '1 millisecond'),$9::timestamptz)>stamp
          AND ($7::text IS NULL OR NOT EXISTS (SELECT 1 FROM identity_security.provider_session_revocations r WHERE r.provider_session_hash=$7))
        RETURNING expires_at,GREATEST(1,floor(extract(epoch FROM (expires_at-created_at))))::integer AS max_age_seconds`,
      [tokenHash,sessionId,normalized.tenantId,normalized.actorId,normalized.authContext.mfaVerified,normalized.authContext.authTime,providerHash,this.#absolute,normalized.authContext.expiresAt,this.#idle]);
      if(result.rows?.length!==1)throw authError();
      const row=result.rows[0];
      return Object.freeze({token,expiresAt:new Date(row.expires_at).toISOString(),maxAgeSeconds:row.max_age_seconds});
    },signal);
  }
  async get(token,{touch=true,signal}={}) {
    if(!tokenValid(token)||typeof touch!=='boolean')throw authError();
    return this.#run(async tx=>{
      const tokenHash=hash(token);
      const initial=await tx.query(`SELECT tenant_id,actor_id FROM identity_security.server_sessions
        WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()
          AND last_seen_at+(idle_timeout_ms*interval '1 millisecond')>clock_timestamp()`,[tokenHash]);
      if(initial.rows?.length!==1)throw authError();
      const binding=initial.rows[0];
      const current=normalizeSession(await this.#resolve(Object.freeze({tenantId:binding.tenant_id,actorId:binding.actor_id}),{signal:tx.signal}));
      if(current.tenantId!==binding.tenant_id||current.actorId!==binding.actor_id)throw authError();
      // Recheck revocation/expiry AFTER the asynchronous directory lookup.
      const result=await tx.query(`UPDATE identity_security.server_sessions s
        SET last_seen_at=CASE WHEN $2 THEN clock_timestamp() ELSE s.last_seen_at END
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
          AND s.last_seen_at+(s.idle_timeout_ms*interval '1 millisecond')>clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM identity_security.provider_session_revocations r WHERE r.provider_session_hash=s.provider_session_hash)
        RETURNING s.session_id,s.tenant_id,s.actor_id,s.mfa_verified,s.auth_time,s.expires_at`,[tokenHash,touch]);
      if(result.rows?.length!==1)throw authError();
      const row=result.rows[0];
      if(row.tenant_id!==current.tenantId||row.actor_id!==current.actorId)throw authError();
      return normalizeSession({...current,sessionId:row.session_id,authContext:{method:'SERVER_SESSION',mfaVerified:row.mfa_verified,
        authTime:row.auth_time===null?null:new Date(row.auth_time).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),providerSessionId:null}});
    },signal);
  }
  async revoke(token,{signal}={}) {
    if(!tokenValid(token))return false;
    return this.#run(async tx=>{
      const result=await tx.query(`UPDATE identity_security.server_sessions SET revoked_at=clock_timestamp()
        WHERE token_hash=$1 AND revoked_at IS NULL RETURNING token_hash`,[hash(token)]);
      return result.rows.length===1;
    },signal);
  }
  async revokeProviderSession(providerSessionId,{signal}={}) {
    const providerHash=this.#providerHash(providerSessionId);if(providerHash===null)throw authError();
    return this.#run(async tx=>{
      await tx.query(`INSERT INTO identity_security.provider_session_revocations(provider_session_hash)
        VALUES($1) ON CONFLICT(provider_session_hash) DO NOTHING`,[providerHash]);
      const result=await tx.query(`UPDATE identity_security.server_sessions SET revoked_at=clock_timestamp()
        WHERE provider_session_hash=$1 AND revoked_at IS NULL RETURNING token_hash`,[providerHash]);
      return result.rows.length;
    },signal);
  }
  async probe({signal}={}) {
    try {await this.#run(async tx=>{
      const state=await tx.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,row_security_active(c.oid) AS active
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='identity_security' AND c.relname IN ('server_sessions','provider_session_revocations')`);
      if(state.rows?.length!==2||state.rows.some(r=>r.relrowsecurity!==true||r.relforcerowsecurity!==true||r.active!==true))throw authError();
      await tx.query('SELECT token_hash FROM identity_security.server_sessions LIMIT 0');
      await tx.query('SELECT provider_session_hash FROM identity_security.provider_session_revocations LIMIT 0');
      const grants=await tx.query(`SELECT has_table_privilege(current_user,'identity_security.server_sessions','SELECT') AS can_read,
        has_table_privilege(current_user,'identity_security.server_sessions','INSERT') AS can_issue,
        has_column_privilege(current_user,'identity_security.server_sessions','last_seen_at','UPDATE') AS can_touch,
        has_column_privilege(current_user,'identity_security.server_sessions','revoked_at','UPDATE') AS can_revoke,
        has_column_privilege(current_user,'identity_security.server_sessions','expires_at','UPDATE') AS can_rewrite,
        has_table_privilege(current_user,'identity_security.server_sessions','DELETE,TRUNCATE') AS can_remove,
        has_table_privilege(current_user,'identity_security.provider_session_revocations','SELECT') AS can_read_revocations,
        has_table_privilege(current_user,'identity_security.provider_session_revocations','INSERT') AS can_record_revocations,
        has_table_privilege(current_user,'identity_security.provider_session_revocations','UPDATE,DELETE,TRUNCATE') AS can_remove_revocations`);
      const g=grants.rows?.[0];
      if(grants.rows?.length!==1||['can_read','can_issue','can_touch','can_revoke','can_read_revocations','can_record_revocations'].some(k=>g[k]!==true)
        ||['can_rewrite','can_remove','can_remove_revocations'].some(k=>g[k]!==false))throw authError();
    },signal);return {ok:true,code:'SHARED_SESSION_STORE_READY'};}catch{return {ok:false,code:'SHARED_SESSION_STORE_UNAVAILABLE'};}
  }
}
