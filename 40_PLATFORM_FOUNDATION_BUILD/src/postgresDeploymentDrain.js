import crypto from 'node:crypto';
import {runPostgresTransaction} from '../../30_PRODUCTION_SHAPE_SCAFFOLD/src/postgresTransactions.js';
import {DRAIN_FUNCTION_HASHES} from './postgresDrainFunctionHashes.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ROLE=/^[a-z_][a-z0-9_]{0,62}$/,TOKEN=/^[a-f0-9]{64}$/;
const GROUPS=['legaltech_session_broker','legaltech_security_reader','legaltech_security_operator','legaltech_rate_limiter','legaltech_audit_writer','legaltech_audit_reader',
  'legaltech_queue_producer','legaltech_queue_worker','legaltech_queue_reader','legaltech_outbox_writer','legaltech_outbox_relay','legaltech_domain_commands','legaltech_job_domain_reader','legaltech_domain_result_writer',
  'legaltech_drain_owner','legaltech_drain_worker','legaltech_drain_operator','legaltech_drain_reader'];
const TABLES=['principal_scopes','deployments','leases','controls','events'];
const unavailable=()=>new Error('POSTGRES_DRAIN_UNVERIFIED');
function exact(value,keys){return value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(value,k)??{},'value'));}
function requireId(v){if(typeof v!=='string'||!ID.test(v))throw unavailable();return v;}
function validateSignal(v){if(v!==undefined&&(typeof v?.aborted!=='boolean'||typeof v.addEventListener!=='function'||typeof v.removeEventListener!=='function'))throw unavailable();}
function lease(v){if(!exact(v,['token','generation'])||!TOKEN.test(v.token??'')||!Number.isSafeInteger(v.generation)||v.generation<1)throw unavailable();return Object.freeze({...v});}
function status(v){if(!exact(v,['state','generation','inFlight','acceptingNew'])||!['ACTIVE','DRAINING','DRAINED'].includes(v.state)||!Number.isSafeInteger(v.generation)||v.generation<1
  ||!Number.isSafeInteger(v.inFlight)||v.inFlight<0||v.acceptingNew!==(v.state==='ACTIVE')||(v.state==='DRAINED'&&v.inFlight!==0))throw unavailable();return Object.freeze({...v});}

async function posture(tx,group){
  const row=(await tx.query(`SELECT pg_has_role(current_user,$1,'MEMBER') AS member,
    EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role(current_user,r.oid,'MEMBER') AND
      ((r.rolname=$1 AND r.rolcanlogin) OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolname=ANY($2::text[])
        OR r.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program')))
      OR has_database_privilege(current_user,current_database(),'CREATE') AS privileged,
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','identity_security','operational_security','audit_security','queue_security','drain_security')
      AND (pg_has_role(current_user,n.nspowner,'MEMBER') OR has_schema_privilege(current_user,n.oid,'CREATE'))) AS owns_schema,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE
      n.nspname IN ('public','identity_security','operational_security','audit_security','queue_security','drain_security') AND c.relkind IN ('r','p','v','m','f')
      AND (pg_has_role(current_user,c.relowner,'MEMBER') OR has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))) AS table_access,
    EXISTS(SELECT 1 FROM pg_roles r WHERE pg_has_role('legaltech_drain_owner',r.oid,'MEMBER') AND
      (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR (r.rolname='legaltech_drain_owner' AND r.rolcanlogin)
        OR r.rolname=ANY($3::text[]) OR r.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files','pg_write_server_files','pg_execute_server_program'))) AS owner_unsafe`,
    [group,GROUPS.filter(k=>k!==group),GROUPS.filter(k=>k!=='legaltech_drain_owner')])).rows;
  if(row?.length!==1||row[0].member!==true||['privileged','owns_schema','table_access','owner_unsafe'].some(k=>row[0][k]!==false))throw unavailable();
  const relations=(await tx.query(`SELECT c.relname,c.relrowsecurity AS enabled,c.relforcerowsecurity AS forced,r.rolname AS owner,
    (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policy_count,
    EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname='drain_security' AND p.tablename=c.relname AND p.policyname='owner_only'
      AND p.roles=ARRAY['legaltech_drain_owner']::name[] AND p.cmd='ALL' AND p.qual='true' AND p.with_check='true') AS owner_policy
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='drain_security' AND c.relkind IN ('r','p')`)).rows;
  if(relations?.length!==TABLES.length||new Set(relations.map(r=>r.relname)).size!==TABLES.length||relations.some(r=>!TABLES.includes(r.relname)
    ||r.enabled!==true||r.forced!==true||r.owner!=='legaltech_drain_owner'||String(r.policy_count)!=='1'||r.owner_policy!==true))throw unavailable();
  const functions=(await tx.query(`SELECT p.proname,p.prosecdef AS definer,p.proconfig AS config,r.rolname AS owner,
    pg_get_function_identity_arguments(p.oid) AS arguments,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS source_hash,
    has_function_privilege(current_user,p.oid,'EXECUTE') AS executable,
    EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='drain_security'`)).rows;
  if(functions?.length!==3||new Set(functions.map(f=>f.proname)).size!==3)throw unavailable();
  for(const f of functions){const expected=DRAIN_FUNCTION_HASHES[f.proname];
    if(!expected||f.source_hash!==expected.hash||f.arguments!==expected.arguments||f.owner!=='legaltech_drain_owner'||f.public_execute!==false
      ||f.definer!==(f.proname==='operate')||f.executable!==(f.proname==='operate')||!Array.isArray(f.config)||f.config.length!==2
      ||!f.config.includes('row_security=on')||!f.config.some(c=>c.replaceAll(' ','')==='search_path=pg_catalog,pg_temp'))throw unavailable();
  }
  const outside=(await tx.query(`SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','identity_security','operational_security','audit_security','queue_security') AND p.prosecdef
      AND has_function_privilege(current_user,p.oid,'EXECUTE')) AS unsafe`)).rows;
  if(outside?.length!==1||outside[0].unsafe!==false)throw unavailable();
}

// No construction side effects. Trusted deployment provisioning supplies scope
// rows; initialization is explicit and leaves admission globally DRAINED.
export class PostgresDeploymentDrainBackend {
  #connections;#deployment;#owner;#authorize;
  constructor({workerPool,operatorPool,readerPool,expectedWorkerRole,expectedOperatorRole,expectedReaderRole,deploymentId,ownerId,authorizeBackend,timeoutMs=5000}={}){
    const pools=[workerPool,operatorPool,readerPool],roles=[expectedWorkerRole,expectedOperatorRole,expectedReaderRole];
    if(pools.some(p=>typeof p?.connect!=='function')||new Set(pools).size!==3||roles.some(r=>typeof r!=='string'||!ROLE.test(r))||new Set(roles).size!==3
      ||typeof deploymentId!=='string'||!ID.test(deploymentId)||typeof ownerId!=='string'||!UUID.test(ownerId)||typeof authorizeBackend!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>10000)throw new Error('POSTGRES_DRAIN_CONFIGURATION_INVALID');
    this.#connections=Object.freeze(Object.fromEntries(['WORKLOAD','CONTROL','READ'].map((k,i)=>[k,Object.freeze({pool:pools[i],expectedRole:roles[i],timeoutMs,
      group:['legaltech_drain_worker','legaltech_drain_operator','legaltech_drain_reader'][i]})])));
    this.#deployment=deploymentId;this.#owner=ownerId.toLowerCase();this.#authorize=authorizeBackend;
  }
  async #run(mode,action,input,signal){
    validateSignal(signal);const connection=this.#connections[mode];
    try{return await runPostgresTransaction({...connection,signal,readOnly:action==='STATUS'},async tx=>{
      const auth=async phase=>{if(tx.signal.aborted||await this.#authorize(Object.freeze({deploymentId:this.#deployment,ownerId:this.#owner,
        operationId:input.operationId??null,action,phase,principalRole:connection.expectedRole,access:mode,signal:tx.signal}))!==true||tx.signal.aborted)throw unavailable();};
      await auth('ADMIT');await posture(tx,connection.group);await auth('DISPATCH');
      const result=await tx.query('SELECT drain_security.operate($1::text,$2::text,$3::jsonb) AS result',[this.#deployment,action,JSON.stringify(input)]);
      if(result.rows?.length!==1)throw unavailable();await auth('COMMIT');return this.#result(action,result.rows[0].result,input);
    });}catch{throw unavailable();}
  }
  #scope(input){if(!input||input.deploymentId!==this.#deployment)throw unavailable();}
  #result(action,v,input){
    if(['INIT','STATUS','BEGIN','RESUME'].includes(action)){const result=status(v);
      if((action==='INIT'&&(result.state!=='DRAINED'||result.inFlight!==0||result.generation!==1))||(action==='BEGIN'&&result.state==='ACTIVE')
        ||(action==='RESUME'&&(result.state!=='ACTIVE'||result.inFlight!==0||result.generation!==input.expectedGeneration+1)))throw unavailable();return result;}
    if(action==='ACQUIRE')return lease(v);
    if(action==='RELEASE'){if(!exact(v,['released','token','generation'])||v.released!==true||v.token!==input.token||v.generation!==input.generation)throw unavailable();return Object.freeze({released:true,...lease({token:v.token,generation:v.generation})});}
    if(!exact(v,['state','lease'])||!['ABSENT','HELD','RELEASED'].includes(v.state)||(v.state==='ABSENT'&&v.lease!==null))throw unavailable();
    return Object.freeze({state:v.state,lease:v.state==='ABSENT'?null:lease(v.lease)});
  }
  initialize({operationId,actorId,signal}={}){return this.#run('CONTROL','INIT',{operationId:requireId(operationId),actorId:requireId(actorId)},signal);}
  acquire(input){this.#scope(input);if(!['INGRESS','BACKGROUND','SIDE_EFFECT'].includes(input.kind))throw unavailable();return this.#run('WORKLOAD','ACQUIRE',
    {operationId:requireId(input.operationId),ownerId:this.#owner,kind:input.kind,token:crypto.randomBytes(32).toString('hex')},input.signal);}
  release(input){this.#scope(input);const v=lease(input.lease);return this.#run('WORKLOAD','RELEASE',{operationId:requireId(input.operationId),ownerId:this.#owner,...v},input.signal);}
  status(input){this.#scope(input);return this.#run('READ','STATUS',{},input.signal);}
  begin(input){this.#scope(input);if(!TOKEN.test(input.reasonHash??''))throw unavailable();return this.#run('CONTROL','BEGIN',
    {operationId:requireId(input.operationId),actorId:requireId(input.actorId),reasonHash:input.reasonHash},input.signal);}
  resume(input){this.#scope(input);if(!Number.isSafeInteger(input.expectedGeneration)||input.expectedGeneration<1)throw unavailable();return this.#run('CONTROL','RESUME',
    {operationId:requireId(input.operationId),actorId:requireId(input.actorId),expectedGeneration:input.expectedGeneration},input.signal);}
  lookupOperation(input){this.#scope(input);return this.#run('WORKLOAD','LOOKUP',{operationId:requireId(input.operationId),ownerId:this.#owner},input.signal);}
  async probe({signal}={}){try{await Promise.all(['WORKLOAD','CONTROL','READ'].map(mode=>this.#run(mode,'STATUS',{},signal)));return Object.freeze({ok:true,code:'POSTGRES_DRAIN_VERIFIED'});}catch{return Object.freeze({ok:false,code:'POSTGRES_DRAIN_UNVERIFIED'});}}
}
