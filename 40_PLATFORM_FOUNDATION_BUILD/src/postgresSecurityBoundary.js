import {runPostgresTransaction} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';

const GROUPS=['legaltech_security_reader','legaltech_security_operator','legaltech_rate_limiter','legaltech_session_broker','legaltech_audit_writer','legaltech_audit_reader','legaltech_queue_producer','legaltech_queue_worker','legaltech_queue_reader','legaltech_outbox_writer','legaltech_outbox_relay','legaltech_domain_commands','legaltech_job_domain_reader','legaltech_domain_result_writer','legaltech_drain_owner','legaltech_drain_worker','legaltech_drain_operator','legaltech_drain_reader','legaltech_graph_producer','legaltech_graph_worker','legaltech_graph_reader','legaltech_domain_reviewer'];
const SCHEMA={legaltech_graph_producer:'graph_security',legaltech_graph_worker:'graph_security',legaltech_graph_reader:'graph_security',legaltech_job_domain_reader:'public',legaltech_outbox_relay:'public',legaltech_audit_writer:'audit_security',legaltech_audit_reader:'audit_security',legaltech_queue_producer:'queue_security',legaltech_queue_worker:'queue_security',legaltech_queue_reader:'queue_security'};
const ALLOWED={
  legaltech_graph_producer:['notifications','receipts'],
  legaltech_graph_worker:['notifications','receipts'],
  legaltech_graph_reader:['notifications','receipts'],
  legaltech_job_domain_reader:['tenants','actors','matters','inbound_events','domain_job_commands','domain_outbox_events','matter_actor_access','matter_break_glass_grants','actor_security_zones'],
  legaltech_outbox_relay:['domain_outbox_events','domain_outbox_receipts'],
  legaltech_security_reader:['interlocks','interlock_events'],
  legaltech_security_operator:['interlocks','interlock_events'],
  legaltech_rate_limiter:['rate_buckets','read_matters','rate_configuration'],
  legaltech_audit_writer:['tenant_heads','entries'],
  legaltech_audit_reader:['tenant_heads','entries'],
  legaltech_queue_producer:['jobs','job_results'],
  legaltech_queue_worker:['jobs','job_results'],
  legaltech_queue_reader:['jobs','job_results'],
};
const PRIVILEGES={
  legaltech_graph_producer:`has_table_privilege(current_user,'graph_security.notifications','SELECT')
    AND NOT has_table_privilege(current_user,'graph_security.notifications','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.notifications'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY['tenant_id','subscription_id','notification_fingerprint','source_evidence_hash','source_version_hash','event_type','request_hash','max_attempts']::name[])))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.notifications'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname=ANY(ARRAY[]::name[])))
    AND has_table_privilege(current_user,'graph_security.receipts','SELECT')
    AND NOT has_table_privilege(current_user,'graph_security.receipts','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY[]::name[])))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname=ANY(ARRAY[]::name[])))`,
  legaltech_graph_worker:`has_table_privilege(current_user,'graph_security.notifications','SELECT')
    AND NOT has_table_privilege(current_user,'graph_security.notifications','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.notifications'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY[]::name[])))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.notifications'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname=ANY(ARRAY['status','attempts','worker_id','token_hash','error_code']::name[])))
    AND has_table_privilege(current_user,'graph_security.receipts','SELECT')
    AND NOT has_table_privilege(current_user,'graph_security.receipts','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY['tenant_id','subscription_id','notification_fingerprint','attempt','worker_id','token_hash','outcome_hash']::name[])))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname=ANY(ARRAY[]::name[])))`,
  legaltech_graph_reader:`has_table_privilege(current_user,'graph_security.notifications','SELECT')
    AND NOT has_table_privilege(current_user,'graph_security.notifications','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.notifications'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY[]::name[])))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.notifications'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname=ANY(ARRAY[]::name[])))
    AND has_table_privilege(current_user,'graph_security.receipts','SELECT')
    AND NOT has_table_privilege(current_user,'graph_security.receipts','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY[]::name[])))
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='graph_security.receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname=ANY(ARRAY[]::name[])))`,
  legaltech_job_domain_reader:`NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY['tenants','actors','matters','inbound_events','domain_job_commands','domain_outbox_events','matter_actor_access','matter_break_glass_grants','actor_security_zones'])
      AND (NOT has_table_privilege(current_user,c.oid,'SELECT') OR has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE')))`,
  legaltech_outbox_relay:`has_table_privilege(current_user,'public.domain_outbox_events','SELECT')
    AND NOT has_table_privilege(current_user,'public.domain_outbox_events','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'public.domain_outbox_events','INSERT,UPDATE')
    AND has_table_privilege(current_user,'public.domain_outbox_receipts','SELECT')
    AND NOT has_table_privilege(current_user,'public.domain_outbox_receipts','UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'public.domain_outbox_receipts','UPDATE')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.domain_outbox_receipts'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY['tenant_id','job_id','request_hash']::name[])))`,
  legaltech_queue_producer:`has_table_privilege(current_user,'queue_security.jobs','SELECT')
    AND has_table_privilege(current_user,'queue_security.jobs','INSERT')
    AND NOT has_table_privilege(current_user,'queue_security.jobs','UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'queue_security.jobs','UPDATE')
    AND has_table_privilege(current_user,'queue_security.job_results','SELECT')
    AND NOT has_table_privilege(current_user,'queue_security.job_results','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege(current_user,'queue_security.job_results','UPDATE')
    AND NOT has_any_column_privilege(current_user,'queue_security.job_results','INSERT')`,
  legaltech_queue_reader:`has_table_privilege(current_user,'queue_security.jobs','SELECT')
    AND NOT has_table_privilege(current_user,'queue_security.jobs','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'queue_security.jobs','INSERT,UPDATE')
    AND has_table_privilege(current_user,'queue_security.job_results','SELECT')
    AND NOT has_table_privilege(current_user,'queue_security.job_results','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege(current_user,'queue_security.job_results','UPDATE')
    AND NOT has_any_column_privilege(current_user,'queue_security.job_results','INSERT')`,
  legaltech_queue_worker:`has_table_privilege(current_user,'queue_security.jobs','SELECT')
    AND NOT has_table_privilege(current_user,'queue_security.jobs','INSERT,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'queue_security.jobs','INSERT')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='queue_security.jobs'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(current_user,a.attrelid,a.attnum,'UPDATE')<>(a.attname=ANY(ARRAY['status','attempts','worker_id','lease_token_hash','lease_until','run_until','started_at','available_at','last_error_code','result_code','updated_at']::name[])))
    AND has_table_privilege(current_user,'queue_security.job_results','SELECT')
    AND NOT has_table_privilege(current_user,'queue_security.job_results','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_any_column_privilege(current_user,'queue_security.job_results','UPDATE')
    AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='queue_security.job_results'::regclass AND a.attnum>0 AND NOT a.attisdropped
      AND has_column_privilege(current_user,a.attrelid,a.attnum,'INSERT')<>(a.attname=ANY(ARRAY['tenant_id','job_id','kind','object_id','command_id','command_hash','artifact_hash','result_hash','result_code','attempt','worker_id','token_hash']::name[])))`,
  legaltech_audit_writer:`has_table_privilege(current_user,'audit_security.entries','SELECT')
    AND has_table_privilege(current_user,'audit_security.entries','INSERT')
    AND NOT has_table_privilege(current_user,'audit_security.entries','UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'audit_security.entries','UPDATE')
    AND has_table_privilege(current_user,'audit_security.tenant_heads','SELECT')
    AND has_table_privilege(current_user,'audit_security.tenant_heads','INSERT')
    AND has_column_privilege(current_user,'audit_security.tenant_heads','position','UPDATE')
    AND has_column_privilege(current_user,'audit_security.tenant_heads','head_hash','UPDATE')
    AND NOT has_column_privilege(current_user,'audit_security.tenant_heads','tenant_id','UPDATE')
    AND NOT has_table_privilege(current_user,'audit_security.tenant_heads','DELETE,TRUNCATE')`,
  legaltech_audit_reader:`has_table_privilege(current_user,'audit_security.entries','SELECT')
    AND has_table_privilege(current_user,'audit_security.tenant_heads','SELECT')
    AND NOT has_table_privilege(current_user,'audit_security.entries','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'audit_security.entries','INSERT,UPDATE')
    AND NOT has_table_privilege(current_user,'audit_security.tenant_heads','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'audit_security.tenant_heads','INSERT,UPDATE')`,
  legaltech_security_reader:`has_table_privilege(current_user,'operational_security.interlocks','SELECT')
    AND has_table_privilege(current_user,'operational_security.interlock_events','SELECT')
    AND NOT has_table_privilege(current_user,'operational_security.interlocks','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'operational_security.interlocks','INSERT,UPDATE')
    AND NOT has_table_privilege(current_user,'operational_security.interlock_events','INSERT,UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'operational_security.interlock_events','INSERT,UPDATE')`,
  legaltech_security_operator:`has_table_privilege(current_user,'operational_security.interlocks','SELECT')
    AND has_table_privilege(current_user,'operational_security.interlocks','INSERT')
    AND has_table_privilege(current_user,'operational_security.interlocks','UPDATE')
    AND has_table_privilege(current_user,'operational_security.interlock_events','SELECT')
    AND has_table_privilege(current_user,'operational_security.interlock_events','INSERT')
    AND NOT has_table_privilege(current_user,'operational_security.interlocks','DELETE,TRUNCATE')
    AND NOT has_table_privilege(current_user,'operational_security.interlock_events','UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'operational_security.interlock_events','UPDATE')`,
  legaltech_rate_limiter:`has_table_privilege(current_user,'operational_security.rate_buckets','SELECT')
    AND has_table_privilege(current_user,'operational_security.rate_configuration','SELECT')
    AND has_table_privilege(current_user,'operational_security.rate_configuration','INSERT')
    AND NOT has_table_privilege(current_user,'operational_security.rate_configuration','UPDATE,DELETE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'operational_security.rate_configuration','UPDATE')
    AND has_table_privilege(current_user,'operational_security.rate_buckets','INSERT')
    AND has_column_privilege(current_user,'operational_security.rate_buckets','records','UPDATE')
    AND has_column_privilege(current_user,'operational_security.rate_buckets','window_id','UPDATE')
    AND has_column_privilege(current_user,'operational_security.rate_buckets','started_at','UPDATE')
    AND NOT has_table_privilege(current_user,'operational_security.rate_buckets','DELETE,TRUNCATE')
    AND NOT has_column_privilege(current_user,'operational_security.rate_buckets','window_ms','UPDATE')
    AND NOT has_column_privilege(current_user,'operational_security.rate_buckets','record_limit','UPDATE')
    AND NOT has_column_privilege(current_user,'operational_security.rate_buckets','matter_limit','UPDATE')
    AND NOT has_column_privilege(current_user,'operational_security.rate_buckets','scope','UPDATE')
    AND NOT has_column_privilege(current_user,'operational_security.rate_buckets','bucket_hash','UPDATE')
    AND has_table_privilege(current_user,'operational_security.read_matters','SELECT')
    AND has_table_privilege(current_user,'operational_security.read_matters','INSERT')
    AND has_table_privilege(current_user,'operational_security.read_matters','DELETE')
    AND NOT has_table_privilege(current_user,'operational_security.read_matters','UPDATE,TRUNCATE')
    AND NOT has_any_column_privilege(current_user,'operational_security.read_matters','UPDATE')`,
};
export function securityOptions({pool,expectedRole,timeoutMs=5000}={}) {
  if(typeof pool?.connect!=='function'||!/^[a-z_][a-z0-9_]{0,62}$/.test(expectedRole??'')||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)throw new Error('SHARED_SECURITY_CONFIGURATION_INVALID');
  return {pool,expectedRole,timeoutMs};
}
export async function securityTransaction(options,group,work,{readOnly=false,isolation='READ COMMITTED',context=null,signal}={}) {
  const schema=SCHEMA[group]??'operational_security';
  const others=GROUPS.filter(x=>x!==group&&!(group==='legaltech_security_operator'&&x==='legaltech_security_reader')&&!(group==='legaltech_audit_writer'&&x==='legaltech_audit_reader')&&!(['legaltech_queue_producer','legaltech_queue_worker'].includes(group)&&x==='legaltech_queue_reader'));
  return runPostgresTransaction({...options,readOnly,isolation,context,signal},async tx=>{
    const result=await tx.query(`SELECT pg_has_role(current_user,$1,'MEMBER') AS member,
      EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND
        (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
          OR r.rolname=ANY($2::text[]) OR r.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program')))
        OR has_database_privilege(current_user,current_database(),'CREATE') AS privileged,
      EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','identity_security','operational_security','audit_security','queue_security','drain_security','graph_security')
        AND (pg_has_role(current_user,n.nspowner,'MEMBER') OR has_schema_privilege(current_user,n.oid,'CREATE'))) AS owns_schema,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','identity_security','operational_security','audit_security','queue_security','drain_security','graph_security') AND c.relkind IN ('r','p','v','m','f')
          AND (pg_has_role(current_user,c.relowner,'MEMBER') OR
            ((n.nspname<>$4 OR c.relname<>ALL($3::text[])) AND
              (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))))) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='drain_security' AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS outside_access`,[group,others,ALLOWED[group],schema]);
    const row=result.rows?.[0];
    if(result.rows?.length!==1||row.member!==true||row.privileged!==false||row.owns_schema!==false||row.outside_access!==false)throw new Error('SHARED_SECURITY_ROLE_UNSAFE');
    const privileges=await tx.query(`SELECT (${PRIVILEGES[group]}) AS grants_safe`);
    if(privileges.rows?.length!==1||privileges.rows[0].grants_safe!==true)throw new Error('SHARED_SECURITY_GRANTS_UNSAFE');
    return work(tx);
  });
}
export async function securityProbe(options,group) {
  const schema=SCHEMA[group]??'operational_security';
  return securityTransaction(options,group,async tx=>{
    const result=await tx.query(`SELECT c.relname,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,row_security_active(c.oid) AS active
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$2 AND c.relname=ANY($1::text[])`,[ALLOWED[group],schema]);
    if(result.rows.length!==ALLOWED[group].length||result.rows.some(x=>x.enabled!==true||x.forced!==true||x.active!==true))throw new Error('SHARED_SECURITY_RLS_UNSAFE');
    for(const table of ALLOWED[group])await tx.query(`SELECT 1 FROM ${schema}.${table} LIMIT 0`);
    return Object.freeze({ok:true});
  },{readOnly:true});
}
