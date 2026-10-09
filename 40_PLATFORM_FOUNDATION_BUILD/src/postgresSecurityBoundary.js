import {runPostgresTransaction} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';

const GROUPS=['legaltech_security_reader','legaltech_security_operator','legaltech_rate_limiter','legaltech_session_broker'];
const ALLOWED={
  legaltech_security_reader:['interlocks','interlock_events'],
  legaltech_security_operator:['interlocks','interlock_events'],
  legaltech_rate_limiter:['rate_buckets','read_matters','rate_configuration'],
};
const PRIVILEGES={
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
export async function securityTransaction(options,group,work,{readOnly=false,signal}={}) {
  const others=GROUPS.filter(x=>x!==group&&!(group==='legaltech_security_operator'&&x==='legaltech_security_reader'));
  return runPostgresTransaction({...options,readOnly,signal},async tx=>{
    const result=await tx.query(`SELECT pg_has_role(current_user,$1,'MEMBER') AS member,
      EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND
        (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
          OR r.rolname=ANY($2::text[]) OR r.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program')))
        OR has_database_privilege(current_user,current_database(),'CREATE') AS privileged,
      EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','identity_security','operational_security')
        AND (pg_has_role(current_user,n.nspowner,'MEMBER') OR has_schema_privilege(current_user,n.oid,'CREATE'))) AS owns_schema,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname IN ('public','identity_security','operational_security') AND c.relkind IN ('r','p','v','m','f')
          AND (pg_has_role(current_user,c.relowner,'MEMBER') OR
            ((n.nspname<>'operational_security' OR c.relname<>ALL($3::text[])) AND
              (has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
                OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))))) AS outside_access`,[group,others,ALLOWED[group]]);
    const row=result.rows?.[0];
    if(result.rows?.length!==1||row.member!==true||row.privileged!==false||row.owns_schema!==false||row.outside_access!==false)throw new Error('SHARED_SECURITY_ROLE_UNSAFE');
    const privileges=await tx.query(`SELECT (${PRIVILEGES[group]}) AS grants_safe`);
    if(privileges.rows?.length!==1||privileges.rows[0].grants_safe!==true)throw new Error('SHARED_SECURITY_GRANTS_UNSAFE');
    return work(tx);
  });
}
export async function securityProbe(options,group) {
  return securityTransaction(options,group,async tx=>{
    const result=await tx.query(`SELECT c.relname,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,row_security_active(c.oid) AS active
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='operational_security' AND c.relname=ANY($1::text[])`,[ALLOWED[group]]);
    if(result.rows.length!==ALLOWED[group].length||result.rows.some(x=>x.enabled!==true||x.forced!==true||x.active!==true))throw new Error('SHARED_SECURITY_RLS_UNSAFE');
    for(const table of ALLOWED[group])await tx.query(`SELECT 1 FROM operational_security.${table} LIMIT 0`);
    return Object.freeze({ok:true});
  },{readOnly:true});
}
