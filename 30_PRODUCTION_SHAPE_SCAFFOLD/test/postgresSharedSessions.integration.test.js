import {fork} from 'node:child_process';
import {createTenantScopedPostgresSupportGrantMutations} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresSupportGrantMutations.js';
import {createTenantScopedPostgresSupportGrantLookup} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresSupportGrantLookup.js';
import {ManagedReviewDocuments} from '../../40_PLATFORM_FOUNDATION_BUILD/src/managedReviewDocuments.js';
import {ReviewClient} from '../../40_PLATFORM_FOUNDATION_BUILD/browser/reviewClient.js';
import {PostgresReviewReader} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresReviewReader.js';
import {ManagedReviewReads} from '../../40_PLATFORM_FOUNDATION_BUILD/src/managedReviewReads.js';
import {PostgresGraphInboxProducer,PostgresGraphInboxWorker,PostgresGraphInboxReader} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresGraphInbox.js';
import {ManagedGraphWebhookIntake,graphSourceDeliveryFingerprint} from '../../40_PLATFORM_FOUNDATION_BUILD/src/managedGraphWebhookIntake.js';
// Runs only against a disposable PostgreSQL CI database, never a deployed customer database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadMigrationManifest,verifyMigrationDirectory} from '../src/migrationSafety.js';
import {PostgresTenantTransactions} from '../src/postgresTransactions.js';
import {PostgresServerSessionStore} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresSessions.js';
import {PostgresSecurityInterlock,PostgresSecurityInterlockOperator} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresInterlock.js';
import {PostgresAbuseLimiter} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresAbuseControl.js';
import {PostgresAuditWriter,PostgresAuditReader} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresAudit.js';
import {PostgresJobProducer,PostgresJobWorker,PostgresJobReader} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresJobs.js';
import {PostgresDomainOutbox,PostgresOutboxRelay} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresOutbox.js';
import {prepareJobIntent,intentHash} from '../../40_PLATFORM_FOUNDATION_BUILD/src/jobIntent.js';
import {canonicalAuditPayload} from '../../40_PLATFORM_FOUNDATION_BUILD/src/securityMonitoring.js';
import {createPostgresDomainPipeline} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresDomainPipeline.js';
import {createPostgresManagedProcessing} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresManagedProcessing.js';
import {createProcessingHttp} from '../../40_PLATFORM_FOUNDATION_BUILD/src/processingHttp.js';
import {createPostgresProcessingService} from '../../40_PLATFORM_FOUNDATION_BUILD/src/processingService.js';
import {fixtureDrain,ready as syntheticReady} from '../../40_PLATFORM_FOUNDATION_BUILD/test-support/processingV126.js';
import {PostgresResultAdopter} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresResultAdoption.js';
import {PostgresReviewDecisions} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresReviewDecisions.js';
import {REQUIRED_PRODUCTION_PROBES} from '../../40_PLATFORM_FOUNDATION_BUILD/src/productionAdmission.js';
import {createPostgresWorkerPipeline} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresWorkerPipeline.js';
import {PostgresWorkerDomainLoader} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresWorkerDomain.js';
import {PostgresDeploymentDrainBackend} from '../../40_PLATFORM_FOUNDATION_BUILD/src/postgresDeploymentDrain.js';
import {ManagedProcessingIngress,createGraphProcessingDispatch,graphApprovedSourceVersionHash} from '../../40_PLATFORM_FOUNDATION_BUILD/src/managedProcessingIngress.js';
import {GraphWebhookIngress} from '../../40_PLATFORM_FOUNDATION_BUILD/src/graphWebhookIngress.js';
import {GraphWebhookValidationQueue} from '../../40_PLATFORM_FOUNDATION_BUILD/src/graphWebhookQueue.js';
import {createApiServer} from '../../40_PLATFORM_FOUNDATION_BUILD/src/httpApi.js';
import {ManagedWorkerArtifacts} from '../../40_PLATFORM_FOUNDATION_BUILD/src/managedWorkerArtifacts.js';
import {ManagedDeploymentDrain} from '../../40_PLATFORM_FOUNDATION_BUILD/src/managedDeploymentDrain.js';
import {createDurablePostgresProcessingService} from '../../40_PLATFORM_FOUNDATION_BUILD/src/durableProcessingService.js';
import {DeploymentCapacity} from '../../40_PLATFORM_FOUNDATION_BUILD/src/deploymentCapacity.js';
import {DeploymentDrainController} from '../../40_PLATFORM_FOUNDATION_BUILD/src/deploymentDrain.js';
import {createPostgresRuntimeProbe} from '../src/postgresRuntime.js';

// Synthetic deployment capacity includes rollout overlap and other test principals.
const capacityProfile={connectionLimit:100,reservedConnections:20,maxConcurrentReplicas:2,maxWaitingPerPool:32};
const createCapacityBoundService=options=>createDurablePostgresProcessingService({capacity:capacityProfile,...options});
const enabled=process.env.LEGALTECH_RUN_POSTGRES_TESTS==='true';
const tenantA='11700000-0000-4000-8000-000000000001',actorA='11700000-0000-4000-8000-000000000011';
const tenantB='11700000-0000-4000-8000-000000000002',actorB='11700000-0000-4000-8000-000000000012';
const uuid=()=>crypto.randomUUID();

test('V118/V119/V120/V121/V122/V123/V124/V125/V126/V127/V128/V129/V130/V132/V133/V134 real PostgreSQL shared identity, security and tenant isolation',{skip:!enabled,timeout:120000},async t=>{
  if(process.env.PGDATABASE!=='legaltech_security_ci')throw new Error('EMPTY_SYNTHETIC_CI_DATABASE_REQUIRED');
  const {Pool}=await import('pg');
  const base={host:process.env.PGHOST??'127.0.0.1',port:Number(process.env.PGPORT??5432),database:process.env.PGDATABASE,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,max:2};
  const {PGPASSWORD:adminPassword}=process.env;
  const admin=new Pool({...base,user:process.env.PGUSER,password:adminPassword});
  admin.on('error',()=>{});
  const pools=[admin],supervisors=[];
  t.after(async()=>{for(const supervisor of supervisors)await supervisor.stop();await Promise.all(pools.map(pool=>pool.end()))});
  const existing=await admin.query("SELECT to_regclass('public.tenants') AS existing");
  if(existing.rows[0].existing!==null)throw new Error('EMPTY_SYNTHETIC_CI_DATABASE_REQUIRED');
  const migrations=fileURLToPath(new URL('../db/migrations/',import.meta.url));
  const manifest=loadMigrationManifest(path.join(migrations,'MANIFEST.json'));
  verifyMigrationDirectory({directory:migrations,manifest});
  for(const migration of manifest.migrations)await admin.query(fs.readFileSync(path.join(migrations,migration.file),'utf8'));
  // The trusted fixture script has psql directives; omit only its ON_ERROR_STOP line,
  // and bind its schema to the fixed public schema for this disposable database.
  const fixture=fs.readFileSync(new URL('../db/verification/setup_rls_fixtures.sql',import.meta.url),'utf8')
    .replace(/^\\set ON_ERROR_STOP on\r?\n/m,'').replace(':"app_schema"','public');
  await admin.query(fixture);
  const password=crypto.randomBytes(24).toString('hex');
  await admin.query(`CREATE ROLE legaltech_runtime_ci LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query(`CREATE ROLE legaltech_broker_ci LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT legaltech_session_broker TO legaltech_broker_ci');
  for(const [login,group] of [['legaltech_reader_ci','legaltech_security_reader'],['legaltech_operator_ci','legaltech_security_operator'],['legaltech_limiter_ci','legaltech_rate_limiter'],['legaltech_audit_writer_ci','legaltech_audit_writer'],['legaltech_audit_reader_ci','legaltech_audit_reader'],['legaltech_queue_producer_ci','legaltech_queue_producer'],['legaltech_queue_worker_ci','legaltech_queue_worker'],['legaltech_queue_reader_ci','legaltech_queue_reader'],['legaltech_outbox_relay_ci','legaltech_outbox_relay'],['legaltech_job_domain_reader_ci','legaltech_job_domain_reader'],['legaltech_graph_producer_ci','legaltech_graph_producer'],['legaltech_graph_worker_ci','legaltech_graph_worker'],['legaltech_graph_reader_ci','legaltech_graph_reader']]){
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`GRANT ${group} TO ${login}`);
  }
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await admin.query('GRANT USAGE ON SCHEMA public TO legaltech_runtime_ci');
  await admin.query('GRANT legaltech_outbox_writer,legaltech_domain_commands,legaltech_domain_result_writer TO legaltech_runtime_ci');
  await admin.query('GRANT SELECT ON public.actors,public.tenants TO legaltech_runtime_ci');
  await admin.query('GRANT SELECT,INSERT ON public.inbound_events TO legaltech_runtime_ci');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON public.matters TO legaltech_runtime_ci');
  await admin.query('GRANT SELECT ON public.matter_actor_access,public.matter_break_glass_grants,public.actor_security_zones TO legaltech_runtime_ci');
  const makePool=(user,max=1)=>{const pool=new Pool({...base,user,password,max});pool.on('error',()=>{});pools.push(pool);return pool};
  const runtime=makePool('legaltech_runtime_ci',2),runtimeSingle=makePool('legaltech_runtime_ci'),brokerOne=makePool('legaltech_broker_ci'),brokerTwo=makePool('legaltech_broker_ci');
  const transactions=new PostgresTenantTransactions({pool:runtime,expectedRole:'legaltech_runtime_ci'});
  let capabilities=['matter:read'],resolve=async({tenantId,actorId})=>({tenantId,actorId,capabilities,roles:[]});
  const options={expectedRole:'legaltech_broker_ci',providerNamespace:'https://issuer.example.invalid/tenant',resolveIdentity:(...args)=>resolve(...args),timeoutMs:5000};
  const one=new PostgresServerSessionStore({...options,brokerPool:brokerOne}),two=new PostgresServerSessionStore({...options,brokerPool:brokerTwo});
  const session=(providerSessionId=`provider-${uuid()}`)=>({tenantId:tenantA,actorId:actorA,capabilities:['matter:read'],roles:[],authContext:{method:'OIDC',mfaVerified:true,authTime:null,expiresAt:new Date(Date.now()+3600000).toISOString(),providerSessionId}});

  await t.test('all 61 checksum-pinned migrations execute and actual runtime catalog verification passes',async()=>{
    assert.equal(manifest.migrations.length,61);
    const result=await createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})({});assert.equal(result.ok,true);
    assert.equal((await one.probe()).ok,true);
    const hidden=await runtime.query('SELECT * FROM identity_security.server_sessions').then(()=>false,error=>error.code==='42501');assert.equal(hidden,true);
    assert.equal(await brokerOne.query('SELECT * FROM public.matters').then(()=>false,error=>error.code==='42501'),true);
  });
  await t.test('V152 support reader is SELECT-only and tenant RLS isolated',async()=>{
    const role=await admin.query("SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='legaltech_support_reader'");
    assert.equal(role.rows.length,1);
    assert.deepEqual(role.rows[0],{rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false});
    const grants=await admin.query(`SELECT
      has_table_privilege('legaltech_support_reader','public.support_access_requests','INSERT,UPDATE,DELETE,TRUNCATE') AS request_write,
      has_table_privilege('legaltech_support_reader','public.support_access_approvals','INSERT,UPDATE,DELETE,TRUNCATE') AS approval_write,
      has_table_privilege('legaltech_support_reader','public.support_access_revocations','INSERT,UPDATE,DELETE,TRUNCATE') AS revoke_write,
      has_table_privilege('legaltech_support_reader','public.support_access_events','SELECT') AS event_read,
      has_column_privilege('legaltech_support_reader','public.support_access_requests','tenant_id','SELECT') AS tenant_read,
      has_column_privilege('legaltech_support_reader','public.support_access_requests','ticket_ref_hash','SELECT') AS ticket_read`);
    assert.deepEqual(grants.rows[0],{request_write:false,approval_write:false,revoke_write:false,event_read:false,tenant_read:true,ticket_read:false});
    const requestA=uuid(),requestB=uuid();
    await admin.query(`INSERT INTO public.support_access_requests(id,tenant_id,requester_id,matter_id,scope,ticket_ref_hash,purpose_hash,trace_id,expires_at)
      VALUES($1,$2,$3,$4,'MATTER_READ',$5,$6,'v152',statement_timestamp()+interval '10 minutes')`,
      [requestA,tenantA,actorA,'11700000-0000-4000-8000-000000000031','a'.repeat(64),'b'.repeat(64)]);
    await admin.query(`INSERT INTO public.support_access_requests(id,tenant_id,requester_id,matter_id,scope,ticket_ref_hash,purpose_hash,trace_id,expires_at)
      VALUES($1,$2,$3,$4,'MATTER_READ',$5,$6,'v152',statement_timestamp()+interval '10 minutes')`,
      [requestB,tenantB,actorB,'11700000-0000-4000-8000-000000000036','a'.repeat(64),'b'.repeat(64)]);
    await admin.query(`INSERT INTO public.support_access_approvals(tenant_id,request_id,approver_id,trace_id) VALUES($1,$2,$3,'v152')`,
      [tenantA,requestA,'11700000-0000-4000-8000-000000000013']);
    const readerLogin='legaltech_support_reader_ci';
    await admin.query(`CREATE ROLE ${readerLogin} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`GRANT legaltech_support_reader TO ${readerLogin}`);
    const readerPool=makePool(readerLogin);
    const reader=new PostgresTenantTransactions({pool:readerPool,expectedRole:readerLogin});
    for(const scope of [{tenantId:tenantA,actorId:actorA},{tenantId:tenantB,actorId:actorB}]){
      await reader.run({...scope,readOnly:true},async tx=>{
        for(const table of ['support_access_requests','support_access_approvals','support_access_revocations']){
          const result=await tx.query(`SELECT tenant_id FROM public.${table}`);
          assert.ok(result.rows.every(row=>row.tenant_id===scope.tenantId));
          if(table==='support_access_requests')assert.deepEqual(result.rows.map(row=>row.tenant_id),[scope.tenantId]);
        }
      });
    }
    const grantLookup=createTenantScopedPostgresSupportGrantLookup({pool:readerPool,expectedRole:readerLogin});
    const authorized={tenantId:tenantA,actorId:actorA,requestId:requestA,
      matterId:'11700000-0000-4000-8000-000000000031',scope:'MATTER_READ',documentRefHash:null};
    assert.equal((await grantLookup(authorized)).active,true);
    await assert.rejects(grantLookup({...authorized,tenantId:tenantB,actorId:actorB}),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
    await assert.rejects(grantLookup({...authorized,requestId:requestB}),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
    await admin.query(`INSERT INTO public.support_access_revocations(tenant_id,request_id,revoked_by,reason_hash,trace_id)
      VALUES($1,$2,$3,$4,'v152')`,[tenantA,requestA,actorA,'c'.repeat(64)]);
    await assert.rejects(grantLookup(authorized),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
    await assert.rejects(reader.run({tenantId:tenantA,actorId:actorA},async tx=>
      tx.query('INSERT INTO public.support_access_requests(tenant_id) VALUES($1)',[tenantA])),/UNAVAILABLE/);
    await assert.rejects(reader.run({tenantId:tenantA,actorId:actorA,readOnly:true},async tx=>
      tx.query('SELECT ticket_ref_hash FROM public.support_access_requests')),/UNAVAILABLE/);
    await assert.rejects(reader.run({tenantId:tenantA,actorId:actorA,readOnly:true},async tx=>
      tx.query('SELECT * FROM public.support_access_events')),/UNAVAILABLE/);
  });
  await t.test('V154 support operator cannot read audit history or modify append-only evidence',async()=>{
    const role=await admin.query("SELECT rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname='legaltech_support_operator'");
    assert.deepEqual(role.rows[0],{rolcanlogin:false,rolsuper:false,rolbypassrls:false});
    const rights=await admin.query(`SELECT
      has_column_privilege('legaltech_support_operator','public.support_access_requests','tenant_id','INSERT') AS request_insert,
      has_column_privilege('legaltech_support_operator','public.support_access_approvals','tenant_id','INSERT') AS approval_insert,
      has_column_privilege('legaltech_support_operator','public.support_access_revocations','tenant_id','INSERT') AS revocation_insert,
      has_column_privilege('legaltech_support_operator','public.support_access_events','tenant_id','INSERT') AS audit_insert,
      has_table_privilege('legaltech_support_operator','public.support_access_events','SELECT') AS audit_read,
      has_table_privilege('legaltech_support_operator','public.support_access_requests','UPDATE,DELETE,TRUNCATE') AS request_mutation`);
    assert.deepEqual(rights.rows[0],{request_insert:true,approval_insert:true,revocation_insert:true,audit_insert:true,audit_read:false,request_mutation:false});
    const login='legaltech_support_operator_ci';
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`GRANT legaltech_support_operator TO ${login}`);
    const pool=makePool(login);
    const operator=new PostgresTenantTransactions({pool,expectedRole:login});
    await operator.run({tenantId:tenantA,actorId:actorA},async tx=>{
      const r=await tx.query("SELECT tenant_id FROM public.support_access_requests WHERE tenant_id=$1",[tenantA]);
      assert.ok(r.rows.every(row=>row.tenant_id===tenantA));
    });
    await assert.rejects(operator.run({tenantId:tenantA,actorId:actorA},tx=>
      tx.query('SELECT * FROM public.support_access_events')),/UNAVAILABLE/);
  });
  await t.test('V155 live operator creates, approves, revokes and atomically records durable grant evidence',async()=>{
    const login='legaltech_support_operator_v155';
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`GRANT legaltech_support_operator TO ${login}`);
    const operatorPool=makePool(login,2);
    const identity={assertCurrent:async()=>true};
    const service=createTenantScopedPostgresSupportGrantMutations({pool:operatorPool,expectedRole:login,liveSession:identity});
    const original={tenantId:tenantA,actorId:actorA,sessionId:uuid()};
    const approver={tenantId:tenantA,actorId:'11700000-0000-4000-8000-000000000013',sessionId:uuid()};
    const request=await service.request({session:original,matterId:'11700000-0000-4000-8000-000000000031',
      scope:'MATTER_READ',ticketRefHash:'a'.repeat(64),purposeHash:'b'.repeat(64),traceId:'synthetic-v155'});
    assert.equal(request.tenantId,tenantA);
    const grantId=request.requestId;
    await assert.rejects(service.approve({session:original,requestId:grantId,traceId:'synthetic-v155'}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
    assert.equal((await service.approve({session:approver,requestId:grantId,traceId:'synthetic-v155'})).status,'ACTIVE');
    await assert.rejects(service.approve({session:approver,requestId:grantId,traceId:'synthetic-v155'}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
    const recorded=await admin.query('SELECT event_type FROM public.support_access_events WHERE tenant_id=$1 AND request_id=$2 ORDER BY id',[tenantA,grantId]);
    assert.deepEqual(recorded.rows.map(r=>r.event_type),['REQUESTED','APPROVED']);
    assert.equal((await service.revoke({session:approver,requestId:grantId,reasonHash:'c'.repeat(64),traceId:'synthetic-v155'})).status,'REVOKED');
    await assert.rejects(service.revoke({session:approver,requestId:grantId,reasonHash:'c'.repeat(64),traceId:'synthetic-v155'}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
    const after=await admin.query('SELECT event_type FROM public.support_access_events WHERE tenant_id=$1 AND request_id=$2 ORDER BY id',[tenantA,grantId]);
    assert.deepEqual(after.rows.map(r=>r.event_type),['REQUESTED','APPROVED','REVOKED']);
    const cross={tenantId:tenantB,actorId:actorB,sessionId:uuid()};
    await assert.rejects(service.revoke({session:cross,requestId:grantId,reasonHash:'c'.repeat(64),traceId:'synthetic-v155'}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
  });
  await t.test('V156 competing approvals and revocations serialize across connections',async()=>{
    const login='legaltech_support_operator_v156';
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`GRANT legaltech_support_operator TO ${login}`);
    const poolOne=makePool(login,2),poolTwo=makePool(login,2);
    const liveSession={assertCurrent:async()=>true};
    const first=createTenantScopedPostgresSupportGrantMutations({pool:poolOne,expectedRole:login,liveSession});
    const second=createTenantScopedPostgresSupportGrantMutations({pool:poolTwo,expectedRole:login,liveSession});
    const requester={tenantId:tenantA,actorId:actorA,sessionId:uuid()};
    const approver={tenantId:tenantA,actorId:'11700000-0000-4000-8000-000000000013',sessionId:uuid()};
    const args={session:requester,matterId:'11700000-0000-4000-8000-000000000031',
      scope:'MATTER_READ',ticketRefHash:'d'.repeat(64),purposeHash:'e'.repeat(64),traceId:'v156'};
    const one=await first.request(args);
    const approvals=await Promise.allSettled([
      first.approve({session:approver,requestId:one.requestId,traceId:'v156'}),
      second.approve({session:approver,requestId:one.requestId,traceId:'v156'})
    ]);
    assert.equal(approvals.filter(x=>x.status==='fulfilled').length,1);
    const approvalRows=await admin.query('SELECT id FROM public.support_access_approvals WHERE tenant_id=$1 AND request_id=$2',[tenantA,one.requestId]);
    assert.equal(approvalRows.rows.length,1);
    const two=await first.request(args);
    const revocations=await Promise.allSettled([
      first.revoke({session:approver,requestId:two.requestId,reasonHash:'f'.repeat(64),traceId:'v156'}),
      second.revoke({session:approver,requestId:two.requestId,reasonHash:'f'.repeat(64),traceId:'v156'})
    ]);
    assert.equal(revocations.filter(x=>x.status==='fulfilled').length,1);
    await assert.rejects(first.approve({session:approver,requestId:two.requestId,traceId:'v156'}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
    const events=await admin.query('SELECT event_type FROM public.support_access_events WHERE tenant_id=$1 AND request_id=$2',[tenantA,two.requestId]);
    assert.deepEqual(events.rows.map(x=>x.event_type).sort(),['REQUESTED','REVOKED']);
    const mixed=await first.request(args);
    const outcomes=await Promise.allSettled([
      first.approve({session:approver,requestId:mixed.requestId,traceId:'v156'}),
      second.revoke({session:approver,requestId:mixed.requestId,reasonHash:'f'.repeat(64),traceId:'v156'})
    ]);
    assert.equal(outcomes[1].status,'fulfilled');
    const stored=await admin.query('SELECT count(*)::int AS n FROM public.support_access_revocations WHERE tenant_id=$1 AND request_id=$2',[tenantA,mixed.requestId]);
    assert.equal(stored.rows[0].n,1);
    await assert.rejects(first.approve({session:approver,requestId:mixed.requestId,traceId:'v156'}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
  });
  await t.test('V158 independent processes observe committed revocation and restart denial',async t=>{
    const expectedRole='legaltech_support_operator_ci';
    const service=createTenantScopedPostgresSupportGrantMutations({pool:makePool(expectedRole),expectedRole,liveSession:{assertCurrent:async()=>true}});
    const requester={tenantId:tenantA,actorId:actorA,sessionId:uuid()};
    const approver={tenantId:tenantA,actorId:'11700000-0000-4000-8000-000000000013',sessionId:uuid()};
    const matterId='11700000-0000-4000-8000-000000000031';
    const request=await service.request({session:requester,matterId,scope:'DIAGNOSTIC_READ',ticketRefHash:'a'.repeat(64),purposeHash:'b'.repeat(64),traceId:'v158'});
    await service.approve({session:approver,requestId:request.requestId,traceId:'v158'});
    const input={tenantId:tenantA,actorId:actorA,requestId:request.requestId,matterId,scope:'DIAGNOSTIC_READ',documentRefHash:null};
    const startReader=async()=>{
      const child=fork(fileURLToPath(new URL('../test-support/supportReaderProcess.js',import.meta.url)),[],{
        execArgv:[],stdio:['ignore','ignore','ignore','ipc'],
        env:{PATH:process.env.PATH,LEGALTECH_RUN_POSTGRES_TESTS:'true',PGHOST:base.host,PGPORT:String(base.port),PGDATABASE:base.database,PGUSER:'legaltech_support_reader_ci',PGPASSWORD:password}
      });
      t.after(()=>{if(child.exitCode===null)child.kill();});
      const response=()=>new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>finish(Error('SUPPORT_CHILD_TIMEOUT')),5000);
        const onMessage=value=>finish(null,value),onExit=()=>finish(Error('SUPPORT_CHILD_EXIT')),onError=()=>finish(Error('SUPPORT_CHILD_ERROR'));
        function finish(error,value){clearTimeout(timeout);child.off('message',onMessage);child.off('exit',onExit);child.off('error',onError);error?reject(error):resolve(value);}
        child.once('message',onMessage);child.once('exit',onExit);child.once('error',onError);
      });
      const ready=await response();assert.equal(ready.ready,true);assert.notEqual(ready.pid,process.pid);
      return {pid:ready.pid,async read(value){const id=uuid(),pending=response();child.send({id,operation:'read',input:value});const result=await pending;assert.equal(result.id,id);assert.equal(result.pid,ready.pid);return result.allowed;},async close(){const exited=new Promise(resolve=>child.once('exit',resolve));child.send({operation:'close'});await exited;}};
    };
    const first=await startReader(),second=await startReader();assert.notEqual(first.pid,second.pid);
    assert.equal(await first.read(input),true);assert.equal(await second.read(input),true);
    assert.equal(await first.read({...input,tenantId:tenantB,actorId:actorB}),false);
    assert.equal(await second.read({...input,scope:'MATTER_READ'}),false);
    await service.revoke({session:approver,requestId:request.requestId,reasonHash:'c'.repeat(64),traceId:'v158'});
    assert.equal(await first.read(input),false);assert.equal(await second.read(input),false);
    await first.close();const restarted=await startReader();assert.notEqual(restarted.pid,first.pid);
    assert.equal(await restarted.read(input),false);
    const events=await admin.query('SELECT event_type FROM public.support_access_events WHERE tenant_id=$1 AND request_id=$2 ORDER BY id',[tenantA,request.requestId]);
    assert.deepEqual(events.rows.map(row=>row.event_type),['REQUESTED','APPROVED','REVOKED']);
    await second.close();await restarted.close();
  });
  await t.test('V158 final session denial rolls back support mutations and audit together',async()=>{
    const expectedRole='legaltech_support_operator_ci',pool=makePool(expectedRole);
    const requester={tenantId:tenantA,actorId:actorA,sessionId:uuid()};
    const approver={tenantId:tenantA,actorId:'11700000-0000-4000-8000-000000000013',sessionId:uuid()};
    const service=createTenantScopedPostgresSupportGrantMutations({pool,expectedRole,liveSession:{assertCurrent:async()=>true}});
    const args={matterId:'11700000-0000-4000-8000-000000000031',scope:'MATTER_READ',ticketRefHash:'a'.repeat(64),purposeHash:'b'.repeat(64),traceId:'v158-rollback'};
    for(const operation of ['request','approve','revoke']){
      const request=operation==='request'?null:await service.request({session:requester,...args});
      let checks=0;
      const denying=createTenantScopedPostgresSupportGrantMutations({pool,expectedRole,liveSession:{assertCurrent:async()=>++checks===1}});
      await assert.rejects(denying[operation]({session:operation==='request'?requester:approver,...args,requestId:request?.requestId,reasonHash:'c'.repeat(64)}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
      assert.equal(checks,2);
      if(operation==='request'){
        const rows=await admin.query('SELECT id FROM public.support_access_requests WHERE trace_id=$1',[args.traceId]);assert.equal(rows.rows.length,0);
      }else{
        const table=operation==='approve'?'support_access_approvals':'support_access_revocations';
        const rows=await admin.query(`SELECT id FROM public.${table} WHERE tenant_id=$1 AND request_id=$2`,[tenantA,request.requestId]);assert.equal(rows.rows.length,0);
        const events=await admin.query('SELECT event_type FROM public.support_access_events WHERE tenant_id=$1 AND request_id=$2',[tenantA,request.requestId]);assert.deepEqual(events.rows.map(row=>row.event_type),['REQUESTED']);
      }
    }
  });
  await t.test('parallel tenant queries stay isolated and pool reuse has no transaction context',async()=>{
    const scopes=[{tenantId:tenantA,actorId:actorA},{tenantId:tenantB,actorId:actorB}];
    const results=await Promise.all(Array.from({length:12},(_,i)=>transactions.run(scopes[i%2],async tx=>{
      const rows=await tx.query('SELECT tenant_id,id FROM public.matters ORDER BY id');return {scope:scopes[i%2],rows:rows.rows};
    })));
    for(const result of results){assert.ok(result.rows.length>0);assert.ok(result.rows.every(row=>row.tenant_id===result.scope.tenantId));}
    const client=await runtime.connect();try{const state=await client.query("SELECT NULLIF(current_setting('app.tenant_id',true),'') AS tenant,NULLIF(current_setting('app.actor_id',true),'') AS actor");assert.deepEqual(state.rows[0],{tenant:null,actor:null});assert.equal((await client.query('SELECT count(*)::integer AS n FROM public.matters')).rows[0].n,0);}finally{client.release()}
  });
  await t.test('restricted matter reads and cross-tenant writes are rejected by PostgreSQL',async()=>{
    await transactions.run({tenantId:tenantA,actorId:actorA},async tx=>{
      for(const id of ['11700000-0000-4000-8000-000000000033','11700000-0000-4000-8000-000000000035','11700000-0000-4000-8000-000000000036'])assert.equal((await tx.query('SELECT id FROM public.matters WHERE id=$1',[id])).rows.length,0);
      assert.equal((await tx.query('SELECT id FROM public.matters WHERE id=$1',['11700000-0000-4000-8000-000000000032'])).rows.length,1);
    });
    await assert.rejects(transactions.run({tenantId:tenantA,actorId:actorA},tx=>tx.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[uuid(),tenantB,'synthetic-cross-tenant'])),/UNAVAILABLE/);
  });
  await t.test('callback failure rolls back DML and timeout destroys a backend without contaminating reuse',async()=>{
    const single=new PostgresTenantTransactions({pool:runtimeSingle,expectedRole:'legaltech_runtime_ci',timeoutMs:1000}),id=uuid();
    await assert.rejects(single.run({tenantId:tenantA,actorId:actorA},async tx=>{await tx.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[id,tenantA,`rollback-${id}`]);throw new Error('intentional test rollback')}),/UNAVAILABLE/);
    assert.equal((await admin.query('SELECT id FROM public.matters WHERE id=$1',[id])).rows.length,0);
    await assert.rejects(single.run({tenantId:tenantA,actorId:actorA},tx=>tx.query('SELECT pg_sleep(2)')),/UNAVAILABLE/);
    const current=await runtimeSingle.query("SELECT NULLIF(current_setting('app.tenant_id',true),'') AS tenant");assert.equal(current.rows[0].tenant,null);
  });
  await t.test('a session issued on one instance authenticates on another and returns current permissions',async()=>{
    const issued=await one.issue(session());const authenticated=await two.get(issued.token);assert.equal(authenticated.actorId,actorA);assert.deepEqual(authenticated.capabilities,['matter:read']);
    capabilities=[];assert.deepEqual((await two.get(issued.token)).capabilities,[]);capabilities=['matter:read'];
    const record=await admin.query('SELECT token_hash,provider_session_hash FROM identity_security.server_sessions WHERE token_hash=$1',[crypto.createHash('sha256').update(issued.token).digest('hex')]);assert.equal(record.rows.length,1);assert.notEqual(record.rows[0].token_hash,issued.token);assert.match(record.rows[0].provider_session_hash,/^[a-f0-9]{64}$/);
    assert.equal(await two.revoke(issued.token),true);await assert.rejects(one.get(issued.token),error=>error.code==='AUTH_REQUIRED');
  });
  await t.test('provider revocation is shared atomic persistent and blocks future issuance for that provider session',async()=>{
    const identity=session(),a=await one.issue(identity),b=await two.issue(identity);assert.equal(await two.revokeProviderSession(identity.authContext.providerSessionId),2);
    await assert.rejects(one.get(a.token),error=>error.code==='AUTH_REQUIRED');await assert.rejects(two.get(b.token),error=>error.code==='AUTH_REQUIRED');
    await assert.rejects(one.issue(identity),error=>error.code==='AUTH_REQUIRED');
  });
  await t.test('revocation while directory resolution waits is checked again before authentication commits',async()=>{
    const issued=await one.issue(session());let continueLookup,started;const start=new Promise(res=>{started=res});
    resolve=async({tenantId,actorId})=>{started();await new Promise(res=>{continueLookup=res});return {tenantId,actorId,capabilities,roles:[]}};
    const pending=one.get(issued.token);await start;await two.revoke(issued.token);continueLookup();await assert.rejects(pending,error=>error.code==='AUTH_REQUIRED');
    resolve=async({tenantId,actorId})=>({tenantId,actorId,capabilities,roles:[]});
  });
  await t.test('expired and idle-expired records are denied using database time',async()=>{
    for(const idle of [false,true]) {
      const value=crypto.randomBytes(32).toString('base64url'),digest=crypto.createHash('sha256').update(value).digest('hex');
      await admin.query(`INSERT INTO identity_security.server_sessions(token_hash,session_id,tenant_id,actor_id,mfa_verified,created_at,expires_at,idle_timeout_ms,last_seen_at)
        VALUES($1,$2,$3,$4,false,clock_timestamp()-interval '2 minutes',
          CASE WHEN $5 THEN clock_timestamp()+interval '1 hour' ELSE clock_timestamp()-interval '1 second' END,
          60000,clock_timestamp()-interval '65 seconds')`,[digest,uuid(),tenantA,actorA,idle]);
      await assert.rejects(one.get(value),error=>error.code==='AUTH_REQUIRED');
    }
  });
  const readerOne=makePool('legaltech_reader_ci'),readerTwo=makePool('legaltech_reader_ci'),operatorPool=makePool('legaltech_operator_ci');
  const gateOne=new PostgresSecurityInterlock({pool:readerOne,expectedRole:'legaltech_reader_ci'}),gateTwo=new PostgresSecurityInterlock({pool:readerTwo,expectedRole:'legaltech_reader_ci'});
  let authorized=true;
  const operator=new PostgresSecurityInterlockOperator({pool:operatorPool,expectedRole:'legaltech_operator_ci',authorizeChange:async()=>authorized});
  const operatorTwo=new PostgresSecurityInterlockOperator({pool:makePool('legaltech_operator_ci'),expectedRole:'legaltech_operator_ci',authorizeChange:async()=>authorized});
  await t.test('V119 actual shared roles are narrow and RLS is active',async()=>{
    assert.equal((await gateOne.probe()).ok,true);assert.equal((await operator.probe()).ok,true);
    for(const pool of [runtime,brokerOne])assert.equal(await pool.query('SELECT * FROM operational_security.interlocks').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await readerOne.query('DELETE FROM operational_security.interlocks').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await operatorPool.query('UPDATE operational_security.interlock_events SET reason_code=reason_code').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await readerOne.query('SELECT * FROM public.matters').then(()=>false,e=>e.code==='42501'),true);
    await admin.query('GRANT legaltech_rate_limiter TO legaltech_reader_ci');
    try{await assert.rejects(gateOne.probe(),/UNAVAILABLE/);}
    finally{await admin.query('REVOKE legaltech_rate_limiter FROM legaltech_reader_ci');}
  });
  const activation={tenantId:tenantA,actorId:actorA,control:'ALL_EGRESS',traceId:'v119-ci',incidentId:'synthetic-v119',reasonCode:'CONTAIN'};
  await t.test('V119 independent gate sees committed activation and release with dual control and atomic event history',async()=>{
    const active=await operator.activate(activation);assert.equal(active.status,'ACTIVE');
    await assert.rejects(gateTwo.assertAllowed({tenantId:tenantA,operation:'EXPORT'}),/SECURITY_INTERLOCK_ACTIVE/);
    assert.equal(await gateTwo.assertAllowed({tenantId:tenantB,operation:'EXPORT'}),true);
    assert.equal(await gateOne.assertAllowed({tenantId:tenantA,operation:'NEW_SESSION'}),true);
    await assert.rejects(operator.release({...activation,resolutionCode:'RESOLVED',incidentId:undefined,reasonCode:undefined}),/REQUEST_INVALID/);
    await assert.rejects(operator.release({tenantId:tenantA,actorId:actorA,control:'ALL_EGRESS',interlockId:active.id,incidentId:active.incidentId,traceId:'release',resolutionCode:'RESOLVED'}),/DUAL_CONTROL/);
    authorized=false;await assert.rejects(operator.activate({...activation,control:'NEW_SESSION'}),/FORBIDDEN/);authorized=true;
    // A second authorised actor in the same tenant is required by the composite FK.
    const second=uuid();await admin.query("INSERT INTO public.actors(id,tenant_id,actor_type) VALUES($1,$2,'USER')",[second,tenantA]);
    await operator.release({tenantId:tenantA,actorId:second,control:'ALL_EGRESS',interlockId:active.id,incidentId:active.incidentId,traceId:'release',resolutionCode:'RESOLVED'});
    assert.equal(await gateTwo.assertAllowed({tenantId:tenantA,operation:'EXPORT'}),true);
    const events=await readerOne.query('SELECT event_type FROM operational_security.interlock_events WHERE interlock_id=$1 ORDER BY at',[active.id]);
    assert.deepEqual(events.rows.map(x=>x.event_type),['INTERLOCK_ACTIVATED','INTERLOCK_RELEASED']);
    const reactivated=await operator.activate(activation);assert.notEqual(reactivated.id,active.id);
    const concurrent=await Promise.all([operator.activate(activation),operatorTwo.activate(activation)]);assert.ok(concurrent.every(x=>x.replayed));
    assert.equal((await readerOne.query('SELECT event_id FROM operational_security.interlock_events WHERE interlock_id=$1',[reactivated.id])).rows.length,1);
  });
  await t.test('V141 exact release refuses stale rearmed pins and mismatched replay across pools',async()=>{
    const second=uuid(),third=uuid();await admin.query("INSERT INTO public.actors(id,tenant_id,actor_type) VALUES($1,$3,'USER'),($2,$3,'USER')",[second,third,tenantB]);
    const request={tenantId:tenantB,actorId:actorB,control:'EXPORT',traceId:'v141-activate',incidentId:`v141-${uuid()}`,reasonCode:'CONTAIN'};
    const active=await operator.activate(request),release={tenantId:tenantB,actorId:second,control:'EXPORT',interlockId:active.id,incidentId:active.incidentId,traceId:'v141-release',resolutionCode:'RECOVERED'};
    assert.equal((await operator.release(release)).replayed,false);
    const rearmed=await operatorTwo.activate(request);assert.notEqual(rearmed.id,active.id);
    await assert.rejects(operator.release(release),/RELEASE_STALE/);
    await assert.rejects(operator.release({...release,interlockId:rearmed.id,incidentId:'different'}),/RELEASE_STALE/);
    await assert.rejects(operator.release({...release,interlockId:undefined}),/REQUEST_INVALID/);
    await assert.rejects(gateTwo.assertAllowed({tenantId:tenantB,operation:'EXPORT'}),/ACTIVE/);
    assert.equal((await readerOne.query("SELECT event_id FROM operational_security.interlock_events WHERE interlock_id=$1 AND event_type='INTERLOCK_RELEASED'",[rearmed.id])).rows.length,0);
    const current={...release,interlockId:rearmed.id};assert.equal((await operator.release(current)).replayed,false);
    assert.equal((await operatorTwo.release({...current,traceId:'v141-retry'})).replayed,true);
    await assert.rejects(operatorTwo.release({...current,actorId:third}),/REPLAY_MISMATCH/);
    await assert.rejects(operatorTwo.release({...current,resolutionCode:'OTHER'}),/REPLAY_MISMATCH/);
    assert.equal((await readerOne.query("SELECT event_id FROM operational_security.interlock_events WHERE interlock_id=$1 AND event_type='INTERLOCK_RELEASED'",[rearmed.id])).rows.length,1);
  });
  await t.test('V141 concurrent exact release reviews see locked identity and commit one release event',async()=>{
    const second=uuid();await admin.query("INSERT INTO public.actors(id,tenant_id,actor_type) VALUES($1,$2,'USER')",[second,tenantB]);
    const seen=[],newOperator=()=>new PostgresSecurityInterlockOperator({pool:makePool('legaltech_operator_ci'),expectedRole:'legaltech_operator_ci',authorizeChange:async context=>{seen.push(context);return true;}});
    const active=await operator.activate({tenantId:tenantB,actorId:actorB,control:'DOCUMENT_DELIVERY',traceId:'v141-concurrent-activate',incidentId:`v141-${uuid()}`,reasonCode:'CONTAIN'});
    const release={tenantId:tenantB,actorId:second,control:'DOCUMENT_DELIVERY',interlockId:active.id,incidentId:active.incidentId,traceId:'v141-concurrent-release',resolutionCode:'RECOVERED'};
    const results=await Promise.all([newOperator().release(release),newOperator().release(release)]);
    assert.deepEqual(results.map(x=>x.replayed).sort(),[false,true]);assert.equal(seen.length,2);
    assert.ok(seen.every(x=>x.action==='RELEASE'&&x.interlockId===active.id&&x.incidentId===active.incidentId&&x.tenantId===tenantB));
    assert.equal((await readerOne.query("SELECT event_id FROM operational_security.interlock_events WHERE interlock_id=$1 AND event_type='INTERLOCK_RELEASED'",[active.id])).rows.length,1);
    const denied=new PostgresSecurityInterlockOperator({pool:makePool('legaltech_operator_ci'),expectedRole:'legaltech_operator_ci',authorizeChange:async()=>false});
    await assert.rejects(denied.release(release),/FORBIDDEN/);
    assert.equal(await gateTwo.assertAllowed({tenantId:tenantB,operation:'DOCUMENT_DELIVERY'}),true);
  });
  const limiterOne=makePool('legaltech_limiter_ci'),limiterTwo=makePool('legaltech_limiter_ci'),hashKey=crypto.randomBytes(32);
  const limits={hashKey,windowMs:60000,maxPerIp:2,maxPerTenant:3,maxReadRecordsPerActor:3,maxDistinctMattersPerActor:2};
  const limitOne=new PostgresAbuseLimiter({...limits,pool:limiterOne,expectedRole:'legaltech_limiter_ci'}),limitTwo=new PostgresAbuseLimiter({...limits,pool:limiterTwo,expectedRole:'legaltech_limiter_ci'});
  await t.test('V119 configuration must be bootstrapped and mismatched keys/policies cannot split shared budgets',async()=>{
    await assert.rejects(limitOne.probe(),/UNAVAILABLE/);await limitOne.initialize();await limitTwo.initialize();assert.equal((await limitTwo.probe()).ok,true);
    const wrong=new PostgresAbuseLimiter({...limits,hashKey:crypto.randomBytes(32),pool:limiterTwo,expectedRole:'legaltech_limiter_ci'});
    await assert.rejects(wrong.initialize(),/UNAVAILABLE/);await assert.rejects(wrong.checkTenant({tenantId:tenantA}),e=>e.status===503);
    const drift=new PostgresAbuseLimiter({...limits,maxPerTenant:4,pool:limiterTwo,expectedRole:'legaltech_limiter_ci'});await assert.rejects(drift.checkTenant({tenantId:tenantA}),e=>e.status===503);
  });
  await t.test('V119 concurrent requests across independent pools cannot exceed one shared tenant budget',async()=>{
    const results=await Promise.allSettled(Array.from({length:8},(_,i)=>(i%2?limitOne:limitTwo).checkTenant({tenantId:tenantA})));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,3);assert.ok(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='RATE_LIMITED'));
    assert.equal(await limitTwo.checkTenant({tenantId:tenantB}),true);
    assert.equal(await limiterOne.query('DELETE FROM operational_security.rate_buckets').then(()=>false,e=>e.code==='42501'),true);
  });
  await t.test('V119 actor records and distinct matters share a budget across endpoints without raw matter IDs',async()=>{
    const actor={tenantId:tenantA,actorId:actorA};
    await limitOne.checkRead(actor,{resource:'matters',count:1,matterIds:['synthetic-matter-1']});
    await limitTwo.checkRead(actor,{resource:'documents',count:1,matterIds:['synthetic-matter-1','synthetic-matter-2']});
    await assert.rejects(limitOne.checkRead(actor,{resource:'events',count:0,matterIds:['synthetic-matter-3']}),e=>e.code==='READ_VOLUME_LIMITED');
    await limitTwo.checkRead(actor,{resource:'exports',count:1,matterIds:['synthetic-matter-2']});
    await assert.rejects(limitOne.checkRead(actor,{resource:'matters',count:1}),e=>e.code==='READ_VOLUME_LIMITED');
    const rows=await limiterOne.query('SELECT matter_hash FROM operational_security.read_matters');assert.ok(rows.rows.every(x=>/^[a-f0-9]{64}$/.test(x.matter_hash)));
  });
  await t.test('V119 direct peer IP ignores forwarded spoofing and database-time rollover clears actor distinct matters',async()=>{
    const req={socket:{remoteAddress:'203.0.113.119'},headers:{'x-forwarded-for':'different'}};
    await limitOne.checkIp(req);await limitTwo.checkIp({...req,headers:{'x-forwarded-for':'another'}});
    await assert.rejects(limitOne.checkIp(req),e=>e.code==='RATE_LIMITED');
    // Only the disposable-database owner seeds old windows. Runtime cannot reset early.
    await assert.rejects(limiterOne.query('UPDATE operational_security.rate_buckets SET window_id=$1,records=0,started_at=clock_timestamp()',[uuid()]));
    await admin.query('ALTER TABLE operational_security.rate_buckets DISABLE TRIGGER protect_rate_bucket');
    try{await admin.query("UPDATE operational_security.rate_buckets SET started_at=clock_timestamp()-interval '2 minutes'");}
    finally{await admin.query('ALTER TABLE operational_security.rate_buckets ENABLE TRIGGER protect_rate_bucket');}
    assert.equal(await limitTwo.checkIp(req),true);
    assert.equal(await limitTwo.checkRead({tenantId:tenantA,actorId:actorA},{resource:'documents',count:1,matterIds:['synthetic-new-window']}),true);
  });

  const auditWriterPool=makePool('legaltech_audit_writer_ci'),auditWriterPoolTwo=makePool('legaltech_audit_writer_ci'),auditReaderPool=makePool('legaltech_audit_reader_ci');
  const auditOne=new PostgresAuditWriter({pool:auditWriterPool,expectedRole:'legaltech_audit_writer_ci'}),auditTwo=new PostgresAuditWriter({pool:auditWriterPoolTwo,expectedRole:'legaltech_audit_writer_ci'});
  let trustedAuditAnchor=null;
  const auditReader=new PostgresAuditReader({pool:auditReaderPool,expectedRole:'legaltech_audit_reader_ci',resolveTrustedAnchor:async()=>trustedAuditAnchor});
  const auditEvent=()=>({tenantId:tenantA,eventId:uuid(),actorId:actorA,traceId:'v120-synthetic',action:'SYNTHETIC_READ',outcome:'SUCCESS',objectId:'synthetic-object',matterId:'synthetic-matter',reasonCode:'AUTHORIZED'});
  await t.test('V120 independent writer instances append one serial tenant chain and reader verifies a trusted external prefix',async()=>{
    const results=await Promise.all(Array.from({length:12},(_,i)=>(i%2?auditOne:auditTwo).append(auditEvent())));
    const ordered=[...results].sort((a,b)=>a.position-b.position);assert.deepEqual(ordered.map(x=>x.position),Array.from({length:12},(_,i)=>i+1));
    for(let i=1;i<ordered.length;i++)assert.equal(ordered[i].previousHash,ordered[i-1].entryHash);
    // This synthetic descriptor is held outside PostgreSQL to model a trusted verifier;
    // it is not a production immutable external anchor or signature verification test.
    trustedAuditAnchor={tenantId:tenantA,auditCount:12,headHash:ordered.at(-1).entryHash};
    assert.equal((await auditReader.verify({tenantId:tenantA})).anchorVerified,true);
    const other=await auditOne.append({...auditEvent(),tenantId:tenantB});assert.equal(other.position,1);
    assert.equal((await auditReader.probe(tenantA)).ok,true);
  });
  await t.test('V120 cross-instance stable event replay does not duplicate and changed metadata conflicts',async()=>{
    const event=auditEvent();const result=await auditOne.append(event);const replay=await auditTwo.append(event);assert.equal(replay.replayed,true);assert.equal(replay.entryHash,result.entryHash);
    await assert.rejects(auditTwo.append({...event,outcome:'FAILED'}),/AUDIT_EVENT_CONFLICT/);
    assert.equal((await auditReaderPool.query('SELECT event_id FROM audit_security.entries WHERE tenant_id=$1 AND event_id=$2',[tenantA,event.eventId])).rows.length,1);
  });
  await t.test('V120 actual audit grants forbid mutation, head regression and domain/identity access',async()=>{
    for(const pool of [runtime,brokerOne,readerOne,limiterOne])assert.equal(await pool.query('SELECT * FROM audit_security.entries').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await auditWriterPool.query('UPDATE audit_security.entries SET entry_hash=entry_hash').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await auditWriterPool.query('DELETE FROM audit_security.entries').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await auditWriterPool.query('TRUNCATE audit_security.entries').then(()=>false,e=>e.code==='42501'),true);
    await assert.rejects(auditWriterPool.query('UPDATE audit_security.tenant_heads SET position=0,head_hash=$1 WHERE tenant_id=$2',['0'.repeat(64),tenantA]));
    assert.equal(await auditReaderPool.query('INSERT INTO audit_security.tenant_heads(tenant_id,position,head_hash) VALUES($1,0,$2)',[uuid(),'0'.repeat(64)]).then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await auditWriterPool.query('SELECT * FROM public.matters').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await auditWriterPool.query('SELECT * FROM identity_security.server_sessions').then(()=>false,e=>e.code==='42501'),true);
  });
  await t.test('V120 SQL validates canonical payload, request digest and chain hash before advancing a head',async()=>{
    const current=await auditReaderPool.query('SELECT * FROM audit_security.tenant_heads WHERE tenant_id=$1',[tenantA]);const count=Number(current.rows[0].position);
    const last=(await auditReaderPool.query('SELECT * FROM audit_security.entries WHERE tenant_id=$1 AND position=$2',[tenantA,count])).rows[0];
    const payload=JSON.parse(last.canonical_payload);payload.eventId=uuid();payload.position=count+1;
    await assert.rejects(auditWriterPool.query(`INSERT INTO audit_security.entries(tenant_id,position,event_id,created_at,request_hash,previous_hash,entry_hash,canonical_payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tenantA,count+1,payload.eventId,last.created_at,last.request_hash,last.entry_hash,'f'.repeat(64),JSON.stringify(payload)]));
    assert.equal(Number((await auditReaderPool.query('SELECT position FROM audit_security.tenant_heads WHERE tenant_id=$1',[tenantA])).rows[0].position),count);
  });
  await t.test('V120 verification uses an actual repeatable-read snapshot while a second connection appends',async()=>{
    const before=Number((await auditReaderPool.query('SELECT position FROM audit_security.tenant_heads WHERE tenant_id=$1',[tenantA])).rows[0].position);
    let startAnchor,finishAnchor;const started=new Promise(resolve=>{startAnchor=resolve});
    const snapshotReader=new PostgresAuditReader({pool:auditReaderPool,expectedRole:'legaltech_audit_reader_ci',resolveTrustedAnchor:async()=>{startAnchor();await new Promise(resolve=>{finishAnchor=resolve});return trustedAuditAnchor}});
    const pending=snapshotReader.verify({tenantId:tenantA});await started;await auditTwo.append(auditEvent());finishAnchor();assert.equal((await pending).auditCount,before);
  });
  await t.test('V120 externally retained synthetic anchor detects a restored shorter but internally valid database',async()=>{
    const last=await auditOne.append(auditEvent());trustedAuditAnchor={tenantId:tenantA,auditCount:last.position,headHash:last.entryHash};
    // Simulate a privileged restore in this disposable database only. Runtime has no DELETE.
    await admin.query('ALTER TABLE audit_security.entries DISABLE TRIGGER USER');
    await admin.query('ALTER TABLE audit_security.tenant_heads DISABLE TRIGGER USER');
    try{
      await admin.query('DELETE FROM audit_security.entries WHERE tenant_id=$1 AND position=$2',[tenantA,last.position]);
      await admin.query('UPDATE audit_security.tenant_heads SET position=$2,head_hash=$3 WHERE tenant_id=$1',[tenantA,last.position-1,last.previousHash]);
    }finally{
      await admin.query('ALTER TABLE audit_security.entries ENABLE TRIGGER USER');await admin.query('ALTER TABLE audit_security.tenant_heads ENABLE TRIGGER USER');
    }
    const localReader=new PostgresAuditReader({pool:auditReaderPool,expectedRole:'legaltech_audit_reader_ci'});assert.equal((await localReader.verify({tenantId:tenantA})).ok,true);
    await assert.rejects(auditReader.verify({tenantId:tenantA}),/AUDIT_INTEGRITY_UNAVAILABLE/);
  });

  const queueProducerPool=makePool('legaltech_queue_producer_ci'),queueWorkerPool=makePool('legaltech_queue_worker_ci'),queueWorkerPoolTwo=makePool('legaltech_queue_worker_ci'),queueReaderPool=makePool('legaltech_queue_reader_ci');
  const queueProducer=new PostgresJobProducer({pool:queueProducerPool,expectedRole:'legaltech_queue_producer_ci',authorizeEnqueue:async()=>true});
  let queueAuthority=true;
  const queueWorker=new PostgresJobWorker({pool:queueWorkerPool,expectedRole:'legaltech_queue_worker_ci',workerId:uuid(),authorizeWorker:async()=>queueAuthority});
  const queueWorkerTwo=new PostgresJobWorker({pool:queueWorkerPoolTwo,expectedRole:'legaltech_queue_worker_ci',workerId:uuid(),authorizeWorker:async()=>queueAuthority});
  const queueReader=new PostgresJobReader({pool:queueReaderPool,expectedRole:'legaltech_queue_reader_ci',authorizeRead:async()=>true});
  const queued=(type='POLICY_EVALUATION',extra={})=>({tenantId:tenantA,jobId:uuid(),kind:type,objectId:uuid(),traceId:'v121-ci',idempotencyKey:`v121-${uuid()}`,leaseMs:5000,maxRunMs:10000,maxAttempts:2,...extra});
  await t.test('V121 producer replay is immutable and queue roles cannot rewrite bindings or read domain/security data',async()=>{
    const event=queued();const first=await queueProducer.enqueue(event);assert.equal(first.status,'QUEUED');assert.equal((await queueProducer.enqueue(event)).replayed,true);
    await assert.rejects(queueProducer.enqueue({...event,objectId:uuid()}),/ENQUEUE_CONFLICT/);
    assert.equal((await queueProducer.probe()).ok,true);assert.equal((await queueWorker.probe()).ok,true);
    assert.equal(await queueProducerPool.query('UPDATE queue_security.jobs SET status=status').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await queueWorkerPool.query('UPDATE queue_security.jobs SET object_id=object_id').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await queueWorkerPool.query('DELETE FROM queue_security.jobs').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await queueReaderPool.query('UPDATE queue_security.jobs SET status=status').then(()=>false,e=>e.code==='42501'),true);
    for(const pool of [queueProducerPool,queueWorkerPool])assert.equal(await pool.query('SELECT * FROM public.matters').then(()=>false,e=>e.code==='42501'),true);
    for(const pool of [runtime,brokerOne,readerOne,auditReaderPool])assert.equal(await pool.query('SELECT * FROM queue_security.jobs').then(()=>false,e=>e.code==='42501'),true);
  });
  await t.test('V121 two connections claim distinct due jobs and cannot cross tenant boundaries',async()=>{
    for(let i=0;i<7;i++)await queueProducer.enqueue(queued());
    const claims=await Promise.all(Array.from({length:8},(_,i)=>(i%2?queueWorker:queueWorkerTwo).claimNext({tenantId:tenantA,kind:'POLICY_EVALUATION'})));
    assert.ok(claims.every(Boolean));assert.equal(new Set(claims.map(x=>x.jobId)).size,8);
    assert.equal(await queueWorker.claimNext({tenantId:tenantB,kind:'POLICY_EVALUATION'}),null);
    for(const claim of claims){
      const found=await queueWorkerPool.query('SELECT lease_token_hash FROM queue_security.jobs WHERE tenant_id=$1 AND job_id=$2',[tenantA,claim.jobId]);
      assert.notEqual(found.rows[0].lease_token_hash,claim.token);assert.equal(found.rows[0].lease_token_hash,crypto.createHash('sha256').update(claim.token).digest('hex'));
    }
  });
  let recoveredClaim;
  await t.test('V121 expiry, recovery and reclaim advance the fence and reject old worker renew/complete',async()=>{
    const event=queued('PROCESS_INBOUND');await queueProducer.enqueue(event);const first=await queueWorker.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});
    assert.equal(await queueWorker.renew(first),true);assert.equal(await queueWorker.assertCurrent(first),true);
    await admin.query('ALTER TABLE queue_security.jobs DISABLE TRIGGER protect_shared_job_transition');
    try{await admin.query("UPDATE queue_security.jobs SET started_at=clock_timestamp()-interval '10 seconds',lease_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND job_id=$2",[tenantA,event.jobId]);}
    finally{await admin.query('ALTER TABLE queue_security.jobs ENABLE TRIGGER protect_shared_job_transition');}
    assert.equal(await queueWorker.complete(first),false);
    const recovered=await queueWorkerTwo.recoverExpired({tenantId:tenantA,kind:'PROCESS_INBOUND'});assert.equal(recovered.length,1);assert.equal(recovered[0].status,'QUEUED');
    await new Promise(resolve=>setTimeout(resolve,1100));
    const second=await queueWorkerTwo.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});assert.equal(second.attempt,first.attempt+1);assert.notEqual(second.token,first.token);recoveredClaim=second;
    assert.equal(await queueWorker.renew(first),false);assert.equal(await queueWorker.complete(first),false);
    await assert.rejects(queueWorker.assertCurrent(first),/UNAVAILABLE/);
    assert.equal(await queueWorkerTwo.complete(second),true);assert.equal(await queueWorkerTwo.complete(second),true);
    assert.equal((await queueReader.get({tenantId:tenantA,jobId:event.jobId})).status,'SUCCEEDED');
  });
  await t.test('V121 asynchronous authorisation withdrawal denies even current claim settlement',async()=>{
    queueAuthority=false;try{await assert.rejects(queueWorkerTwo.complete(recoveredClaim),/FORBIDDEN/);}finally{queueAuthority=true;}
  });
  await t.test('V121 expired external side effects enter reconciliation and never become automatic retry candidates',async()=>{
    const event=queued('PROCLAIM_WRITEBACK');await queueProducer.enqueue(event);const claim=await queueWorker.claimNext({tenantId:tenantA,kind:'PROCLAIM_WRITEBACK'});
    await admin.query('ALTER TABLE queue_security.jobs DISABLE TRIGGER protect_shared_job_transition');
    try{await admin.query("UPDATE queue_security.jobs SET started_at=clock_timestamp()-interval '10 seconds',lease_until=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND job_id=$2",[tenantA,event.jobId]);}
    finally{await admin.query('ALTER TABLE queue_security.jobs ENABLE TRIGGER protect_shared_job_transition');}
    const recovered=await queueWorkerTwo.recoverExpired({tenantId:tenantA,kind:'PROCLAIM_WRITEBACK'});assert.equal(recovered[0].status,'RECONCILE');
    assert.equal(await queueWorker.claimNext({tenantId:tenantA,kind:'PROCLAIM_WRITEBACK'}),null);assert.equal(await queueWorker.complete(claim),false);
    const notification=queued('NOTIFICATION_DELIVERY');await queueProducer.enqueue(notification);const sending=await queueWorker.claimNext({tenantId:tenantA,kind:'NOTIFICATION_DELIVERY'});
    assert.equal(await queueWorker.fail(sending,{errorCode:'OUTCOME_UNKNOWN',retryable:true}),true);
    assert.equal((await queueReader.get({tenantId:tenantA,jobId:notification.jobId})).status,'RECONCILE');
    assert.equal(await queueWorker.claimNext({tenantId:tenantA,kind:'NOTIFICATION_DELIVERY'}),null);
  });
  await t.test('V121 bounded retries end in dead state and locked candidates are skipped on another connection',async()=>{
    const dead=queued('PROCESS_INBOUND',{maxAttempts:1});await queueProducer.enqueue(dead);const claim=await queueWorker.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});assert.equal(await queueWorker.fail(claim,{errorCode:'FAILED',retryable:true}),true);
    assert.equal((await queueReader.get({tenantId:tenantA,jobId:dead.jobId})).status,'DEAD');
    const locked=queued('PROCESS_INBOUND'),other=queued('PROCESS_INBOUND');await queueProducer.enqueue(locked);await queueProducer.enqueue(other);
    const connection=await queueWorkerPool.connect();try{
      await connection.query('BEGIN');await connection.query('SELECT job_id FROM queue_security.jobs WHERE tenant_id=$1 AND job_id=$2 FOR UPDATE',[tenantA,locked.jobId]);
      const available=await queueWorkerTwo.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});assert.equal(available.jobId,other.jobId);
      await connection.query('ROLLBACK');
    }finally{connection.release();}
    const later=await queueWorker.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});assert.equal(later.jobId,locked.jobId);
  });

  const outbox=new PostgresDomainOutbox({pool:runtime,expectedRole:'legaltech_runtime_ci',authorizeAppend:async()=>true});
  const relayPool=makePool('legaltech_outbox_relay_ci'),relayPoolTwo=makePool('legaltech_outbox_relay_ci');
  const relayOptions={expectedRole:'legaltech_outbox_relay_ci',jobProducer:queueProducer,authorizeRelay:async()=>true};
  const relay=new PostgresOutboxRelay({...relayOptions,pool:relayPool}),relayTwo=new PostgresOutboxRelay({...relayOptions,pool:relayPoolTwo});
  const outboxScope={tenantId:tenantA,actorId:actorA};
  const appendOutbox=event=>outbox.run(outboxScope,async tx=>{
    await tx.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[event.objectId,tenantA,`outbox-${event.objectId}`]);
    return tx.enqueue(event);
  });
  await t.test('V122 actual domain rollback removes both matter and outbox intent',async()=>{
    const event=queued();await assert.rejects(outbox.run(outboxScope,async tx=>{
      await tx.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[event.objectId,tenantA,`rollback-${event.objectId}`]);
      await tx.enqueue(event);throw new Error('intentional rollback');
    }),/OUTBOX_STORE_UNAVAILABLE/);
    assert.equal((await admin.query('SELECT id FROM public.matters WHERE id=$1',[event.objectId])).rows.length,0);
    assert.equal((await admin.query('SELECT job_id FROM public.domain_outbox_events WHERE job_id=$1',[event.jobId])).rows.length,0);
  });
  await t.test('V122 domain commit, immutable replay and concurrent relays produce one queued job and receipt',async()=>{
    const event=queued();await appendOutbox(event);
    assert.equal((await outbox.run(outboxScope,tx=>tx.enqueue(event))).replayed,true);
    await assert.rejects(outbox.run(outboxScope,tx=>tx.enqueue({...event,maxAttempts:3})),/OUTBOX_APPEND_CONFLICT/);
    await Promise.all([relay.relay(outboxScope),relayTwo.relay(outboxScope)]);
    assert.equal((await admin.query('SELECT job_id FROM queue_security.jobs WHERE tenant_id=$1 AND job_id=$2',[tenantA,event.jobId])).rows.length,1);
    assert.equal((await admin.query('SELECT job_id FROM public.domain_outbox_receipts WHERE tenant_id=$1 AND job_id=$2',[tenantA,event.jobId])).rows.length,1);
  });
  await t.test('V122 committed queue insert before relay crash replays without duplicate job',async()=>{
    const event=queued();await appendOutbox(event);await queueProducer.enqueue(event);
    assert.equal((await admin.query('SELECT job_id FROM public.domain_outbox_receipts WHERE job_id=$1',[event.jobId])).rows.length,0);
    assert.equal((await relay.relay(outboxScope)).delivered,1);
    assert.equal((await admin.query('SELECT job_id FROM queue_security.jobs WHERE job_id=$1',[event.jobId])).rows.length,1);
  });
  await t.test('V122 outbox RLS and narrow grants isolate domain, relay and queue roles',async()=>{
    const event=queued();await appendOutbox(event);
    assert.equal((await relay.relay({tenantId:tenantB,actorId:actorB})).scanned,0);
    const hidden=await outbox.run({tenantId:tenantB,actorId:actorB},tx=>tx.query('SELECT job_id FROM public.domain_outbox_events WHERE job_id=$1',[event.jobId]));assert.equal(hidden.rows.length,0);
    for(const pool of [runtime,relayPool]){
      for(const sql of ['UPDATE public.domain_outbox_events SET intent=intent','DELETE FROM public.domain_outbox_events','TRUNCATE public.domain_outbox_events'])assert.equal(await pool.query(sql).then(()=>false,e=>e.code==='42501'),true);
    }
    assert.equal(await relayPool.query('SELECT * FROM public.matters').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await relayPool.query('SELECT * FROM queue_security.jobs').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await queueProducerPool.query('SELECT * FROM public.domain_outbox_events').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await runtime.query('INSERT INTO public.domain_outbox_receipts(tenant_id,job_id,request_hash) VALUES($1,$2,$3)',[tenantA,event.jobId,'0'.repeat(64)]).then(()=>false,e=>e.code==='42501'),true);
    await admin.query('GRANT SELECT ON queue_security.jobs TO legaltech_runtime_ci');
    try{assert.equal((await createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})()).ok,false);}
    finally{await admin.query('REVOKE SELECT ON queue_security.jobs FROM legaltech_runtime_ci');}
    await relay.relay(outboxScope);
  });
  await t.test('V122 database rejects arbitrary content, JSON nulls and malformed policy in intents',async()=>{
    for(const change of [{payload:'synthetic-sensitive'},{traceHash:null},{kind:null},{maxAttempts:null},{leaseMs:1},{delayMs:-1}]){
      const event=queued(),intent={...prepareJobIntent(event),...change},body=canonicalAuditPayload(intent),hash=intentHash(intent);
      const result=await admin.query('SELECT public.valid_job_intent($1,$2) AS valid',[body,hash]);assert.equal(result.rows[0].valid,false);
      await assert.rejects(transactions.run(outboxScope,tx=>tx.query('INSERT INTO public.domain_outbox_events(tenant_id,job_id,kind,object_id,key_hash,request_hash,intent) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantA,event.jobId,event.kind,event.objectId,intent.keyHash,hash,body])),/UNAVAILABLE/);
    }
  });
  await t.test('V122 authorization withdrawal after queue commit leaves an intent replayable',async()=>{
    const event=queued();await appendOutbox(event);
    const withdrawn=new PostgresOutboxRelay({...relayOptions,pool:relayPool,authorizeRelay:async b=>b.operation!=='RELAY_ACK'});
    await assert.rejects(withdrawn.relay(outboxScope),/OUTBOX_FORBIDDEN/);
    assert.equal((await admin.query('SELECT job_id FROM queue_security.jobs WHERE job_id=$1',[event.jobId])).rows.length,1);
    assert.equal((await admin.query('SELECT job_id FROM public.domain_outbox_receipts WHERE job_id=$1',[event.jobId])).rows.length,0);
    assert.equal((await relay.relay(outboxScope)).delivered,1);
  });

  // All accepting callbacks and the in-memory drain below are synthetic CI
  // fixtures. Deployment must bind real capability, payload, policy and drain gates.
  const serviceActor=uuid();
  await admin.query("INSERT INTO public.actors(id,tenant_id,actor_type,status) VALUES($1,$2,'SERVICE','ACTIVE')",[serviceActor,tenantA]);
  const relayScope={tenantId:tenantA,actorId:serviceActor};
  const authorizeScope=async({tenantId,actorId,signal})=>transactions.run({tenantId,actorId,signal,readOnly:true},async tx=>{
    const state=await tx.query('SELECT a.actor_type,a.status,t.status AS tenant_status FROM public.actors a JOIN public.tenants t ON t.id=a.tenant_id WHERE a.tenant_id=$1 AND a.id=$2',[tenantId,actorId]);
    return state.rows.length===1&&state.rows[0].actor_type==='SERVICE'&&state.rows[0].status==='ACTIVE'&&state.rows[0].tenant_status==='ACTIVE';
  });
  const pipelineOptions={domainPool:runtime,expectedDomainRole:'legaltech_runtime_ci',relayPool,expectedRelayRole:'legaltech_outbox_relay_ci',producerPool:queueProducerPool,expectedProducerRole:'legaltech_queue_producer_ci',
    authorizeDomain:async()=>true,authorizeAppend:async()=>true,authorizeRelay:async()=>true,authorizeEnqueue:async()=>true,
    getScopes:async()=>[relayScope],authorizeScope,drain:new DeploymentDrainController({authorize:()=>true}),pollIntervalMs:100,cycleTimeoutMs:10000};
  const pipeline=createPostgresDomainPipeline(pipelineOptions);
  supervisors.push(pipeline.supervisor);
  const command=()=>({tenantId:tenantA,actorId:actorA,commandId:uuid(),jobId:uuid(),eventId:uuid(),payloadId:uuid(),payloadHash:'a'.repeat(64),sourceSystem:'MANUAL_UPLOAD',externalEventId:`ci-source-${uuid()}`,traceId:'v123-ci'});
  const waitReceipt=async jobId=>{
    const end=Date.now()+5000;while(Date.now()<end){if((await admin.query('SELECT job_id FROM public.domain_outbox_receipts WHERE tenant_id=$1 AND job_id=$2',[tenantA,jobId])).rows.length)return;await new Promise(resolve=>setTimeout(resolve,10));}
    throw new Error('CI_RELAY_RECEIPT_TIMEOUT');
  };
  await t.test('V123 real domain pipeline registers once and supervised relay delivers one job',async()=>{
    const input=command();const results=await Promise.all([pipeline.handlers.registerInbound(input),pipeline.handlers.registerInbound(input)]);
    assert.deepEqual(results.map(r=>r.replayed).sort(),[false,true]);
    const row=(await admin.query('SELECT * FROM public.inbound_events WHERE id=$1',[input.eventId])).rows[0];
    assert.equal(row.status,'RECEIVED');assert.equal(row.external_event_id,crypto.createHash('sha256').update(input.externalEventId).digest('hex'));assert.equal(row.payload_ref,`object:${input.payloadId}`);
    assert.equal((await admin.query('SELECT command_id FROM public.domain_job_commands WHERE command_id=$1',[input.commandId])).rows.length,1);
    pipeline.supervisor.start();await waitReceipt(input.jobId);assert.equal((await pipeline.supervisor.stop()).drained,true);
    assert.equal((await admin.query('SELECT job_id FROM queue_security.jobs WHERE job_id=$1',[input.jobId])).rows.length,1);
    await assert.rejects(pipeline.handlers.registerInbound({...input,payloadHash:'b'.repeat(64)}),/DOMAIN_COMMAND_CONFLICT/);
  });
  await t.test('V123 policy request binds accessible open matter and exact version; closed/invisible matters deny',async()=>{
    const matterId=uuid();await admin.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[matterId,tenantA,`policy-${matterId}`]);
    const input={tenantId:tenantA,actorId:actorA,commandId:uuid(),jobId:uuid(),matterId,policyVersionId:uuid(),policyVersionHash:'b'.repeat(64),traceId:'v123-policy'};
    assert.equal((await pipeline.handlers.requestPolicyEvaluation(input)).replayed,false);assert.equal((await pipeline.handlers.requestPolicyEvaluation(input)).replayed,true);
    await assert.rejects(pipeline.handlers.requestPolicyEvaluation({...input,policyVersionHash:'c'.repeat(64)}),/DOMAIN_COMMAND_CONFLICT/);
    await admin.query("UPDATE public.matters SET status='CLOSED' WHERE id=$1",[matterId]);
    await assert.rejects(pipeline.handlers.requestPolicyEvaluation({...input,commandId:uuid(),jobId:uuid()}),/DOMAIN_COMMAND_FORBIDDEN/);
    await assert.rejects(pipeline.handlers.requestPolicyEvaluation({...input,commandId:uuid(),jobId:uuid(),matterId:'11700000-0000-4000-8000-000000000033'}),/DOMAIN_COMMAND_FORBIDDEN/);
    await relay.relay(outboxScope);
  });
  await t.test('V123 append authorization failure rolls back concrete inbound row and command',async()=>{
    const blocked=createPostgresDomainPipeline({...pipelineOptions,authorizeAppend:async()=>false}),input=command();
    await assert.rejects(blocked.handlers.registerInbound(input),/DOMAIN_COMMAND_UNAVAILABLE/);
    for(const [table,column,id] of [['inbound_events','id',input.eventId],['domain_job_commands','command_id',input.commandId],['domain_outbox_events','job_id',input.jobId]]){
      assert.equal((await admin.query(`SELECT 1 FROM public.${table} WHERE ${column}=$1`,[id])).rows.length,0);
    }
  });
  await t.test('V123 deferred command foreign keys reject a commit without the exact bound outbox intent',async()=>{
    const matterId=uuid();await admin.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[matterId,tenantA,`fk-${matterId}`]);
    const commandId=uuid(),jobId=uuid();
    await assert.rejects(transactions.run(outboxScope,tx=>tx.query(`INSERT INTO public.domain_job_commands(tenant_id,command_id,actor_id,job_id,kind,object_id,matter_id,policy_version_id,policy_version_hash,trace_hash,request_hash,intent_hash)
      VALUES($1,$2,$3,$4,'POLICY_EVALUATION',$5,$5,$6,$7,$7,$7,$7)`,[tenantA,commandId,actorA,jobId,matterId,uuid(),'a'.repeat(64)])),/OUTCOME_UNKNOWN/);
    assert.equal((await admin.query('SELECT command_id FROM public.domain_job_commands WHERE command_id=$1',[commandId])).rows.length,0);
  });
  await t.test('V123 command tenant/actor policies and immutable grants deny cross-tenant or private-role misuse',async()=>{
    const hidden=await transactions.run({tenantId:tenantB,actorId:actorB},tx=>tx.query('SELECT * FROM public.domain_job_commands'));assert.equal(hidden.rows.length,0);
    for(const sql of ['UPDATE public.domain_job_commands SET trace_hash=trace_hash','DELETE FROM public.domain_job_commands','TRUNCATE public.domain_job_commands'])assert.equal(await runtime.query(sql).then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await relayPool.query('SELECT * FROM public.domain_job_commands').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await queueProducerPool.query('SELECT * FROM public.domain_job_commands').then(()=>false,e=>e.code==='42501'),true);
    await admin.query('GRANT legaltech_domain_commands TO legaltech_queue_producer_ci');
    try{await assert.rejects(queueProducer.probe(),/UNAVAILABLE/);}finally{await admin.query('REVOKE legaltech_domain_commands FROM legaltech_queue_producer_ci');}
  });
  await t.test('V123 disabled service scope fails supervision without delivery and recovery replays pending intent',async()=>{
    const input=command();await pipeline.handlers.registerInbound(input);
    await admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[serviceActor]);
    pipeline.supervisor.start();const end=Date.now()+5000;while(pipeline.supervisor.status().inFlight&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(pipeline.supervisor.status().state,'FAILED');assert.equal((await admin.query('SELECT job_id FROM queue_security.jobs WHERE job_id=$1',[input.jobId])).rows.length,0);
    await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[serviceActor]);
    pipeline.supervisor.start();await waitReceipt(input.jobId);assert.equal((await pipeline.supervisor.stop()).drained,true);
    assert.equal((await admin.query('SELECT job_id FROM queue_security.jobs WHERE job_id=$1',[input.jobId])).rows.length,1);
  });

  // Drain earlier synthetic queued examples before worker execution tests.
  for(const kind of ['PROCESS_INBOUND','POLICY_EVALUATION']){
    for(let i=0;i<100;i++){const claim=await queueWorker.claimNext({tenantId:tenantA,kind});if(!claim)break;await queueWorker.fail(claim,{errorCode:'CI_FIXTURE_SETTLED',retryable:false});}
  }
  const domainReaderPool=makePool('legaltech_job_domain_reader_ci');
  const bytes=Buffer.from('synthetic V124 artifact'),artifactHash=crypto.createHash('sha256').update(bytes).digest('hex'),resultHash=crypto.createHash('sha256').update('synthetic output').digest('hex');
  let artifactOverride=null,executionAllowed=true,processed=0;
  const workerOptions={workerPool:queueWorkerPool,expectedWorkerRole:'legaltech_queue_worker_ci',domainReaderPool,expectedDomainReaderRole:'legaltech_job_domain_reader_ci',workerId:uuid(),
    authorizeWorker:async()=>true,authorizeDomainRead:async()=>true,authorizeExecution:async()=>executionAllowed,
    loadPayload:async b=>({tenantId:b.tenantId,id:b.payloadId,hash:b.payloadHash,state:'PROCESSING_ALLOWED',bytes:artifactOverride??bytes}),
    loadPolicy:async b=>({tenantId:b.tenantId,id:b.policyVersionId,hash:b.policyVersionHash,state:'PUBLISHED',bytes}),
    processInbound:async c=>{await c.checkpoint();processed++;return {resultCode:'CLASSIFIED',resultHash};},evaluatePolicy:async()=>({resultCode:'EVALUATED',resultHash}),
    getScopes:async()=>[relayScope],authorizeScope,drain:pipelineOptions.drain,executionTimeoutMs:2000,heartbeatIntervalMs:100,pollIntervalMs:100,cycleTimeoutMs:10000};
  const workerPipeline=createPostgresWorkerPipeline(workerOptions);supervisors.push(workerPipeline.supervisor);
  const createInbound=async()=>{const input={...command(),payloadHash:artifactHash};await pipeline.handlers.registerInbound(input);await relay.relay(outboxScope);return input;};
  const runInbound=()=>workerPipeline.runtime.processNext({tenantId:tenantA,serviceActorId:serviceActor,kind:'PROCESS_INBOUND'});
  const domainLoader=new PostgresWorkerDomainLoader({pool:domainReaderPool,expectedRole:'legaltech_job_domain_reader_ci',authorizeRead:async()=>true});
  await t.test('V124 verified inbound execution commits one immutable result with successful queue status',async()=>{
    const input=await createInbound(),result=await runInbound();assert.equal(result.jobId,input.jobId);assert.equal(result.status,'SUCCEEDED');assert.equal(processed,1);
    const receipt=await queueReader.getResult({tenantId:tenantA,jobId:input.jobId});assert.equal(receipt.commandId,input.commandId);assert.equal(receipt.artifactHash,artifactHash);assert.equal(receipt.resultHash,resultHash);assert.equal(receipt.tokenHash,undefined);
    assert.equal((await queueReader.get({tenantId:tenantA,jobId:input.jobId})).status,'SUCCEEDED');assert.equal(await runInbound(),null);
    assert.equal((await domainLoader.probe()).ok,true);
  });
  await t.test('V124 real result ledger rejects receipt-only transactions and rolls back the insert',async()=>{
    const input=await createInbound(),claim=await queueWorker.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});
    const row=(await admin.query('SELECT request_hash FROM public.domain_job_commands WHERE job_id=$1',[input.jobId])).rows[0];
    const client=await queueWorkerPool.connect();try{
      await client.query('BEGIN');await client.query(`INSERT INTO queue_security.job_results(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id,token_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CLASSIFIED',$9,$10,$11)`,[tenantA,input.jobId,claim.kind,claim.objectId,input.commandId,row.request_hash,artifactHash,resultHash,claim.attempt,claim.workerId,crypto.createHash('sha256').update(claim.token).digest('hex')]);
      await assert.rejects(client.query('COMMIT'),/atomic completion/);
    }finally{await client.query('ROLLBACK');client.release();}
    assert.equal((await admin.query('SELECT job_id FROM queue_security.job_results WHERE job_id=$1',[input.jobId])).rows.length,0);
    const metadata={commandId:input.commandId,commandHash:row.request_hash,artifactHash,resultHash,resultCode:'CLASSIFIED'};
    assert.equal((await queueWorker.completeWithResult(claim,metadata)).jobId,input.jobId);assert.equal((await queueWorker.completeWithResult(claim,metadata)).jobId,input.jobId);
    await assert.rejects(queueWorker.completeWithResult(claim,{...metadata,resultHash:'c'.repeat(64)}),/UNAVAILABLE/);
  });
  await t.test('V124 stale claim token or fence cannot insert results or settle a current job',async()=>{
    const input=await createInbound(),claim=await queueWorker.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});
    const row=(await admin.query('SELECT request_hash FROM public.domain_job_commands WHERE job_id=$1',[input.jobId])).rows[0];
    const metadata={commandId:input.commandId,commandHash:row.request_hash,artifactHash,resultHash,resultCode:'CLASSIFIED'};
    assert.equal(await queueWorker.completeWithResult({...claim,attempt:claim.attempt+1},metadata),false);
    assert.equal(await queueWorker.completeWithResult({...claim,token:crypto.randomBytes(32).toString('base64url')},metadata),false);
    await assert.rejects(queueWorkerPool.query(`INSERT INTO queue_security.job_results(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id,token_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CLASSIFIED',$9,$10,$11)`,[tenantA,input.jobId,claim.kind,claim.objectId,input.commandId,row.request_hash,artifactHash,resultHash,claim.attempt,claim.workerId,'0'.repeat(64)]),/current claim/);
    assert.equal(await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}),null);await queueWorker.fail(claim,{errorCode:'CI_FIXTURE_SETTLED',retryable:false});
  });
  await t.test('V124 result ledger and read-only domain credentials cannot cross principal boundaries',async()=>{
    for(const pool of [runtime,domainReaderPool,brokerOne,relayPool])assert.equal(await pool.query('SELECT * FROM queue_security.job_results').then(()=>false,e=>e.code==='42501'),true);
    for(const sql of ['UPDATE queue_security.job_results SET result_hash=result_hash','DELETE FROM queue_security.job_results','TRUNCATE queue_security.job_results'])assert.equal(await queueWorkerPool.query(sql).then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await domainReaderPool.query('UPDATE public.inbound_events SET status=status').then(()=>false,e=>e.code==='42501'),true);
    assert.equal(await queueWorkerPool.query('SELECT * FROM public.domain_job_commands').then(()=>false,e=>e.code==='42501'),true);
    await admin.query('GRANT legaltech_job_domain_reader TO legaltech_runtime_ci');
    try{assert.equal((await createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})({})).ok,false);}finally{await admin.query('REVOKE legaltech_job_domain_reader FROM legaltech_runtime_ci');}
    const scoped=new PostgresTenantTransactions({pool:domainReaderPool,expectedRole:'legaltech_job_domain_reader_ci'});
    assert.equal((await scoped.run({tenantId:tenantB,actorId:actorB},tx=>tx.query('SELECT * FROM public.domain_job_commands'))).rows.length,0);
    await admin.query('GRANT legaltech_job_domain_reader TO legaltech_queue_worker_ci');
    try{await assert.rejects(queueWorker.probe(),/UNAVAILABLE/);}finally{await admin.query('REVOKE legaltech_job_domain_reader FROM legaltech_queue_worker_ci');}
  });
  await t.test('V124 tampered provider bytes fail without processing or persisting results',async()=>{
    const input=await createInbound();artifactOverride=Buffer.from('tampered');try{assert.equal((await runInbound()).errorCode,'WORKER_ARTIFACT_INVALID');}finally{artifactOverride=null;}
    assert.equal((await queueReader.get({tenantId:tenantA,jobId:input.jobId})).status,'DEAD');assert.equal(await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}),null);assert.equal(processed,1);
  });
  await t.test('V124 withdrawn current execution permission denies a still-valid queue claim',async()=>{
    const input=await createInbound();executionAllowed=false;try{assert.equal((await runInbound()).errorCode,'WORKER_AUTHORIZATION_DENIED');}finally{executionAllowed=true;}
    assert.equal(await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}),null);assert.equal(processed,1);
  });
  await t.test('V124 disabled service and original author are denied by actual tenant-scoped domain loading',async()=>{
    const input=await createInbound(),claim=await queueWorker.claimNext({tenantId:tenantA,kind:'PROCESS_INBOUND'});
    for(const id of [serviceActor,actorA]){await admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[id]);try{await assert.rejects(domainLoader.load(claim,{serviceActorId:serviceActor}),/FORBIDDEN/);}finally{await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[id]);}}
    await queueWorker.fail(claim,{errorCode:'CI_FIXTURE_SETTLED',retryable:false});assert.equal(await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}),null);
  });
  await t.test('V124 disabled result triggers deny producer and worker health and settlement',async()=>{
    await admin.query('ALTER TABLE queue_security.job_results DISABLE TRIGGER worker_result_completion');
    try{await assert.rejects(queueWorker.probe(),/UNAVAILABLE/);await assert.rejects(queueProducer.probe(),/UNAVAILABLE/);}finally{await admin.query('ALTER TABLE queue_security.job_results ENABLE TRIGGER worker_result_completion');}
  });
  await t.test('V124 published policy version is verified before atomic evaluation receipt',async()=>{
    const matterId=uuid();await admin.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[matterId,tenantA,`v124-policy-${matterId}`]);
    const input={tenantId:tenantA,actorId:actorA,commandId:uuid(),jobId:uuid(),matterId,policyVersionId:uuid(),policyVersionHash:artifactHash,traceId:'v124-policy'};
    await pipeline.handlers.requestPolicyEvaluation(input);await relay.relay(outboxScope);const result=await workerPipeline.runtime.processNext({tenantId:tenantA,serviceActorId:serviceActor,kind:'POLICY_EVALUATION'});
    assert.equal(result.status,'SUCCEEDED');assert.equal(result.jobId,input.jobId);assert.equal((await queueReader.getResult({tenantId:tenantA,jobId:input.jobId})).artifactHash,artifactHash);
  });
  await t.test('V124 supervised worker cycle completes the connected domain-relay-worker path and drains',async()=>{
    const input=await createInbound();workerPipeline.supervisor.start();const end=Date.now()+5000;
    while(!(await admin.query('SELECT job_id FROM queue_security.job_results WHERE job_id=$1',[input.jobId])).rows.length&&Date.now()<end)await new Promise(r=>setTimeout(r,10));
    assert.equal((await workerPipeline.supervisor.stop()).drained,true);assert.equal((await queueReader.getResult({tenantId:tenantA,jobId:input.jobId})).commandId,input.commandId);
    assert.equal(workerPipeline.supervisor.status().inFlight,false);
  });

  const adopter=new PostgresResultAdopter({domainOutbox:outbox,jobReader:queueReader,authorizeAdoption:async()=>true});
  let adoptedInput;
  await t.test('V125 real adoption commits the queue-bound receipt and inbound status atomically and replays',async()=>{
    adoptedInput=await createInbound();assert.equal((await runInbound()).status,'SUCCEEDED');
    const receipt=await adopter.adopt({tenantId:tenantA,serviceActorId:serviceActor,jobId:adoptedInput.jobId});assert.equal(receipt.status,'APPLIED');assert.equal(receipt.commandId,adoptedInput.commandId);
    assert.equal((await admin.query('SELECT status FROM public.inbound_events WHERE id=$1',[adoptedInput.eventId])).rows[0].status,'PROCESSED');
    assert.equal((await adopter.adopt({tenantId:tenantA,serviceActorId:serviceActor,jobId:adoptedInput.jobId})).replayed,true);
    assert.equal((await admin.query('SELECT job_id FROM public.domain_job_results WHERE job_id=$1',[adoptedInput.jobId])).rows.length,1);
  });
  await t.test('V125 forged public result fails the exact private receipt foreign key without private SELECT grants',async()=>{
    const input=await createInbound();assert.equal((await runInbound()).status,'SUCCEEDED');const r=await queueReader.getResult({tenantId:tenantA,jobId:input.jobId});
    await assert.rejects(transactions.run({tenantId:tenantA,actorId:serviceActor},tx=>tx.query(`INSERT INTO public.domain_job_results(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id,adopted_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[r.tenantId,r.jobId,r.kind,r.objectId,r.commandId,r.commandHash,r.artifactHash,'c'.repeat(64),r.resultCode,r.attempt,r.workerId,serviceActor])),/UNAVAILABLE/);
    assert.equal((await admin.query('SELECT job_id FROM public.domain_job_results WHERE job_id=$1',[input.jobId])).rows.length,0);
    assert.equal(await runtime.query('SELECT * FROM queue_security.job_results').then(()=>false,e=>e.code==='42501'),true);
  });
  await t.test('V125 receipt-only adoption and status-only mutation both fail and leave no domain effects',async()=>{
    const input=await createInbound();assert.equal((await runInbound()).status,'SUCCEEDED');const r=await queueReader.getResult({tenantId:tenantA,jobId:input.jobId});
    await assert.rejects(transactions.run({tenantId:tenantA,actorId:serviceActor},tx=>tx.query(`INSERT INTO public.domain_job_results(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id,adopted_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[r.tenantId,r.jobId,r.kind,r.objectId,r.commandId,r.commandHash,r.artifactHash,r.resultHash,r.resultCode,r.attempt,r.workerId,serviceActor])),/OUTCOME_UNKNOWN/);
    assert.equal((await admin.query('SELECT job_id FROM public.domain_job_results WHERE job_id=$1',[input.jobId])).rows.length,0);
    await assert.rejects(transactions.run({tenantId:tenantA,actorId:serviceActor},tx=>tx.query("UPDATE public.inbound_events SET status='PROCESSED' WHERE id=$1",[input.eventId])),/UNAVAILABLE/);
    assert.equal((await admin.query('SELECT status FROM public.inbound_events WHERE id=$1',[input.eventId])).rows[0].status,'RECEIVED');
  });
  await t.test('V125 immutable result grants and tenant RLS deny private-principal or cross-tenant misuse',async()=>{
    assert.equal((await transactions.run({tenantId:tenantB,actorId:actorB},tx=>tx.query('SELECT * FROM public.domain_job_results'))).rows.length,0);
    for(const sql of ['UPDATE public.domain_job_results SET result_hash=result_hash','DELETE FROM public.domain_job_results','TRUNCATE public.domain_job_results'])assert.equal(await runtime.query(sql).then(()=>false,e=>e.code==='42501'),true);
    for(const pool of [queueWorkerPool,queueReaderPool,relayPool,domainReaderPool])assert.equal(await pool.query('SELECT * FROM public.domain_job_results').then(()=>false,e=>e.code==='42501'),true);
    await admin.query('GRANT legaltech_domain_result_writer TO legaltech_queue_reader_ci');
    try{await assert.rejects(queueReader.getResult({tenantId:tenantA,jobId:adoptedInput.jobId}),/UNAVAILABLE/);}finally{await admin.query('REVOKE legaltech_domain_result_writer FROM legaltech_queue_reader_ci');}
  });
  await t.test('V125 current adoption authority and disabled service identities deny even completed receipt replay',async()=>{
    const denied=new PostgresResultAdopter({domainOutbox:outbox,jobReader:queueReader,authorizeAdoption:async()=>false});await assert.rejects(denied.adopt({tenantId:tenantA,serviceActorId:serviceActor,jobId:adoptedInput.jobId}),/FORBIDDEN/);
    await admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[serviceActor]);
    try{await assert.rejects(adopter.adopt({tenantId:tenantA,serviceActorId:serviceActor,jobId:adoptedInput.jobId}),/FORBIDDEN/);}finally{await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[serviceActor]);}
  });
  await t.test('V125 disabled result adoption trigger denies mutation and replay',async()=>{
    await admin.query('ALTER TABLE public.domain_job_results DISABLE TRIGGER domain_result_binding');
    try{await assert.rejects(adopter.adopt({tenantId:tenantA,serviceActorId:serviceActor,jobId:adoptedInput.jobId}),/UNAVAILABLE/);}finally{await admin.query('ALTER TABLE public.domain_job_results ENABLE TRIGGER domain_result_binding');}
  });
  // SDK/version manifest below are sealed synthetic fixtures, not live cloud SDKs.
  const manifests=new Map();let evidenceAllowed=true,canaryAllowed=true;
  const {loadPayload:unusedPayload,loadPolicy:unusedPolicy,...managedWorker}=workerOptions;
  const managed=createPostgresManagedProcessing({domain:pipelineOptions,worker:managedWorker,queueReaderPool,expectedQueueReaderRole:'legaltech_queue_reader_ci',authorizeResultRead:async()=>true,authorizeAdoption:async()=>true,
    artifacts:{manifest:{resolveVersion:async r=>manifests.get(r.id),probe:async()=>({ok:true})},storage:{readVersion:async r=>({tenantId:r.tenantId,objectKey:r.objectKey,versionId:r.versionId,hash:r.hash,contentLength:r.size,body:(async function*(){yield bytes;})()}),probe:async()=>({ok:true})},authorizeVersion:async()=>true,verifyEvidence:async()=>evidenceAllowed},
    canary:{tenantId:tenantA,actorId:actorA,serviceActorId:serviceActor,authorizeCanary:async()=>canaryAllowed,createFixture:async()=>{
      const payloadId=uuid();manifests.set(payloadId,{tenantId:tenantA,id:payloadId,kind:'PAYLOAD',hash:artifactHash,objectKey:`${tenantA}/canary/${payloadId}`,versionId:'synthetic-v1',size:bytes.length,state:'PROCESSING_ALLOWED',evidenceHash:'a'.repeat(64),region:'synthetic-region',revision:1});
      return {confirmedSynthetic:true,payloadId,payloadHash:artifactHash,expectedResultCode:'CLASSIFIED',expectedResultHash:resultHash};
    },timeoutMs:5000,maxAgeMs:30000}});
  supervisors.push(managed);
  await t.test('V125 six-pool managed root verifies a synthetic full submit/relay/load/process/adopt canary',async()=>{
    try{assert.equal((await managed.canary.probe()).ok,false);await managed.start();assert.equal((await managed.canary.run()).ok,true);assert.equal((await managed.canary.probe()).ok,true);
    const probes=Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,async()=>({ok:true})]));const readiness=managed.createReadiness({probes,probeTimeoutMs:5000});
    // A canary receipt can precede completion of the worker's whole batch.
    // Readiness must remain closed until its first complete supervised cycle.
    const deadline=Date.now()+5000;let ready;
    do{readiness.invalidate();ready=await readiness.publicStatus();if(ready.status==='READY')break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
    assert.equal(ready.status,'READY',JSON.stringify({ready,pipeline:managed.status(),processing:await managed.probe()}));assert.equal((await managed.probe()).ok,true);
    }finally{assert.equal((await managed.stop()).drained,true);}assert.equal((await managed.canary.probe()).ok,false);
  });
  await t.test('V125 failed managed evidence or withdrawn canary authority cannot restore functional readiness',async()=>{
    await managed.start();evidenceAllowed=false;try{assert.equal((await managed.canary.run()).ok,false);assert.equal((await managed.canary.probe()).ok,false);}finally{evidenceAllowed=true;}
    assert.equal((await managed.canary.run()).ok,true);canaryAllowed=false;try{assert.equal((await managed.canary.probe()).ok,false);assert.equal((await managed.probe()).ok,false);}finally{canaryAllowed=true;}
    assert.equal((await managed.stop()).drained,true);
  });

  // HTTP identity/rate/audit and shared drain below are explicit synthetic
  // fixtures. Domain transactions, workers, receipts and adoption use real PG.
  const httpFixture={authProvider:{authenticate:async()=>({tenantId:tenantA,actorId:actorA,capabilities:['inbound:create'],authContext:{method:'OIDC',mfaVerified:false}})},
    abuseLimiter:{checkIp:async()=>{},checkTenant:async()=>{}},authorizeRequest:async()=>true,audit:async()=>{}};
  const withProcessingHttp=async run=>{
    const api=createProcessingHttp({...httpFixture,handlers:pipeline.handlers,drain:fixtureDrain().drain,readiness:syntheticReady()});
    await new Promise(resolve=>api.server.listen(0,'127.0.0.1',resolve));
    try{await run(`http://127.0.0.1:${api.server.address().port}`);}finally{await api.stop();api.server.closeAllConnections();await new Promise(resolve=>api.server.close(resolve));}
  };
  const httpCommand=()=>({commandId:uuid(),jobId:uuid(),eventId:uuid(),payloadId:uuid(),payloadHash:artifactHash,sourceSystem:'MANUAL_UPLOAD',externalEventId:`synthetic-http:${uuid()}`});
  const httpPost=(base,input)=>fetch(base+'/api/v1/processing/inbound',{method:'POST',headers:{'content-type':'application/json','idempotency-key':input.commandId},body:JSON.stringify(input)});
  await t.test('V126 actual HTTP command commits domain/outbox and replays with a stable server binding',async()=>{
    await withProcessingHttp(async base=>{const input=httpCommand();assert.equal((await httpPost(base,input)).status,202);const replay=await httpPost(base,input);assert.equal(replay.status,202);assert.equal((await replay.json()).replayed,true);
      const rows=await admin.query('SELECT actor_id,trace_hash FROM public.domain_job_commands WHERE tenant_id=$1 AND command_id=$2',[tenantA,input.commandId]);assert.equal(rows.rows.length,1);assert.equal(rows.rows[0].actor_id,actorA);assert.equal(rows.rows[0].trace_hash,crypto.createHash('sha256').update(`http-command:${input.commandId}`).digest('hex'));
    });
  });
  await t.test('V126 cross-tenant body injection never creates a PostgreSQL command',async()=>{
    await withProcessingHttp(async base=>{const input=httpCommand();assert.equal((await httpPost(base,{...input,tenantId:tenantB})).status,400);assert.equal((await admin.query('SELECT command_id FROM public.domain_job_commands WHERE command_id=$1',[input.commandId])).rows.length,0);});
  });
  await t.test('V126 changed immutable HTTP artifact binding conflicts and retains original PostgreSQL command',async()=>{
    await withProcessingHttp(async base=>{const input=httpCommand();assert.equal((await httpPost(base,input)).status,202);assert.equal((await httpPost(base,{...input,payloadHash:'c'.repeat(64)})).status,409);assert.equal((await admin.query('SELECT payload_hash FROM public.domain_job_commands WHERE command_id=$1',[input.commandId])).rows[0].payload_hash,artifactHash);});
  });
  await t.test('V126 actual PostgreSQL current actor withdrawal denies HTTP replay',async()=>{
    await withProcessingHttp(async base=>{const input=httpCommand();assert.equal((await httpPost(base,input)).status,202);await admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[actorA]);try{assert.equal((await httpPost(base,input)).status,404);}finally{await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[actorA]);}});
  });
  await t.test('V126 actual six-pool service schedules fresh canary and gates HTTP readiness before draining',async()=>{
    const {drain:domainDrain,...serviceDomain}=pipelineOptions,{drain:workerDrain,...serviceWorker}=managedWorker;
    const backend=fixtureDrain().backend;
    const root=createPostgresProcessingService({drain:{backend,authorize:async()=>true,deploymentId:'synthetic-ci-processing'},processing:{domain:serviceDomain,worker:serviceWorker,
      queueReaderPool,expectedQueueReaderRole:'legaltech_queue_reader_ci',authorizeResultRead:async()=>true,authorizeAdoption:async()=>true,
      artifacts:{manifest:{resolveVersion:async r=>manifests.get(r.id),probe:async()=>({ok:true})},storage:{readVersion:async r=>({tenantId:r.tenantId,objectKey:r.objectKey,versionId:r.versionId,hash:r.hash,contentLength:r.size,body:(async function*(){yield bytes;})()}),probe:async()=>({ok:true})},authorizeVersion:async()=>true,verifyEvidence:async()=>true},
      canary:{tenantId:tenantA,actorId:actorA,serviceActorId:serviceActor,authorizeCanary:async()=>true,createFixture:async()=>{const payloadId=uuid();manifests.set(payloadId,{tenantId:tenantA,id:payloadId,kind:'PAYLOAD',hash:artifactHash,objectKey:`${tenantA}/canary/${payloadId}`,versionId:'synthetic-v126',size:bytes.length,state:'PROCESSING_ALLOWED',evidenceHash:'a'.repeat(64),region:'synthetic-region',revision:1});return {confirmedSynthetic:true,payloadId,payloadHash:artifactHash,expectedResultCode:'CLASSIFIED',expectedResultHash:resultHash};},timeoutMs:5000,maxAgeMs:30000}},
      http:httpFixture,probes:Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,async()=>({ok:true})])),readiness:{probeTimeoutMs:5000},canaryIntervalMs:10000});
    let stopped;
    try{await root.start({port:0});const base=`http://127.0.0.1:${root.server.address().port}`;let response;const deadline=Date.now()+10000;
      do{response=await fetch(base+'/api/v1/ready');await response.arrayBuffer();if(response.status===200)break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<deadline);
      assert.equal(response.status,200);assert.equal((await root.readiness.publicStatus()).status,'READY');
      stopped=await root.stop({actorId:'synthetic-operator',reasonHash:'a'.repeat(64),timeoutMs:5000});assert.equal(stopped.drained,true);assert.equal(root.server.listening,false);assert.equal((await root.readiness.publicStatus()).status,'NOT_READY');
    }finally{if(!stopped?.drained){await root.stop({actorId:'synthetic-operator',reasonHash:'a'.repeat(64),timeoutMs:5000});root.server.closeAllConnections();}}
  });

  const drainDeployment='synthetic-ci-v127',drainOwner=uuid(),reason='a'.repeat(64);
  for(const [login,group] of [['legaltech_drain_worker_ci','legaltech_drain_worker'],['legaltech_drain_operator_ci','legaltech_drain_operator'],['legaltech_drain_reader_ci','legaltech_drain_reader']]){
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`GRANT ${group} TO ${login}`);
  }
  for(const [principal,access] of [['legaltech_drain_worker_ci','WORKLOAD'],['legaltech_drain_operator_ci','CONTROL'],['legaltech_drain_reader_ci','READ']])
    await admin.query('INSERT INTO drain_security.principal_scopes(deployment_id,principal,access) VALUES($1,$2::name,$3)',[drainDeployment,principal,access]);
  const drainWorkerPool=makePool('legaltech_drain_worker_ci'),drainOperatorPool=makePool('legaltech_drain_operator_ci'),drainReaderPool=makePool('legaltech_drain_reader_ci');
  const drainOptions={workerPool:drainWorkerPool,operatorPool:drainOperatorPool,readerPool:drainReaderPool,expectedWorkerRole:'legaltech_drain_worker_ci',
    expectedOperatorRole:'legaltech_drain_operator_ci',expectedReaderRole:'legaltech_drain_reader_ci',deploymentId:drainDeployment,ownerId:drainOwner,authorizeBackend:async()=>true,timeoutMs:5000};
  const durable=new PostgresDeploymentDrainBackend(drainOptions),otherDurable=new PostgresDeploymentDrainBackend({...drainOptions,
    workerPool:makePool('legaltech_drain_worker_ci'),operatorPool:makePool('legaltech_drain_operator_ci'),readerPool:makePool('legaltech_drain_reader_ci'),ownerId:uuid()});
  const operation=prefix=>`${prefix}:${uuid()}`,scope={deploymentId:drainDeployment};
  const beginDurable=()=>durable.begin({...scope,operationId:operation('begin'),actorId:'synthetic-operator',reasonHash:reason});
  const resumeDurable=async()=>{const prior=await durable.status(scope);return durable.resume({...scope,operationId:operation('resume'),actorId:'synthetic-operator',expectedGeneration:prior.generation});};
  const acquireDurable=(backend=durable,id=operation('lease'),kind='BACKGROUND')=>backend.acquire({...scope,operationId:id,kind});
  const releaseDurable=(backend,id,lease)=>backend.release({...scope,operationId:id,lease});
  await t.test('V127 scope-provisioned initialization is durable replay-safe and starts globally closed',async()=>{
    const input={operationId:operation('init'),actorId:'synthetic-operator'};const value=await durable.initialize(input);
    assert.deepEqual(value,{state:'DRAINED',generation:1,inFlight:0,acceptingNew:false});assert.deepEqual(await durable.initialize(input),value);
    await assert.rejects(durable.initialize({...input,operationId:operation('init')}),/UNVERIFIED/);assert.equal((await durable.probe()).ok,true);await resumeDurable();
  });
  await t.test('V127 independent connections share persistent leases and closed generations wait for every owner',async()=>{
    const first=operation('first'),second=operation('second'),a=await acquireDurable(durable,first),b=await acquireDurable(otherDurable,second);
    const closing=await beginDurable();assert.equal(closing.state,'DRAINING');assert.equal(closing.inFlight,2);
    await assert.rejects(resumeDurable(),/UNVERIFIED/);await releaseDurable(durable,first,a);assert.equal((await otherDurable.status(scope)).state,'DRAINING');
    await releaseDurable(otherDurable,second,b);assert.equal((await durable.status(scope)).state,'DRAINED');const resumed=await resumeDurable();assert.equal(resumed.generation,closing.generation+1);
  });
  await t.test('V127 immutable acquisition replay keeps original token and rejects changed kind or owner',async()=>{
    const id=operation('immutable'),a=await acquireDurable(durable,id);try{
      assert.deepEqual(await acquireDurable(durable,id),a);await assert.rejects(acquireDurable(durable,id,'INGRESS'),/UNVERIFIED/);await assert.rejects(acquireDurable(otherDurable,id),/UNVERIFIED/);
      assert.equal((await admin.query("SELECT count(*)::integer AS n FROM drain_security.events WHERE deployment_id=$1 AND operation_id=$2 AND action='ACQUIRE'",[drainDeployment,id])).rows[0].n,1);
    }finally{await releaseDurable(durable,id,a);}await assert.rejects(acquireDurable(durable,id),/UNVERIFIED/);
  });
  await t.test('V127 token and attempt-generation forgery cannot release another owner or clear a lease',async()=>{
    const id=operation('forged'),a=await acquireDurable(durable,id);try{
      for(const lease of [{...a,token:'b'.repeat(64)},{...a,generation:a.generation+1}])await assert.rejects(releaseDurable(durable,id,lease),/UNVERIFIED/);
      await assert.rejects(releaseDurable(otherDurable,id,a),/UNVERIFIED/);assert.equal((await durable.status(scope)).inFlight,1);
    }finally{await releaseDurable(durable,id,a);}assert.deepEqual(await releaseDurable(durable,id,a),{released:true,...a});
  });
  await t.test('V127 begin refuses new acquisition and stale generation cannot resume',async()=>{
    const closed=await beginDurable();await assert.rejects(acquireDurable(),/UNVERIFIED/);
    await assert.rejects(durable.resume({...scope,operationId:operation('stale'),actorId:'synthetic-operator',expectedGeneration:closed.generation-1}),/UNVERIFIED/);await resumeDurable();
  });
  await t.test('V127 acquire and begin serialize atomically under cross-connection concurrency',async()=>{
    const id=operation('racing');const [acquisition]=await Promise.allSettled([acquireDurable(otherDurable,id),beginDurable()]);
    const state=await durable.status(scope);assert.equal(state.acceptingNew,false);assert.equal(state.inFlight,acquisition.status==='fulfilled'?1:0);
    assert.equal(state.state,acquisition.status==='fulfilled'?'DRAINING':'DRAINED');if(acquisition.status==='fulfilled')await releaseDurable(otherDurable,id,acquisition.value);await resumeDurable();
  });
  await t.test('V127 authoritative absence is sealed so a delayed acquisition cannot later commit',async()=>{
    const id=operation('late');let allow;const gate=new Promise(r=>{allow=r});const late=gate.then(()=>acquireDurable(durable,id));
    assert.deepEqual(await durable.lookupOperation({...scope,operationId:id}),{state:'ABSENT',lease:null});allow();await assert.rejects(late,/UNVERIFIED/);assert.equal((await durable.status(scope)).inFlight,0);
    assert.deepEqual(await durable.lookupOperation({...scope,operationId:id}),{state:'ABSENT',lease:null});
  });
  await t.test('V127 connection/process loss never expires leases and reconstruction requires original owner',async()=>{
    const workerPool=makePool('legaltech_drain_worker_ci'),ownerId=uuid(),crashed=new PostgresDeploymentDrainBackend({...drainOptions,workerPool,ownerId}),id=operation('crash');
    const value=await acquireDurable(crashed,id);pools.splice(pools.indexOf(workerPool),1);await workerPool.end();await beginDurable();
    assert.equal((await durable.status(scope)).state,'DRAINING');await assert.rejects(otherDurable.lookupOperation({...scope,operationId:id}),/UNVERIFIED/);
    const recovered=new PostgresDeploymentDrainBackend({...drainOptions,ownerId});assert.deepEqual(await recovered.lookupOperation({...scope,operationId:id}),{state:'HELD',lease:value});
    assert.equal((await durable.status(scope)).inFlight,1);await releaseDurable(recovered,id,value);await resumeDurable();
  });
  await t.test('V127 lost acquisition acknowledgement stays unready until exact durable reconciliation',async()=>{
    const id=operation('lost-acquire'),backend={acquire:async input=>{await durable.acquire(input);throw new Error('synthetic-lost-reply');},release:durable.release.bind(durable),
      status:durable.status.bind(durable),begin:durable.begin.bind(durable),resume:durable.resume.bind(durable),lookupOperation:durable.lookupOperation.bind(durable)};
    const drain=new ManagedDeploymentDrain({backend,authorize:async()=>true,deploymentId:drainDeployment});await assert.rejects(drain.acquire({operationId:id,kind:'INGRESS'}),/UNVERIFIED/);
    assert.equal((await drain.probe()).ok,false);assert.equal((await durable.status(scope)).inFlight,1);await drain.reconcile({operationId:id});assert.equal((await drain.probe()).ok,true);
  });
  await t.test('V127 lost release acknowledgement reconciles immutable RELEASED proof without duplicate events',async()=>{
    const id=operation('lost-release'),backend={acquire:durable.acquire.bind(durable),release:async input=>{await durable.release(input);throw new Error('synthetic-lost-release');},
      status:durable.status.bind(durable),begin:durable.begin.bind(durable),resume:durable.resume.bind(durable),lookupOperation:durable.lookupOperation.bind(durable)};
    const drain=new ManagedDeploymentDrain({backend,authorize:async()=>true,deploymentId:drainDeployment}),value=await drain.acquire({operationId:id,kind:'BACKGROUND'});
    await assert.rejects(drain.release(value),/UNVERIFIED/);assert.equal((await drain.probe()).ok,false);await drain.reconcile({operationId:id});assert.equal((await drain.probe()).ok,true);
    assert.equal((await admin.query("SELECT count(*)::integer AS n FROM drain_security.events WHERE deployment_id=$1 AND operation_id=$2 AND action='RELEASE'",[drainDeployment,id])).rows[0].n,1);
  });
  await t.test('V127 current deployment scope revocation denies workload mutation without forgetting held effects',async()=>{
    const id=operation('scope-revoked'),value=await acquireDurable(durable,id);await admin.query("UPDATE drain_security.principal_scopes SET active=false WHERE deployment_id=$1 AND principal='legaltech_drain_worker_ci'",[drainDeployment]);
    try{await assert.rejects(acquireDurable(),/UNVERIFIED/);await assert.rejects(releaseDurable(durable,id,value),/UNVERIFIED/);assert.equal((await durable.status(scope)).inFlight,1);}
    finally{await admin.query("UPDATE drain_security.principal_scopes SET active=true WHERE deployment_id=$1 AND principal='legaltech_drain_worker_ci'",[drainDeployment]);await releaseDurable(durable,id,value);}
  });
  await t.test('V127 scope revoked during deployment-lock wait cannot authorize a queued mutation',async()=>{
    const blocker=await admin.connect(),id=operation('queued-revocation');let pending;
    try{await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM drain_security.deployments WHERE deployment_id=$1 FOR UPDATE',[drainDeployment]);
      pending=acquireDurable(durable,id).then(value=>({value}),error=>({error}));
      let waiting=false;const deadline=Date.now()+3000;
      while(Date.now()<deadline){waiting=(await admin.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename='legaltech_drain_worker_ci' AND wait_event_type='Lock' AND query LIKE '%drain_security.operate%') AS waiting")).rows[0].waiting;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
      assert.equal(waiting,true);
      await blocker.query("UPDATE drain_security.principal_scopes SET active=false WHERE deployment_id=$1 AND principal='legaltech_drain_worker_ci'",[drainDeployment]);await blocker.query('COMMIT');
      const outcome=await pending;assert.match(outcome.error?.message??'',/UNVERIFIED/);
      assert.equal((await admin.query('SELECT count(*)::integer AS n FROM drain_security.leases WHERE deployment_id=$1 AND operation_id=$2',[drainDeployment,id])).rows[0].n,0);
    }finally{await blocker.query('ROLLBACK');blocker.release();
      await admin.query("UPDATE drain_security.principal_scopes SET active=true WHERE deployment_id=$1 AND principal='legaltech_drain_worker_ci'",[drainDeployment]);
      if(pending){const outcome=await pending;if(outcome.value)await releaseDurable(durable,id,outcome.value);}
    }
  });
  await t.test('V127 current operator and reader scope revocations deny control and readiness',async()=>{
    for(const principal of ['legaltech_drain_operator_ci','legaltech_drain_reader_ci']){
      await admin.query('UPDATE drain_security.principal_scopes SET active=false WHERE deployment_id=$1 AND principal=$2::name',[drainDeployment,principal]);
      try{if(principal==='legaltech_drain_operator_ci')await assert.rejects(beginDurable(),/UNVERIFIED/);else assert.equal((await durable.probe()).ok,false);}
      finally{await admin.query('UPDATE drain_security.principal_scopes SET active=true WHERE deployment_id=$1 AND principal=$2::name',[drainDeployment,principal]);}
    }
  });
  await t.test('V127 unprovisioned deployment bindings cannot initialize or read another deployment',async()=>{
    const other=new PostgresDeploymentDrainBackend({...drainOptions,deploymentId:'synthetic-ci-v127-other'});await assert.rejects(other.initialize({operationId:operation('other-init'),actorId:'operator'}),/UNVERIFIED/);assert.equal((await other.probe()).ok,false);
  });
  await t.test('V127 direct SQL cannot bypass worker/operator/reader capability separation',async()=>{
    for(const [pool,action,input] of [[drainWorkerPool,'BEGIN',{operationId:operation('bypass'),actorId:'operator',reasonHash:reason}],
      [drainOperatorPool,'ACQUIRE',{operationId:operation('bypass'),ownerId:drainOwner,kind:'BACKGROUND',token:reason}],
      [drainReaderPool,'RESUME',{operationId:operation('bypass'),actorId:'operator',expectedGeneration:1}]]){
      await assert.rejects(pool.query('SELECT drain_security.operate($1,$2,$3::jsonb)',[drainDeployment,action,JSON.stringify(input)]),/DRAIN_SCOPE_FORBIDDEN/);
    }
  });
  await t.test('V127 application and control principals cannot select or mutate private drain ledgers',async()=>{
    for(const pool of [runtime,brokerOne,queueWorkerPool,queueReaderPool,relayPool,domainReaderPool,drainWorkerPool,drainOperatorPool,drainReaderPool])
      for(const table of ['deployments','leases','controls','events','principal_scopes'])assert.equal(await pool.query(`SELECT * FROM drain_security.${table}`).then(()=>false,e=>e.code==='42501'),true);
    for(const sql of ['DELETE FROM drain_security.leases','TRUNCATE drain_security.events','UPDATE drain_security.principal_scopes SET active=true'])assert.equal(await drainOperatorPool.query(sql).then(()=>false,e=>e.code==='42501'),true);
  });
  await t.test('V127 mixed roles or foreign data grants cannot pass backend posture',async()=>{
    await admin.query('GRANT legaltech_drain_operator TO legaltech_drain_worker_ci');try{await assert.rejects(acquireDurable(),/UNVERIFIED/);}finally{await admin.query('REVOKE legaltech_drain_operator FROM legaltech_drain_worker_ci');}
    await admin.query('GRANT SELECT ON public.matters TO legaltech_drain_reader_ci');try{assert.equal((await durable.probe()).ok,false);}finally{await admin.query('REVOKE SELECT ON public.matters FROM legaltech_drain_reader_ci');}
  });
  await t.test('V127 PUBLIC function access or altered security-definer posture closes readiness',async()=>{
    await admin.query('GRANT EXECUTE ON FUNCTION drain_security.operate(text,text,jsonb) TO PUBLIC');try{assert.equal((await durable.probe()).ok,false);}finally{await admin.query('REVOKE EXECUTE ON FUNCTION drain_security.operate(text,text,jsonb) FROM PUBLIC');}
    await admin.query('ALTER FUNCTION drain_security.operate(text,text,jsonb) SECURITY INVOKER');try{assert.equal((await durable.probe()).ok,false);}finally{await admin.query('ALTER FUNCTION drain_security.operate(text,text,jsonb) SECURITY DEFINER');}
  });
  await t.test('V127 altered function body hash cannot silently change drain semantics',async()=>{
    const definition=(await admin.query("SELECT pg_get_functiondef('drain_security.operate(text,text,jsonb)'::regprocedure) AS sql")).rows[0].sql;
    const modified=definition.replace('AS $function$','AS $function$\n-- synthetic catalog tamper\n');assert.notEqual(modified,definition);
    await admin.query(modified);try{assert.equal((await durable.probe()).ok,false);}finally{await admin.query(definition);}
  });
  await t.test('V127 disabled forced RLS or changed owner policy cannot attest a healthy backend',async()=>{
    await admin.query('ALTER TABLE drain_security.leases NO FORCE ROW LEVEL SECURITY');try{assert.equal((await durable.probe()).ok,false);}finally{await admin.query('ALTER TABLE drain_security.leases FORCE ROW LEVEL SECURITY');}
    await admin.query('ALTER POLICY owner_only ON drain_security.leases USING(false)');try{assert.equal((await durable.probe()).ok,false);}finally{await admin.query('ALTER POLICY owner_only ON drain_security.leases USING(true)');}
  });
  await t.test('V127 domain and session admission refuse direct drain API grants without role membership',async()=>{
    for(const [principal,check] of [['legaltech_runtime_ci',async()=>assert.equal((await createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})()).ok,false)],
      ['legaltech_broker_ci',async()=>assert.equal((await one.probe()).ok,false)]]){
      await admin.query(`GRANT USAGE ON SCHEMA drain_security TO ${principal}`);await admin.query(`GRANT EXECUTE ON FUNCTION drain_security.operate(text,text,jsonb) TO ${principal}`);
      try{await check();}finally{await admin.query(`REVOKE EXECUTE ON FUNCTION drain_security.operate(text,text,jsonb) FROM ${principal}`);await admin.query(`REVOKE USAGE ON SCHEMA drain_security FROM ${principal}`);}
    }
  });
  await t.test('V127 nine-pool service uses real durable drain for canary readiness and global shutdown',async serviceTest=>{
    const {drain:unusedDomainDrain,...serviceDomain}=pipelineOptions,{drain:unusedWorkerDrain,...serviceWorker}=managedWorker;
    const root=createCapacityBoundService({drain:{...drainOptions,ownerId:uuid(),authorize:async()=>true},processing:{domain:serviceDomain,worker:serviceWorker,
      queueReaderPool,expectedQueueReaderRole:'legaltech_queue_reader_ci',authorizeResultRead:async()=>true,authorizeAdoption:async()=>true,
      artifacts:{manifest:{resolveVersion:async r=>manifests.get(r.id),probe:async()=>({ok:true})},storage:{readVersion:async r=>({tenantId:r.tenantId,objectKey:r.objectKey,versionId:r.versionId,hash:r.hash,contentLength:r.size,body:(async function*(){yield bytes;})()}),probe:async()=>({ok:true})},authorizeVersion:async()=>true,verifyEvidence:async()=>true},
      canary:{tenantId:tenantA,actorId:actorA,serviceActorId:serviceActor,authorizeCanary:async()=>true,createFixture:async()=>{const payloadId=uuid();manifests.set(payloadId,{tenantId:tenantA,id:payloadId,kind:'PAYLOAD',hash:artifactHash,objectKey:`${tenantA}/canary/${payloadId}`,versionId:'synthetic-v127',size:bytes.length,state:'PROCESSING_ALLOWED',evidenceHash:reason,region:'synthetic-region',revision:1});return {confirmedSynthetic:true,payloadId,payloadHash:artifactHash,expectedResultCode:'CLASSIFIED',expectedResultHash:resultHash};},timeoutMs:5000,maxAgeMs:30000}},
      http:httpFixture,probes:Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,async()=>({ok:true})])),readiness:{probeTimeoutMs:5000},canaryIntervalMs:10000});
    let stopped;
    try{await root.start({port:0});const base=`http://127.0.0.1:${root.server.address().port}`;let response;const deadline=Date.now()+10000;
      do{response=await fetch(base+'/api/v1/ready');await response.arrayBuffer();if(response.status===200)break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<deadline);
      assert.equal(response.status,200);
      await serviceTest.test('V137 actual durable service rejects pool drift in ready and restart',async()=>{
        const before=queueReaderPool.options.max;queueReaderPool.options.max=before+1;
        try{
          assert.equal(root.deploymentCapacity.status().healthy,false);
          let unhealthy;const until=Date.now()+3000;
          do{unhealthy=await fetch(base+'/api/v1/ready');await unhealthy.arrayBuffer();if(unhealthy.status===503)break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<until);
          assert.equal(unhealthy.status,503);await assert.rejects(root.start({port:0}),/DEPLOYMENT_CAPACITY_UNVERIFIED/);
        }finally{queueReaderPool.options.max=before;}
        assert.equal(root.deploymentCapacity.status().uncertain,true);
      });
      assert.equal(root.deploymentCapacity.status().poolCount,9);assert.equal(root.deploymentCapacity.status().healthy,false);stopped=await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});assert.equal(stopped.drained,true);
      const global=await durable.status(scope);assert.equal(global.state,'DRAINED');assert.equal(global.inFlight,0);assert.equal(root.server.listening,false);
    }finally{if(!stopped?.drained){await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});root.server.closeAllConnections();}}
  });

  function containedArtifacts(input,{cleanup,authorizeVersion=async()=>true,readTimeoutMs=10000}={}){
    const manifest={tenantId:tenantA,id:input.payloadId,kind:'PAYLOAD',hash:artifactHash,objectKey:`${tenantA}/v128/${input.payloadId}`,versionId:'immutable-v128',size:bytes.length,state:'PROCESSING_ALLOWED',evidenceHash:reason,region:'synthetic-region',revision:1};
    return new ManagedWorkerArtifacts({manifest:{resolveVersion:async()=>({...manifest}),probe:async()=>({ok:true})},storage:{probe:async()=>({ok:true}),readVersion:async m=>{let sent=false;return {tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,body:{[Symbol.asyncIterator]:()=>({next:async()=>sent?{done:true}:(sent=true,{done:false,value:bytes}),return:async()=>{await cleanup?.();return {done:true};}})}};}},authorizeVersion,verifyEvidence:async()=>true,maxConcurrentReads:1,readTimeoutMs});
  }
  await t.test('V128 cleanup-time permission revocation cannot execute or commit a PostgreSQL job result',async()=>{
    const input=await createInbound();let allowed=true,executions=0;const provider=containedArtifacts(input,{cleanup:async()=>{allowed=false;},authorizeVersion:async()=>allowed});
    const worker=createPostgresWorkerPipeline({...workerOptions,loadPayload:provider.loadPayload.bind(provider),processInbound:async()=>{executions++;return {resultCode:'CLASSIFIED',resultHash};}});
    const outcome=await worker.runtime.processNext({tenantId:tenantA,serviceActorId:serviceActor,kind:'PROCESS_INBOUND'});assert.equal(outcome.status,'FAILED');assert.equal(executions,0);
    assert.equal(await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}),null);assert.equal((await queueReader.get({tenantId:tenantA,jobId:input.jobId})).status,'DEAD');
  });
  for(const failed of [false,true])await t.test(`V128 managed byte ownership is released after actual PostgreSQL ${failed?'failure':'completion'}`,async()=>{
    const input=await createInbound(),provider=containedArtifacts(input);let artifact;
    const worker=createPostgresWorkerPipeline({...workerOptions,loadPayload:async r=>(artifact=await provider.loadPayload(r)),processInbound:async()=>{if(failed)throw new Error('synthetic-processor-failure');return {resultCode:'CLASSIFIED',resultHash};}});
    const outcome=await worker.runtime.processNext({tenantId:tenantA,serviceActorId:serviceActor,kind:'PROCESS_INBOUND'});assert.equal(outcome.status,failed?'FAILED':'SUCCEEDED');assert.ok(artifact.bytes.every(b=>b===0));
    assert.equal((await queueReader.get({tenantId:tenantA,jobId:input.jobId})).status,failed?'DEAD':'SUCCEEDED');assert.equal((await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}))?.commandId??null,failed?null:input.commandId);
  });
  await t.test('V128 stalled artifact cleanup retains the PostgreSQL deployment lease beyond cancellation',async()=>{
    await resumeDurable();const input=await createInbound();let finish,entered=false;const gate=new Promise(r=>{finish=r}),provider=containedArtifacts(input,{cleanup:async()=>{entered=true;await gate;}});
    const drain=new ManagedDeploymentDrain({backend:durable,authorize:async()=>true,deploymentId:drainDeployment});
    const worker=createPostgresWorkerPipeline({...workerOptions,drain,loadPayload:provider.loadPayload.bind(provider)});supervisors.push(worker.supervisor);
    try{worker.supervisor.start();const deadline=Date.now()+5000;while(!entered&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(entered,true);
      assert.equal((await worker.supervisor.stop({timeoutMs:50})).drained,false);assert.equal((await provider.probe()).ok,false);
      const closing=await beginDurable();assert.equal(closing.state,'DRAINING');assert.equal(closing.inFlight,1);await assert.rejects(resumeDurable(),/UNVERIFIED/);
      assert.equal(await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}),null);finish();const end=Date.now()+5000;let status;
      do{status=await durable.status(scope);if(status.state==='DRAINED')break;await new Promise(r=>setTimeout(r,10));}while(Date.now()<end);
      assert.equal(status.state,'DRAINED');assert.equal(status.inFlight,0);assert.equal(await queueReader.getResult({tenantId:tenantA,jobId:input.jobId}),null);assert.equal((await provider.probe()).ok,true);
    }finally{finish();await worker.supervisor.stop({timeoutMs:5000});}
  });

  await resumeDurable();
  const ingressNamespace=uuid(),approvedSources=new Map();
  function approvedUpload(uploadId=uuid()){
    const payloadId=uuid(),binding={tenantId:tenantA,actorId:actorA,sourceKey:uploadId,payloadId,payloadHash:artifactHash,versionId:'immutable-v129',evidenceHash:reason,revision:1,state:'PROCESSING_ALLOWED'};
    approvedSources.set(uploadId,binding);manifests.set(payloadId,{tenantId:tenantA,id:payloadId,kind:'PAYLOAD',hash:artifactHash,objectKey:`${tenantA}/v129/${payloadId}`,versionId:binding.versionId,size:bytes.length,state:'PROCESSING_ALLOWED',evidenceHash:reason,region:'synthetic-region',revision:1});
    return {tenantId:tenantA,actorId:actorA,uploadId};
  }
  const ingressOptions={namespace:ingressNamespace,resolveUpload:async r=>({...approvedSources.get(r.uploadId)}),resolveGraph:async r=>({...approvedSources.get(r.notificationFingerprint)}),resolvePolicy:async r=>({...approvedSources.get(r.requestId)}),
    authorizeIngress:async()=>true,verifySourceEvidence:async()=>true,audit:async()=>{},probeSources:async()=>({ok:true})};
  const actualIngress=()=>new ManagedProcessingIngress({...ingressOptions,handlers:pipeline.handlers,drain:new ManagedDeploymentDrain({backend:durable,authorize:async()=>true,deploymentId:drainDeployment}),readiness:syntheticReady()});
  let ingressReplayInput,ingressReplayReceipt;
  await t.test('V129 approved upload commits exactly one immutable PostgreSQL command and replays across router reconstruction',async()=>{
    ingressReplayInput=approvedUpload();ingressReplayReceipt=await actualIngress().submitUpload(ingressReplayInput);
    const replay=await actualIngress().submitUpload(ingressReplayInput);assert.equal(replay.replayed,true);assert.equal(replay.commandId,ingressReplayReceipt.commandId);assert.equal(replay.jobId,ingressReplayReceipt.jobId);
    const row=(await admin.query('SELECT * FROM public.domain_job_commands WHERE command_id=$1',[replay.commandId])).rows[0];assert.equal(row.actor_id,actorA);assert.equal(row.payload_hash,artifactHash);
    assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.domain_outbox_events WHERE job_id=$1',[replay.jobId])).rows[0].n,1);
  });
  await t.test('V129 changed approved artifact on an ingress retry conflicts without overwriting the durable command',async()=>{
    const prior=approvedSources.get(ingressReplayInput.uploadId);approvedSources.set(ingressReplayInput.uploadId,{...prior,payloadHash:'d'.repeat(64)});
    try{await assert.rejects(actualIngress().submitUpload(ingressReplayInput),/CONFLICT/);assert.equal((await admin.query('SELECT payload_hash FROM public.domain_job_commands WHERE command_id=$1',[ingressReplayReceipt.commandId])).rows[0].payload_hash,artifactHash);}
    finally{approvedSources.set(ingressReplayInput.uploadId,prior);}
  });
  await t.test('V129 actor withdrawal blocks approved upload replay through actual PostgreSQL authorization',async()=>{
    await admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[actorA]);try{await assert.rejects(actualIngress().submitUpload(ingressReplayInput),/FORBIDDEN/);}
    finally{await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[actorA]);}
  });
  await t.test('V129 validated Graph fingerprint derives the registered service actor and a durable replay binding',async()=>{
    const base=approvedUpload(),notificationFingerprint=crypto.createHash('sha256').update(uuid()).digest('hex'),subscriptionId=uuid();
    const graphBinding={...approvedSources.get(base.uploadId),actorId:serviceActor,sourceKey:notificationFingerprint,subscriptionId,changeType:'created'};approvedSources.set(notificationFingerprint,graphBinding);
    const input={subscriptionId,notificationFingerprint},first=await actualIngress().dispatchGraph(input),replay=await actualIngress().dispatchGraph(input);assert.equal(replay.replayed,true);assert.equal(first.commandId,replay.commandId);
    const row=(await admin.query('SELECT actor_id,kind FROM public.domain_job_commands WHERE command_id=$1',[first.commandId])).rows[0];assert.equal(row.actor_id,serviceActor);assert.equal(row.kind,'PROCESS_INBOUND');
    assert.equal((await admin.query('SELECT source_system FROM public.inbound_events WHERE id=$1',[first.objectId])).rows[0].source_system,'MICROSOFT_GRAPH');
  });
  await t.test('V129 a cross-tenant registered Graph actor cannot commit another tenant command',async()=>{
    const base=approvedUpload(),notificationFingerprint=crypto.createHash('sha256').update(uuid()).digest('hex'),subscriptionId=uuid();
    approvedSources.set(notificationFingerprint,{...approvedSources.get(base.uploadId),tenantId:tenantB,actorId:serviceActor,sourceKey:notificationFingerprint,subscriptionId,changeType:'created'});
    const before=(await admin.query('SELECT count(*)::integer AS n FROM public.domain_job_commands')).rows[0].n;
    await assert.rejects(actualIngress().dispatchGraph({subscriptionId,notificationFingerprint}),/FORBIDDEN/);assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.domain_job_commands')).rows[0].n,before);
  });
  await t.test('V129 approved published policy produces one matter-bound PostgreSQL command on replay',async()=>{
    const matterId=uuid(),requestId=uuid(),policyVersionId=uuid();await admin.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[matterId,tenantA,`synthetic-v129-${matterId}`]);
    const record={tenantId:tenantA,actorId:actorA,sourceKey:requestId,matterId,policyVersionId,policyVersionHash:artifactHash,versionId:'published-v129',evidenceHash:reason,revision:1,state:'PUBLISHED'};approvedSources.set(requestId,record);
    manifests.set(policyVersionId,{tenantId:tenantA,id:policyVersionId,kind:'POLICY',hash:artifactHash,objectKey:`${tenantA}/v129/${policyVersionId}`,versionId:record.versionId,size:bytes.length,state:'PUBLISHED',evidenceHash:reason,region:'synthetic-region',revision:1});
    const input={tenantId:tenantA,actorId:actorA,matterId,requestId},first=await actualIngress().submitPolicy(input),replay=await actualIngress().submitPolicy(input);assert.equal(replay.replayed,true);assert.equal(first.commandId,replay.commandId);
    const row=(await admin.query('SELECT matter_id,policy_version_id FROM public.domain_job_commands WHERE command_id=$1',[first.commandId])).rows[0];assert.equal(row.matter_id,matterId);assert.equal(row.policy_version_id,policyVersionId);
  });
  await t.test('V129 production legacy upload endpoint commits PostgreSQL through the registered bridge and never synthetic ingest',async()=>{
    const input=approvedUpload();let synthetic=0;const server=createApiServer({productionMode:true,processingIngress:actualIngress(),readiness:syntheticReady(),platform:{store:{audit:async()=>{}},ingest:()=>{synthetic++;throw new Error('synthetic-route-forbidden');}},authProvider:httpFixture.authProvider,abuseLimiter:{...httpFixture.abuseLimiter,checkRead:async()=>{}}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const base=`http://127.0.0.1:${server.address().port}`,send=()=>fetch(base+'/api/v1/inbound-events',{method:'POST',headers:{'content-type':'application/json','idempotency-key':input.uploadId},body:JSON.stringify({uploadId:input.uploadId})});
      const response=await send();assert.equal(response.status,202);const first=await response.json(),again=await send();assert.equal(again.status,202);assert.equal((await again.json()).replayed,true);assert.equal(synthetic,0);
      assert.equal((await admin.query('SELECT payload_hash FROM public.domain_job_commands WHERE command_id=$1',[first.commandId])).rows[0].payload_hash,artifactHash);
    }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
  });
  await t.test('V129 stalled source resolution keeps the PostgreSQL drain closed until actual provider settlement',async()=>{
    const input=approvedUpload();let finish,entered=false,sourceSignal;const gate=new Promise(r=>{finish=r});const router=new ManagedProcessingIngress({...ingressOptions,handlers:pipeline.handlers,drain:new ManagedDeploymentDrain({backend:durable,authorize:async()=>true,deploymentId:drainDeployment}),readiness:syntheticReady(),timeoutMs:100,maxPending:1,
      resolveUpload:async r=>{entered=true;sourceSignal=r.signal;await gate;return {...approvedSources.get(r.uploadId)};}});let settled=false;const task=router.submitUpload(input).catch(e=>{settled=true;return e;});
    try{const deadline=Date.now()+5000;while(!sourceSignal?.aborted&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(entered,true);assert.equal(sourceSignal.aborted,true);assert.equal(settled,false);
      assert.equal((await beginDurable()).state,'DRAINING');assert.equal((await durable.status(scope)).inFlight,1);await assert.rejects(resumeDurable(),/UNVERIFIED/);assert.equal((await router.probe()).ok,false);
      finish();assert.match((await task).message,/UNAVAILABLE/);assert.equal((await durable.status(scope)).state,'DRAINED');
    }finally{finish();await task;await resumeDurable();}
  });

  await t.test('V129 validated Graph queue retries a lost postcommit acknowledgement without suppressing durable replay',async()=>{
    const subscriptionId=uuid(),directoryTenantId=uuid(),expiresAt=new Date(Date.now()+3600000).toISOString();
    const webhook=new GraphWebhookIngress({resolveSubscription:async()=>({tenantId:tenantA,subscriptionId,directoryTenantId,clientState:'synthetic-v129-client-state',status:'ACTIVE',expiresAt,richData:false})});
    const payload={value:[{id:uuid(),subscriptionId,tenantId:directoryTenantId,clientState:'synthetic-v129-client-state',resource:'/users/synthetic/messages/synthetic-v129',changeType:'created',subscriptionExpirationDateTime:expiresAt}]};
    const staged=webhook.receive(payload,{traceId:'synthetic-v129-validation'}),[validated]=await webhook.validate(staged.intakeId),base=approvedUpload();
    approvedSources.set(validated.notificationFingerprint,{...approvedSources.get(base.uploadId),actorId:serviceActor,sourceKey:validated.notificationFingerprint,subscriptionId,changeType:'created'});
    let lost=true;const router=new ManagedProcessingIngress({...ingressOptions,handlers:pipeline.handlers,drain:new ManagedDeploymentDrain({backend:durable,authorize:async()=>true,deploymentId:drainDeployment}),readiness:syntheticReady(),audit:async c=>{if(c.phase==='ACCEPTED'&&lost){lost=false;throw new Error('synthetic-lost-acknowledgement');}}});
    const queue=new GraphWebhookValidationQueue({ingress:webhook,dispatch:createGraphProcessingDispatch(router)}),intake=queue.receive(payload,{traceId:'synthetic-v129-dispatch'});
    assert.equal((await queue.processNext({intakeId:intake.intakeId})).status,'QUEUED');const replay=await queue.processNext({intakeId:intake.intakeId});assert.equal(replay.status,'DONE');assert.equal(replay.duplicateCount,1);
    const sourceHash=crypto.createHash('sha256').update(JSON.stringify(['ingress-source-v129','MICROSOFT_GRAPH',JSON.stringify([subscriptionId,validated.notificationFingerprint])])).digest('hex');
    const row=(await admin.query('SELECT id FROM public.inbound_events WHERE tenant_id=$1 AND external_event_id=$2',[tenantA,crypto.createHash('sha256').update(sourceHash).digest('hex')])).rows;
    assert.equal(row.length,1);assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.domain_job_commands WHERE object_id=$1',[row[0].id])).rows[0].n,1);
  });
  await t.test('V129 nine-pool service binds source readiness ingress workers and durable global shutdown',async()=>{
    const {drain:unusedDomain,...serviceDomain}=pipelineOptions,{drain:unusedWorker,...serviceWorker}=managedWorker;let sourceHealthy=true;
    const options={drain:{...drainOptions,ownerId:uuid(),authorize:async()=>true},ingress:{...ingressOptions,probeSources:async()=>({ok:sourceHealthy})},processing:{domain:serviceDomain,worker:serviceWorker,
      queueReaderPool,expectedQueueReaderRole:'legaltech_queue_reader_ci',authorizeResultRead:async()=>true,authorizeAdoption:async()=>true,
      artifacts:{manifest:{resolveVersion:async r=>manifests.get(r.id),probe:async()=>({ok:true})},storage:{readVersion:async r=>({tenantId:r.tenantId,objectKey:r.objectKey,versionId:r.versionId,hash:r.hash,contentLength:r.size,body:(async function*(){yield bytes;})()}),probe:async()=>({ok:true})},authorizeVersion:async()=>true,verifyEvidence:async()=>true},
      canary:{tenantId:tenantA,actorId:actorA,serviceActorId:serviceActor,authorizeCanary:async()=>true,createFixture:async()=>{const fixture=approvedUpload(),m=approvedSources.get(fixture.uploadId);return {confirmedSynthetic:true,payloadId:m.payloadId,payloadHash:m.payloadHash,expectedResultCode:'CLASSIFIED',expectedResultHash:resultHash};},timeoutMs:5000,maxAgeMs:30000}},
      http:httpFixture,probes:Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,async()=>({ok:true})])),readiness:{probeTimeoutMs:5000},canaryIntervalMs:10000};
    for(const field of ['handlers','drain','readiness'])assert.throws(()=>createCapacityBoundService({...options,ingress:{...options.ingress,[field]:{}}}),/INGRESS_OVERRIDE_FORBIDDEN/);
    assert.throws(()=>createCapacityBoundService({...options,http:{...options.http,allowDirectCommands:true}}),/HTTP_OVERRIDE_FORBIDDEN/);
    const root=createCapacityBoundService(options);let stopped;
    try{await root.start({port:0});const base=`http://127.0.0.1:${root.server.address().port}`;
      const ready=async()=>{const deadline=Date.now()+10000;let response;do{response=await fetch(base+'/api/v1/ready');await response.arrayBuffer();if(response.status===200)return;await new Promise(r=>setTimeout(r,25));}while(Date.now()<deadline);assert.equal(response.status,200);};
      await ready();const bypass=await fetch(base+'/api/v1/processing/inbound',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(bypass.status,404);await bypass.arrayBuffer();
      sourceHealthy=false;root.readiness.invalidate();const unavailable=await fetch(base+'/api/v1/ready');assert.equal(unavailable.status,503);await unavailable.arrayBuffer();
      const input=approvedUpload();await assert.rejects(root.ingress.submitUpload(input),/UNAVAILABLE/);sourceHealthy=true;root.readiness.invalidate();await ready();
      const receipt=await root.ingress.submitUpload(input);const end=Date.now()+5000;let result;
      do{result=await queueReader.getResult({tenantId:tenantA,jobId:receipt.jobId});if(result)break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<end);
      assert.equal(result.commandId,receipt.commandId);assert.equal(result.resultCode,'CLASSIFIED');
      stopped=await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});assert.equal(stopped.drained,true);assert.equal((await durable.status(scope)).state,'DRAINED');assert.equal((await durable.status(scope)).inFlight,0);
    }finally{sourceHealthy=true;if(!stopped?.drained){await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});root.server.closeAllConnections();}}
  });

  const graphProducerPool=makePool('legaltech_graph_producer_ci',2),graphWorkerPool=makePool('legaltech_graph_worker_ci',2),graphReaderPool=makePool('legaltech_graph_reader_ci',2);
  const graphProducerOptions={pool:graphProducerPool,expectedRole:'legaltech_graph_producer_ci',actorId:serviceActor,authorizeEnqueue:async()=>true};
  const graphWorkerOptions={pool:graphWorkerPool,expectedRole:'legaltech_graph_worker_ci',actorId:serviceActor,workerId:uuid(),authorizeWorker:async()=>true};
  const graphReaderOptions={pool:graphReaderPool,expectedRole:'legaltech_graph_reader_ci',actorId:serviceActor,authorizeRead:async()=>true};
  const graphProducer=new PostgresGraphInboxProducer(graphProducerOptions),graphWorker=new PostgresGraphInboxWorker(graphWorkerOptions),graphReader=new PostgresGraphInboxReader(graphReaderOptions);
  const graphTenant=async()=>{const tenantId=uuid();await admin.query('INSERT INTO public.tenants(id,name) VALUES($1,$2)',[tenantId,'V132 isolated synthetic inbox scope']);return tenantId;};
  const graphRecord=tenantId=>({tenantId,subscriptionId:uuid(),notificationFingerprint:crypto.createHash('sha256').update(uuid()).digest('hex'),sourceEvidenceHash:reason,sourceVersionHash:artifactHash,eventType:'CREATED'});
  const graphKey=r=>({tenantId:r.tenantId,subscriptionId:r.subscriptionId,notificationFingerprint:r.notificationFingerprint});
  await t.test('V132 actual PostgreSQL graph roles verify exact column grants forced tenant RLS and pinned triggers',async()=>{
    const diagnostics=[];
    const diagnosticPool={connect:async()=>{const client=await graphProducerPool.connect();return {release:value=>client.release(value),query:async(sql,values)=>{try{const result=await client.query(sql,values);if(/AS member|AS grants_safe|FROM pg_roles|FROM pg_class|FROM pg_policies|FROM pg_proc|FROM pg_trigger/.test(sql))diagnostics.push({sql,rows:result.rows});return result;}catch(error){diagnostics.push({sql,code:error.code,message:error.message});throw error;}}};}};
    assert.equal((await new PostgresGraphInboxProducer({...graphProducerOptions,pool:diagnosticPool}).probe()).ok,true,JSON.stringify(diagnostics));
    for(const adapter of [graphWorker,graphReader])assert.equal((await adapter.probe()).ok,true);
    for(const pool of [graphProducerPool,graphWorkerPool,graphReaderPool])assert.equal((await pool.query('SELECT * FROM graph_security.notifications')).rows.length,0);
    for(const pool of [runtime,brokerOne,queueProducerPool,queueWorkerPool,queueReaderPool,relayPool,domainReaderPool,drainWorkerPool,drainOperatorPool,drainReaderPool])assert.equal(await pool.query('SELECT * FROM graph_security.notifications').then(()=>false,e=>e.code==='42501'),true);
  });
  await t.test('V132 concurrent enqueue and reconstructed producer retain one exact immutable inbox row',async()=>{
    const input=graphRecord(await graphTenant()),other=new PostgresGraphInboxProducer(graphProducerOptions);
    const results=await Promise.all([graphProducer.enqueueBatch([input]),other.enqueueBatch([input])]);assert.deepEqual(results.map(r=>r[0].replayed).sort(),[false,true]);
    const row=(await admin.query('SELECT * FROM graph_security.notifications WHERE tenant_id=$1',[input.tenantId])).rows;assert.equal(row.length,1);assert.equal(row[0].source_version_hash,artifactHash);
    await assert.rejects(other.enqueueBatch([{...input,sourceEvidenceHash:'e'.repeat(64)}]),/CONFLICT/);assert.equal((await graphReader.get(graphKey(input))).sourceEvidenceHash,reason);
  });
  await t.test('V132 conflicting batch rolls back earlier new notifications in the same tenant',async()=>{
    const tenantId=await graphTenant(),prior=graphRecord(tenantId),fresh=graphRecord(tenantId);await graphProducer.enqueueBatch([prior]);
    await assert.rejects(graphProducer.enqueueBatch([fresh,{...prior,sourceVersionHash:'e'.repeat(64)}]),/CONFLICT/);assert.equal(await graphReader.get(graphKey(fresh)),null);
  });
  await t.test('V132 concurrent tenant capacity is serialized while immutable retries remain admitted',async()=>{
    const tenantId=await graphTenant(),bounded=new PostgresGraphInboxProducer({...graphProducerOptions,maxQueued:1}),a=graphRecord(tenantId),b=graphRecord(tenantId);
    const result=await Promise.allSettled([bounded.enqueueBatch([a]),bounded.enqueueBatch([b])]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
    const accepted=result[0].status==='fulfilled'?a:b;assert.equal((await bounded.enqueueBatch([accepted]))[0].replayed,true);assert.equal((await admin.query('SELECT count(*)::integer AS n FROM graph_security.notifications WHERE tenant_id=$1',[tenantId])).rows[0].n,1);
  });
  await t.test('V132 PostgreSQL RLS hides other tenants and rejects a context-swapped insert',async()=>{
    const a=graphRecord(await graphTenant()),b={...a,tenantId:await graphTenant()};await graphProducer.enqueueBatch([a]);await graphProducer.enqueueBatch([b]);
    const tx=new PostgresTenantTransactions({pool:graphReaderPool,expectedRole:graphReaderOptions.expectedRole});
    const visible=await tx.run({tenantId:a.tenantId,actorId:serviceActor},x=>x.query('SELECT tenant_id FROM graph_security.notifications'));assert.equal(visible.rows.length,1);assert.equal(visible.rows[0].tenant_id,a.tenantId);
    const producerTx=new PostgresTenantTransactions({pool:graphProducerPool,expectedRole:graphProducerOptions.expectedRole});
    await assert.rejects(producerTx.run({tenantId:a.tenantId,actorId:serviceActor},x=>x.query('INSERT INTO graph_security.notifications(tenant_id,subscription_id,notification_fingerprint,source_evidence_hash,source_version_hash,event_type,request_hash,max_attempts) VALUES($1,$2,$3,$4,$5,$6,$7,5)',[b.tenantId,uuid(),'f'.repeat(64),reason,artifactHash,'CREATED',reason])),/UNAVAILABLE/);
  });
  await t.test('V132 claim fencing survives reconstruction and never steals a live claim on elapsed time',async()=>{
    const input=graphRecord(await graphTenant());await graphProducer.enqueueBatch([input]);
    const owner=await graphWorker.claimNext({tenantId:input.tenantId}),other=new PostgresGraphInboxWorker({...graphWorkerOptions,workerId:uuid()});assert.equal(await other.claimNext({tenantId:input.tenantId}),null);
    assert.equal(await graphWorker.assertCurrent(owner),true);await assert.rejects(other.assertCurrent({...owner,workerId:uuid()}),/INPUT_INVALID/);
    const record=(await admin.query('SELECT * FROM graph_security.notifications WHERE tenant_id=$1',[input.tenantId])).rows[0];assert.notEqual(record.token_hash,owner.token);assert.equal(record.token_hash,crypto.createHash('sha256').update(owner.token).digest('hex'));
    assert.equal((await admin.query("SELECT count(*)::integer AS n FROM information_schema.columns WHERE table_schema='graph_security' AND table_name='notifications' AND column_name IN ('lease_until','expires_at')")).rows[0].n,0);
    await graphWorker.fail(owner,{retryable:true,errorCode:'DISPATCH_RETRY'});const second=await other.claimNext({tenantId:input.tenantId});assert.equal(second.attempt,2);
    await assert.rejects(graphWorker.complete(owner,{outcomeHash:reason}),/UNVERIFIED/);assert.equal(await other.complete(second,{outcomeHash:reason}),true);assert.equal(await other.complete(second,{outcomeHash:reason}),true);
    await assert.rejects(other.complete(second,{outcomeHash:'b'.repeat(64)}),/UNVERIFIED/);assert.equal((await graphReader.get(graphKey(input))).status,'DONE');
  });
  await t.test('V132 retry budget reaches DEAD without reopening a terminal notification',async()=>{
    const producer=new PostgresGraphInboxProducer({...graphProducerOptions,maxAttempts:2}),input=graphRecord(await graphTenant());await producer.enqueueBatch([input]);
    for(let i=0;i<2;i++){const claim=await graphWorker.claimNext({tenantId:input.tenantId});await graphWorker.fail(claim,{retryable:true,errorCode:'DISPATCH_RETRY'});}
    assert.equal((await graphReader.get(graphKey(input))).status,'DEAD');assert.equal(await graphWorker.claimNext({tenantId:input.tenantId}),null);
  });
  await t.test('V132 deferred PostgreSQL receipt constraints reject completion without an exact receipt',async()=>{
    const input=graphRecord(await graphTenant());await graphProducer.enqueueBatch([input]);const claim=await graphWorker.claimNext({tenantId:input.tenantId});
    const tx=new PostgresTenantTransactions({pool:graphWorkerPool,expectedRole:graphWorkerOptions.expectedRole}),context={tenantId:input.tenantId,actorId:serviceActor};
    await assert.rejects(tx.run(context,x=>x.query("UPDATE graph_security.notifications SET status='DONE' WHERE tenant_id=$1 AND subscription_id=$2 AND notification_fingerprint=$3",[input.tenantId,input.subscriptionId,input.notificationFingerprint])),/OUTCOME_UNKNOWN/);
    const tokenHash=crypto.createHash('sha256').update(claim.token).digest('hex');
    await assert.rejects(tx.run(context,x=>x.query('INSERT INTO graph_security.receipts(tenant_id,subscription_id,notification_fingerprint,attempt,worker_id,token_hash,outcome_hash) VALUES($1,$2,$3,$4,$5,$6,$7)',[input.tenantId,input.subscriptionId,input.notificationFingerprint,claim.attempt,claim.workerId,tokenHash,reason])),/OUTCOME_UNKNOWN/);
    assert.equal((await graphReader.get(graphKey(input))).status,'RUNNING');await graphWorker.complete(claim,{outcomeHash:reason});
    for(const sql of ['DELETE FROM graph_security.receipts','TRUNCATE graph_security.receipts','UPDATE graph_security.receipts SET outcome_hash=NULL'])assert.equal(await graphWorkerPool.query(sql).then(()=>false,e=>e.code==='42501'),true);
  });
  await t.test('V132 authorization is rechecked after tenant lock waits and rolls back rejected admission',async()=>{
    const input=graphRecord(await graphTenant()),blocker=await admin.connect();let allowed=true,entered=false,pending;
    const gated=new PostgresGraphInboxProducer({...graphProducerOptions,authorizeEnqueue:async c=>{if(c.phase==='ADMIT')entered=true;return allowed;}});
    try{await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['graph-inbox-v132',input.tenantId])]);
      pending=gated.enqueueBatch([input]).then(value=>({value}),error=>({error}));const deadline=Date.now()+5000;while(!entered&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));assert.equal(entered,true);
      allowed=false;await blocker.query('COMMIT');assert.match((await pending).error?.message??'',/FORBIDDEN/);assert.equal(await graphReader.get(graphKey(input)),null);
    }finally{await blocker.query('ROLLBACK');blocker.release();if(pending)await pending;}
  });
  await t.test('V132 mixed graph roles and direct foreign-table grants fail posture across old boundaries',async()=>{
    await admin.query('GRANT legaltech_graph_worker TO legaltech_graph_producer_ci');try{assert.equal((await graphProducer.probe()).ok,false);}finally{await admin.query('REVOKE legaltech_graph_worker FROM legaltech_graph_producer_ci');}
    await admin.query('GRANT SELECT ON public.matters TO legaltech_graph_reader_ci');try{assert.equal((await graphReader.probe()).ok,false);}finally{await admin.query('REVOKE SELECT ON public.matters FROM legaltech_graph_reader_ci');}
    for(const [principal,check] of [['legaltech_runtime_ci',()=>createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})()],['legaltech_broker_ci',()=>one.probe()],['legaltech_drain_reader_ci',()=>durable.probe()]]){
      await admin.query(`GRANT legaltech_graph_reader TO ${principal}`);try{assert.equal((await check()).ok,false);}finally{await admin.query(`REVOKE legaltech_graph_reader FROM ${principal}`);}
      await admin.query(`GRANT USAGE ON SCHEMA graph_security TO ${principal}`);await admin.query(`GRANT SELECT ON graph_security.notifications TO ${principal}`);
      try{assert.equal((await check()).ok,false);}finally{await admin.query(`REVOKE SELECT ON graph_security.notifications FROM ${principal}`);await admin.query(`REVOKE USAGE ON SCHEMA graph_security FROM ${principal}`);}
    }
  });
  await t.test('V132 changed forced RLS policy trigger state and function body cannot attest inbox health',async()=>{
    await admin.query('ALTER TABLE graph_security.notifications NO FORCE ROW LEVEL SECURITY');try{assert.equal((await graphWorker.probe()).ok,false);}finally{await admin.query('ALTER TABLE graph_security.notifications FORCE ROW LEVEL SECURITY');}
    await admin.query('ALTER POLICY graph_notification_read ON graph_security.notifications USING(true)');try{assert.equal((await graphReader.probe()).ok,false);}finally{await admin.query('ALTER POLICY graph_notification_read ON graph_security.notifications USING(tenant_id=public.app_current_tenant_id())');}
    await admin.query('ALTER TABLE graph_security.notifications DISABLE TRIGGER graph_notification_transition');try{assert.equal((await graphProducer.probe()).ok,false);}finally{await admin.query('ALTER TABLE graph_security.notifications ENABLE TRIGGER graph_notification_transition');}
    const triggerDefinition=(await admin.query("SELECT pg_get_triggerdef(oid) AS sql FROM pg_trigger WHERE tgname='graph_notification_transition' AND tgrelid='graph_security.notifications'::regclass")).rows[0].sql;
    await admin.query('DROP TRIGGER graph_notification_transition ON graph_security.notifications');
    try{await admin.query(triggerDefinition.replace('EXECUTE FUNCTION','WHEN (false) EXECUTE FUNCTION'));assert.equal((await graphProducer.probe()).ok,false);}
    finally{await admin.query('DROP TRIGGER IF EXISTS graph_notification_transition ON graph_security.notifications');await admin.query(triggerDefinition);}
    const definition=(await admin.query("SELECT pg_get_functiondef('graph_security.protect_notification()'::regprocedure) AS sql")).rows[0].sql;
    await admin.query(definition.replace('AS $function$','AS $function$\n-- synthetic catalog tamper\n'));try{assert.equal((await graphWorker.probe()).ok,false);}finally{await admin.query(definition);}
  });
  await resumeDurable();
  function actualGraphFixture(extra={}){
    const upload=approvedUpload(),base={...approvedSources.get(upload.uploadId),actorId:serviceActor},subscriptionId=uuid(),directoryTenantId=uuid(),expiresAt=new Date(Date.now()+3600000).toISOString();
    const subscription={tenantId:tenantA,subscriptionId,directoryTenantId,clientState:'synthetic-v132-client-state',status:'ACTIVE',expiresAt,richData:false};
    const payload={value:[{subscriptionId,tenantId:directoryTenantId,clientState:subscription.clientState,resource:'/users/synthetic/messages/synthetic-v132',changeType:'created',subscriptionExpirationDateTime:expiresAt}]};
    const config={producer:graphProducer,worker:graphWorker,reader:graphReader,processingIngress:extra.processingIngress??actualIngress(),drain:new ManagedDeploymentDrain({backend:durable,authorize:async()=>true,deploymentId:drainDeployment}),readiness:syntheticReady(),
      resolveSubscription:async()=>({...subscription}),registerSource:async row=>{
        const binding={...base,subscriptionId,changeType:row.changeType},sourceVersionHash=graphApprovedSourceVersionHash(binding),eventType=row.changeType==='updated'?'UPDATED':'CREATED';
        const receipt={tenantId:tenantA,subscriptionId,validatedFingerprint:row.notificationFingerprint,sourceEvidenceHash:reason,sourceVersionHash};
        const notificationFingerprint=graphSourceDeliveryFingerprint({...receipt,eventType});approvedSources.set(notificationFingerprint,{...binding,sourceKey:notificationFingerprint});return {...receipt,notificationFingerprint};
      },authorizeDispatch:async()=>true,dispatchControl:async c=>({tenantId:c.tenantId,subscriptionId:c.subscriptionId,notificationFingerprint:c.notificationFingerprint,sourceEvidenceHash:c.sourceEvidenceHash,sourceVersionHash:c.sourceVersionHash,status:'ACCEPTED'}),probeGraph:async()=>({ok:true}),...extra.config};
    return {config,payload,subscription,base,intake:new ManagedGraphWebhookIntake(config)};
  }
  await t.test('V132 validated intake replays across reconstruction and completes one actual domain outbox command',async()=>{
    const f=actualGraphFixture();await f.intake.receive(f.payload);assert.equal((await new ManagedGraphWebhookIntake(f.config).receive(f.payload)).replayed,1);
    assert.equal((await f.intake.relay(relayScope)).delivered,1);const rows=(await admin.query('SELECT * FROM graph_security.notifications WHERE subscription_id=$1',[f.subscription.subscriptionId])).rows;assert.equal(rows.length,1);assert.equal(rows[0].status,'DONE');
    const commands=(await admin.query('SELECT * FROM public.domain_job_commands WHERE payload_id=$1',[f.base.payloadId])).rows;assert.equal(commands.length,1);assert.equal(commands[0].actor_id,serviceActor);assert.equal((await admin.query('SELECT job_id FROM public.domain_outbox_events WHERE job_id=$1',[commands[0].job_id])).rows.length,1);
    assert.equal((await admin.query('SELECT * FROM graph_security.receipts WHERE subscription_id=$1',[f.subscription.subscriptionId])).rows.length,1);
  });
  await t.test('V132 identical basic Graph notices admit a new immutable version while same-version deliveries replay',async()=>{
    const f=actualGraphFixture();await f.intake.receive(f.payload);await f.intake.relay(relayScope);f.base.revision=2;await f.intake.receive(f.payload);assert.equal((await f.intake.receive(f.payload)).replayed,1);await f.intake.relay(relayScope);
    const rows=(await admin.query('SELECT notification_fingerprint,source_version_hash FROM graph_security.notifications WHERE subscription_id=$1',[f.subscription.subscriptionId])).rows;assert.equal(rows.length,2);assert.notEqual(rows[0].notification_fingerprint,rows[1].notification_fingerprint);assert.notEqual(rows[0].source_version_hash,rows[1].source_version_hash);
  });
  await t.test('V132 lost postcommit ingress acknowledgement replays one durable command under a new fenced attempt',async()=>{
    let lost=true;const router=new ManagedProcessingIngress({...ingressOptions,handlers:pipeline.handlers,drain:new ManagedDeploymentDrain({backend:durable,authorize:async()=>true,deploymentId:drainDeployment}),readiness:syntheticReady(),audit:async c=>{if(c.phase==='ACCEPTED'&&lost){lost=false;throw new Error('synthetic-lost-ingress-ack');}}});
    const f=actualGraphFixture({processingIngress:router});await f.intake.receive(f.payload);await assert.rejects(f.intake.relay(relayScope));assert.equal((await f.intake.relay(relayScope)).delivered,1);
    const row=(await admin.query('SELECT status,attempts FROM graph_security.notifications WHERE subscription_id=$1',[f.subscription.subscriptionId])).rows[0];assert.equal(row.status,'DONE');assert.equal(row.attempts,2);assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.domain_job_commands WHERE payload_id=$1',[f.base.payloadId])).rows[0].n,1);
  });
  await t.test('V132 current source tenant and version mismatch cannot commit a cross-bound domain command',async()=>{
    const f=actualGraphFixture();await f.intake.receive(f.payload);const row=(await admin.query('SELECT notification_fingerprint FROM graph_security.notifications WHERE subscription_id=$1',[f.subscription.subscriptionId])).rows[0];approvedSources.set(row.notification_fingerprint,{...approvedSources.get(row.notification_fingerprint),tenantId:tenantB,actorId:actorB});
    await assert.rejects(f.intake.relay(relayScope));assert.equal((await admin.query('SELECT count(*)::integer AS n FROM public.domain_job_commands WHERE payload_id=$1',[f.base.payloadId])).rows[0].n,0);assert.equal((await graphReader.get({tenantId:tenantA,subscriptionId:f.subscription.subscriptionId,notificationFingerprint:row.notification_fingerprint})).status,'DEAD');
  });
  await t.test('V132 stalled source publication holds an actual PostgreSQL deployment lease after cancellation',async()=>{
    let finish,entered=false;const gate=new Promise(r=>{finish=r}),f=actualGraphFixture();const register=f.config.registerSource;
    const intake=new ManagedGraphWebhookIntake({...f.config,timeoutMs:100,registerSource:async row=>{entered=true;await gate;return register(row);}});let settled=false;const task=intake.receive(f.payload).catch(e=>{settled=true;return e;});
    try{const end=Date.now()+5000;while(!entered&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.equal(entered,true);await new Promise(r=>setTimeout(r,120));assert.equal(settled,false);assert.equal((await beginDurable()).state,'DRAINING');assert.equal((await durable.status(scope)).inFlight,1);await assert.rejects(resumeDurable(),/UNVERIFIED/);
      assert.equal((await intake.stop({timeoutMs:20})).drained,false);finish();await task;assert.equal((await durable.status(scope)).state,'DRAINED');assert.equal((await admin.query('SELECT count(*)::integer AS n FROM graph_security.notifications WHERE subscription_id=$1',[f.subscription.subscriptionId])).rows[0].n,0);
    }finally{finish();await task;await intake.stop();await resumeDurable();}
  });
  await t.test('V132 twelve-pool root binds real inbox HTTP worker readiness and global shutdown',async()=>{
    const f=actualGraphFixture(),{drain:unusedDomain,...serviceDomain}=pipelineOptions,{drain:unusedWorker,...serviceWorker}=managedWorker;let graphHealthy=true;const canaryPhases=[];
    const webhooks={producerOptions:graphProducerOptions,workerOptions:graphWorkerOptions,readerOptions:graphReaderOptions,resolveSubscription:f.config.resolveSubscription,registerSource:f.config.registerSource,authorizeDispatch:f.config.authorizeDispatch,dispatchControl:f.config.dispatchControl,probeGraph:async()=>({ok:graphHealthy}),getScopes:async()=>[relayScope],authorizeScope,pollIntervalMs:100,cycleTimeoutMs:10000};
    const options={drain:{...drainOptions,ownerId:uuid(),authorize:async()=>true},ingress:ingressOptions,webhooks,processing:{domain:serviceDomain,worker:serviceWorker,queueReaderPool,expectedQueueReaderRole:'legaltech_queue_reader_ci',authorizeResultRead:async()=>true,authorizeAdoption:async()=>true,
      artifacts:{manifest:{resolveVersion:async r=>manifests.get(r.id),probe:async()=>({ok:true})},storage:{readVersion:async r=>({tenantId:r.tenantId,objectKey:r.objectKey,versionId:r.versionId,hash:r.hash,contentLength:r.size,body:(async function*(){yield bytes;})()}),probe:async()=>({ok:true})},authorizeVersion:async()=>true,verifyEvidence:async()=>true},
      canary:{tenantId:tenantA,actorId:actorA,serviceActorId:serviceActor,authorizeCanary:async c=>{canaryPhases.push(c.phase);return true;},createFixture:async()=>{const fixture=approvedUpload(),m=approvedSources.get(fixture.uploadId);return {confirmedSynthetic:true,payloadId:m.payloadId,payloadHash:m.payloadHash,expectedResultCode:'CLASSIFIED',expectedResultHash:resultHash};},timeoutMs:5000,maxAgeMs:30000}},http:httpFixture,probes:Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,async()=>({ok:true})])),readiness:{probeTimeoutMs:5000},canaryIntervalMs:10000};
    for(const field of ['producer','worker','reader','processingIngress','drain','readiness','operation','relay'])assert.throws(()=>createCapacityBoundService({...options,webhooks:{...webhooks,[field]:{}}}),/GRAPH_OVERRIDE_FORBIDDEN/);
    assert.throws(()=>createCapacityBoundService({...options,http:{...httpFixture,graphIntake:{}}}),/HTTP_OVERRIDE_FORBIDDEN/);
    assert.throws(()=>createCapacityBoundService({...options,webhooks:{...webhooks,producerOptions:{...graphProducerOptions,pool:drainWorkerPool}}}),/GRAPH_SEPARATE_POOLS_REQUIRED/);
    const root=createCapacityBoundService(options);let stopped;
    try{await root.start({port:0});const baseUrl=`http://127.0.0.1:${root.server.address().port}`,ready=async()=>{let response;const end=Date.now()+10000;do{response=await fetch(baseUrl+'/api/v1/ready');await response.arrayBuffer();if(response.status===200)return;await new Promise(r=>setTimeout(r,25));}while(Date.now()<end);assert.equal(response.status,200,JSON.stringify({service:root.status(),graph:root.graphIntake.status(),graphProbe:await root.graphIntake.probe(),canaryPhases,drain:await durable.status(scope),jobs:(await admin.query("SELECT kind,status,attempts,last_error_code,result_code FROM queue_security.jobs WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10",[tenantA])).rows}));};await ready();
      // Admission can briefly close while a concurrent shared lease acquisition
      // is unacknowledged. Exercise Graph's durable retry contract on 503.
      const send=async()=>{const deadline=Date.now()+10000;let response;do{response=await fetch(baseUrl+'/api/v1/integrations/graph/webhooks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.payload)});if(response.status!==503)return response;await response.arrayBuffer();await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);return response;};const response=await send();assert.equal(response.status,202);await response.arrayBuffer();
      let notification;const end=Date.now()+10000;do{notification=(await admin.query('SELECT * FROM graph_security.notifications WHERE subscription_id=$1',[f.subscription.subscriptionId])).rows[0];if(notification?.status==='DONE')break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<end);assert.equal(notification?.status,'DONE');
      const command=(await admin.query('SELECT command_id,job_id FROM public.domain_job_commands WHERE payload_id=$1',[f.base.payloadId])).rows[0];assert.ok(command);
      let processed;const processingEnd=Date.now()+10000;do{processed=await queueReader.getResult({tenantId:tenantA,jobId:command.job_id});if(processed)break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<processingEnd);
      assert.equal(processed?.commandId,command.command_id);assert.equal(processed?.resultCode,'CLASSIFIED');
      const replay=await send();assert.equal(replay.status,202);assert.equal((await replay.json()).replayed,1);
      graphHealthy=false;root.readiness.invalidate();const unavailable=await fetch(baseUrl+'/api/v1/ready');assert.equal(unavailable.status,503);await unavailable.arrayBuffer();graphHealthy=true;root.readiness.invalidate();await ready();
      stopped=await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});assert.equal(stopped.drained,true,JSON.stringify({stopped,graph:root.graphIntake.status(),drain:await durable.status(scope),heldOperations:(await admin.query("SELECT operation_id,kind FROM drain_security.leases WHERE deployment_id=$1 AND state='HELD'",[drainDeployment])).rows}));assert.equal((await durable.status(scope)).state,'DRAINED');assert.equal((await durable.status(scope)).inFlight,0);
    }finally{graphHealthy=true;if(!stopped?.drained){await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});root.server.closeAllConnections();}}
  });
  // V130 runs last: its approvals queue PROCLAIM_WRITEBACK work that nothing in this
  // suite executes yet (V131), so it must not precede the service drain cases.
  // V130: the durable human review decision, through its own reviewer login. The
  // reviewer holds the reviewer and outbox-writer groups only - never the result
  // writer or command author - so the identity adopting a machine result is not
  // the one approving it.
  await admin.query(`CREATE ROLE legaltech_reviewer_ci LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT USAGE ON SCHEMA public TO legaltech_reviewer_ci');
  await admin.query('GRANT legaltech_outbox_writer,legaltech_domain_reviewer TO legaltech_reviewer_ci');
  await admin.query('GRANT SELECT ON public.actors,public.tenants,public.inbound_events,public.matters TO legaltech_reviewer_ci');
  await admin.query('GRANT SELECT ON public.matter_actor_access,public.matter_break_glass_grants,public.actor_security_zones TO legaltech_reviewer_ci');
  const reviewerPool=makePool('legaltech_reviewer_ci',2);
  await admin.query(`CREATE ROLE legaltech_review_reader_ci LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query('GRANT legaltech_review_reader TO legaltech_review_reader_ci');
  const reviewReaderPool=makePool('legaltech_review_reader_ci',2),reviewReaderOptions={pool:reviewReaderPool,expectedRole:'legaltech_review_reader_ci',cursorKey:crypto.randomBytes(32),authorizeRead:async()=>true};
  const reviewReader=new PostgresReviewReader(reviewReaderOptions),readerTransactions=new PostgresTenantTransactions({pool:reviewReaderPool,expectedRole:'legaltech_review_reader_ci'});
  const reviewerTransactions=new PostgresTenantTransactions({pool:reviewerPool,expectedRole:'legaltech_reviewer_ci'});
  let decisionAllowed=true;
  const reviews=new PostgresReviewDecisions({domainOutbox:new PostgresDomainOutbox({pool:reviewerPool,expectedRole:'legaltech_reviewer_ci',authorizeAppend:async()=>true}),authorizeDecision:async()=>decisionAllowed});
  // The queue hands out the oldest due job, so process until THIS job has its result,
  // recording every attempt so a CI failure names the worker's actual error code.
  const processOwn=async jobId=>{const seen=[];
    for(let i=0;i<20;i++){if(await queueReader.getResult({tenantId:tenantA,jobId}))return;const r=await runInbound();
      seen.push(r?{status:r.status,errorCode:r.errorCode??null,own:r.jobId===jobId}:null);if(!r||r.status!=='SUCCEEDED')await new Promise(res=>setTimeout(res,100));}
    assert.fail(`V130 fixture job was not processed: ${JSON.stringify(seen)}`);};
  const adoptNew=async()=>{const input=await createInbound();await processOwn(input.jobId);const adopted=await adopter.adopt({tenantId:tenantA,serviceActorId:serviceActor,jobId:input.jobId});assert.equal(adopted.status,'APPLIED');return input;};
  const openMatter=async(tenant=tenantA)=>{const m=uuid();await admin.query('INSERT INTO public.matters(id,tenant_id,display_reference) VALUES($1,$2,$3)',[m,tenant,`v130-${m}`]);return m;};
  const decisionFor=(eventId,over={})=>({tenantId:tenantA,actorId:actorA,eventId,decision:'APPROVE',decisionKey:`v130-${uuid()}`,traceId:'synthetic-v130',...over});
  const eventStatus=async eventId=>(await admin.query('SELECT status FROM public.inbound_events WHERE id=$1',[eventId])).rows[0].status;
  const decisionsFor=async eventId=>(await admin.query('SELECT * FROM public.domain_review_decisions WHERE event_id=$1',[eventId])).rows;
  const writebacksFor=async eventId=>(await admin.query("SELECT job_id FROM public.domain_outbox_events WHERE kind='PROCLAIM_WRITEBACK' AND object_id=$1",[eventId])).rows;
  const pinnedDecision=async(input,over={})=>{const result=(await admin.query('SELECT result_hash FROM public.domain_job_results WHERE job_id=$1',[input.jobId])).rows[0];return decisionFor(input.eventId,{expectedResultJobId:input.jobId,expectedResultHash:result.result_hash,...over});};
  await t.test('V134 actual reader has exact column grants and no decision helper or write privileges',async()=>{
    assert.equal((await reviewReader.probe()).ok,true);
    for(const sql of ['SELECT * FROM public.inbound_events','SELECT * FROM public.domain_job_results',"UPDATE public.inbound_events SET status='REJECTED'",'DELETE FROM public.domain_review_decisions'])assert.equal(await reviewReaderPool.query(sql).then(()=>false,e=>e.code==='42501'),true);
    assert.equal((await admin.query("SELECT has_function_privilege('legaltech_review_reader_ci','review_security.lock_scope(uuid,uuid,uuid)','EXECUTE') AS allowed")).rows[0].allowed,false);
  });
  await t.test('V134 actual metadata detail supplies the exact adopted pins with no raw document or actor fields',async()=>{
    const input=await adoptNew(),expected=await pinnedDecision(input),out=await reviewReader.get({tenantId:tenantA,actorId:actorA,eventId:input.eventId});
    assert.equal(out.resultJobId,input.jobId);assert.equal(out.resultHash,expected.expectedResultHash);assert.equal(out.status,'PROCESSED');assert.deepEqual(Object.keys(out),['eventId','status','resultJobId','resultHash','resultCode','artifactHash','decision','matterId','writebackJobId']);
    assert.equal((await decisionsFor(input.eventId)).length,0);assert.equal((await writebacksFor(input.eventId)).length,0);
    const foreign=await readerTransactions.run({tenantId:tenantB,actorId:actorB},tx=>tx.query('SELECT event_id FROM public.domain_review_decisions'));assert.ok(foreign.rows.every(r=>r.event_id!==input.eventId));
    await assert.rejects(reviewReader.get({tenantId:tenantB,actorId:actorB,eventId:input.eventId}),/FORBIDDEN/);
  });
  await t.test('V134 actual keyset pages bind tenant actor filters and survive reader reconstruction',async()=>{
    const first=await reviewReader.list({tenantId:tenantA,actorId:actorA,limit:1});assert.equal(first.items.length,1);assert.ok(first.nextCursor);
    const reconstructed=new PostgresReviewReader(reviewReaderOptions),second=await reconstructed.list({tenantId:tenantA,actorId:actorA,limit:1,cursor:first.nextCursor});assert.equal(second.items.length,1);assert.notEqual(second.items[0].eventId,first.items[0].eventId);
    for(const change of [{tenantId:tenantB},{actorId:actorB},{status:'ALL'}])await assert.rejects(reviewReader.list({tenantId:tenantA,actorId:actorA,limit:1,cursor:first.nextCursor,...change}),/INPUT_INVALID/);
  });
  await t.test('V134 current object denial filters list rows and keeps detail absence opaque',async()=>{
    const input=await adoptNew(),denied=new PostgresReviewReader({...reviewReaderOptions,authorizeRead:async c=>c.eventId!==input.eventId});
    await assert.rejects(denied.get({tenantId:tenantA,actorId:actorA,eventId:input.eventId}),/FORBIDDEN/);await assert.rejects(denied.get({tenantId:tenantA,actorId:actorA,eventId:uuid()}),/FORBIDDEN/);
    const page=await denied.list({tenantId:tenantA,actorId:actorA,status:'ALL',limit:100});assert.equal(page.items.some(r=>r.eventId===input.eventId),false);
  });
  await t.test('V134 final authority withdrawal denies actual result release',async()=>{
    const input=await adoptNew(),phases=[],denied=new PostgresReviewReader({...reviewReaderOptions,authorizeRead:async c=>{phases.push(c.phase);return c.phase!=='RELEASE';}});
    await assert.rejects(denied.get({tenantId:tenantA,actorId:actorA,eventId:input.eventId}),/FORBIDDEN/);assert.deepEqual(phases,['ADMIT','ITEM','RELEASE']);assert.equal(await eventStatus(input.eventId),'PROCESSED');
  });
  await t.test('V134 prepared audit rechecks actual actor revocation before metadata release',async()=>{
    const input=await adoptNew(),drain=fixtureDrain(),reads=new ManagedReviewReads({reader:reviewReader,drain:drain.drain,readiness:syntheticReady(),probeRead:async()=>({ok:true}),audit:async c=>{if(c.phase==='PREPARED')await admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[actorA]);}});
    try{await assert.rejects(reads.get({tenantId:tenantA,actorId:actorA,eventId:input.eventId}),/FORBIDDEN/);assert.equal(drain.held.size,0);}finally{await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[actorA]);await reads.stop();}
  });
  await t.test('V134 widened raw-result grants and permissive read policies fail actual health',async()=>{
    await admin.query('GRANT SELECT ON public.domain_job_results TO legaltech_review_reader_ci');try{assert.equal((await reviewReader.probe()).ok,false);}finally{await admin.query('REVOKE SELECT ON public.domain_job_results FROM legaltech_review_reader_ci');}
    await admin.query('CREATE POLICY synthetic_review_reader_widen ON public.domain_job_results FOR SELECT TO PUBLIC USING(true)');try{assert.equal((await reviewReader.probe()).ok,false);}finally{await admin.query('DROP POLICY synthetic_review_reader_widen ON public.domain_job_results');}
    await admin.query('ALTER POLICY domain_result_human_read ON public.domain_job_results USING(true)');try{assert.equal((await reviewReader.probe()).ok,false);}finally{await admin.query('ALTER POLICY domain_result_human_read ON public.domain_job_results USING(tenant_id=public.app_current_tenant_id())');}
    assert.equal((await reviewReader.probe()).ok,true);
  });
  await t.test('V134 private schema read grants and executable definer functions fail reader health',async()=>{
    await admin.query('CREATE SCHEMA synthetic_review_probe');await admin.query('CREATE TABLE synthetic_review_probe.metadata(id uuid)');
    await admin.query('GRANT USAGE ON SCHEMA synthetic_review_probe TO legaltech_review_reader_ci');
    try{await admin.query('GRANT SELECT ON synthetic_review_probe.metadata TO legaltech_review_reader_ci');assert.equal((await reviewReader.probe()).ok,false);
      await admin.query('REVOKE SELECT ON synthetic_review_probe.metadata FROM legaltech_review_reader_ci');assert.equal((await reviewReader.probe()).ok,true);
      await admin.query('CREATE FUNCTION synthetic_review_probe.example() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT true $$');assert.equal((await reviewReader.probe()).ok,false);
    }finally{await admin.query('DROP SCHEMA synthetic_review_probe CASCADE');}
    assert.equal((await reviewReader.probe()).ok,true);
  });
  await t.test('V134 review reader role mixing is rejected across writable runtime session and drain credentials',async()=>{
    for(const [role,probe] of [['legaltech_runtime_ci',()=>createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})({})],['legaltech_broker_ci',()=>one.probe()],['legaltech_drain_reader_ci',()=>durable.probe()]]){
      await admin.query(`GRANT legaltech_review_reader TO ${role}`);try{assert.equal((await probe()).ok,false);}finally{await admin.query(`REVOKE legaltech_review_reader FROM ${role}`);}
    }
    await admin.query('GRANT legaltech_domain_reviewer TO legaltech_review_reader_ci');try{assert.equal((await reviewReader.probe()).ok,false);}finally{await admin.query('REVOKE legaltech_domain_reviewer FROM legaltech_review_reader_ci');}
  });
  await t.test('V133 actual review posture attests pinned functions policies triggers and narrow grants',async()=>{
    assert.equal((await reviews.probe()).ok,true);
    const rights=await reviewerPool.query("SELECT has_function_privilege(current_user,'public.check_domain_review_decision()','EXECUTE') OR has_function_privilege(current_user,'public.check_inbound_review_transition()','EXECUTE') AS executable");assert.equal(rights.rows[0].executable,false);
    for(const role of ['legaltech_runtime_ci','legaltech_broker_ci','legaltech_graph_worker_ci','legaltech_drain_worker_ci'])assert.equal((await admin.query("SELECT has_function_privilege($1,'review_security.lock_scope(uuid,uuid,uuid)','EXECUTE') AS permitted",[role])).rows[0].permitted,false);
  });
  await t.test('V133 scope lock rejects missing context forged tenant actor and cross-tenant matter',async()=>{
    await assert.rejects(reviewerPool.query('SELECT review_security.lock_scope($1,$2,NULL)',[tenantA,actorA]));
    for(const [tenant,actor] of [[tenantB,actorA],[tenantA,actorB]])await assert.rejects(reviewerTransactions.run({tenantId:tenantA,actorId:actorA},tx=>tx.query('SELECT review_security.lock_scope($1,$2,NULL)',[tenant,actor])),/UNAVAILABLE/);
    const foreign=await openMatter(tenantB),local=await openMatter();
    const check=matter=>reviewerTransactions.run({tenantId:tenantA,actorId:actorA},tx=>tx.query('SELECT review_security.lock_scope($1,$2,$3) AS locked',[tenantA,actorA,matter]));
    assert.equal((await check(foreign)).rows[0].locked,false);assert.equal((await check(local)).rows[0].locked,true);
    const rights=(await reviewerPool.query("SELECT has_any_column_privilege(current_user,'public.actors','UPDATE') OR has_any_column_privilege(current_user,'public.matters','UPDATE') AS writable")).rows[0];assert.equal(rights.writable,false);
  });
  const reviewDocumentProviders={
    manifest:{resolveVersion:async r=>({tenantId:r.tenantId,eventId:r.eventId,resultJobId:r.expectedResultJobId,resultHash:r.expectedResultHash,artifactHash:r.artifactHash,
      objectKey:`${r.tenantId}/review/synthetic-source`,versionId:'immutable-v136',size:bytes.length,contentType:'text/plain',evidenceHash:reason,region:'synthetic-region',revision:1,state:'REVIEW_ALLOWED',malwareScan:'CLEAN',parserIsolation:'ISOLATED'}),probe:async()=>({ok:true})},
    storage:{readVersion:async r=>({tenantId:r.tenantId,objectKey:r.objectKey,versionId:r.versionId,hash:r.artifactHash,contentLength:bytes.length,body:(async function*(){yield bytes;})()}),probe:async()=>({ok:true})},
    authorizeDocument:async()=>true,verifyEvidence:async()=>true,audit:async()=>{},probeDocuments:async()=>({ok:true}),
  };
  const documentRequest=async()=>{const event=await adoptNew(),pin=await pinnedDecision(event);return {tenantId:tenantA,actorId:actorA,eventId:event.eventId,expectedResultJobId:event.jobId,expectedResultHash:pin.expectedResultHash};};
  const actualDocuments=(over={})=>{const drain=fixtureDrain();return {drain,documents:new ManagedReviewDocuments({...reviewDocumentProviders,...over,reader:reviewReader,drain:drain.drain,readiness:syntheticReady()})};};
  await t.test('V136 actual adopted document bytes preserve the exact source digest and reader-only database grants',async()=>{
    const request=await documentRequest(),f=actualDocuments();let owned;
    try{await f.documents.deliver(request,{consume:async doc=>{owned=doc.bytes;assert.equal(doc.artifactHash,artifactHash);assert.deepEqual(doc.bytes,bytes);assert.equal(f.drain.held.size,1);}});assert.deepEqual(owned,Buffer.alloc(owned.length));assert.equal(f.drain.held.size,0);assert.equal((await decisionsFor(request.eventId)).length,0);assert.equal((await writebacksFor(request.eventId)).length,0);assert.equal((await f.documents.probe()).ok,true);}finally{await f.documents.stop();}
  });
  await t.test('V136 actual foreign tenant and stale result pins never resolve source storage',async()=>{
    const request=await documentRequest();let resolves=0;const f=actualDocuments({manifest:{...reviewDocumentProviders.manifest,resolveVersion:async r=>{resolves++;return reviewDocumentProviders.manifest.resolveVersion(r);}}});
    try{for(const change of [{tenantId:tenantB,actorId:actorB},{expectedResultJobId:uuid()},{expectedResultHash:'0'.repeat(64)}])await assert.rejects(f.documents.deliver({...request,...change},{consume:async()=>{assert.fail('unauthorized source transfer');}}),/FORBIDDEN/);assert.equal(resolves,0);}finally{await f.documents.stop();}
  });
  await t.test('V136 prepared source audit observes actual actor revocation before byte release',async()=>{
    const request=await documentRequest(),f=actualDocuments({audit:async c=>{if(c.phase==='PREPARED')await admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[actorA]);}});
    try{await assert.rejects(f.documents.deliver(request,{consume:async()=>assert.fail('revoked source transfer')}),/FORBIDDEN/);assert.equal(f.drain.held.size,0);}finally{await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[actorA]);await f.documents.stop();}
  });
  await t.test('V136 actual reader final document authority withdrawal releases no source',async()=>{
    const request=await documentRequest(),f=actualDocuments({authorizeDocument:async c=>c.phase!=='RELEASE'});
    try{await assert.rejects(f.documents.deliver(request,{consume:async()=>assert.fail('withdrawn source transfer')}),/FORBIDDEN/);assert.equal(f.drain.held.size,0);}finally{await f.documents.stop();}
  });
  await t.test('V136 source manifest change during prepared audit rejects actual adopted transfer',async()=>{
    const request=await documentRequest();let version='immutable-v136';const f=actualDocuments({audit:async c=>{if(c.phase==='PREPARED')version='replacement-v136';},manifest:{...reviewDocumentProviders.manifest,resolveVersion:async r=>({...await reviewDocumentProviders.manifest.resolveVersion(r),versionId:version})}});
    try{await assert.rejects(f.documents.deliver(request,{consume:async()=>assert.fail('replaced source transfer')}),/UNAVAILABLE/);assert.equal(f.drain.held.size,0);}finally{await f.documents.stop();}
  });
  await t.test('V136 source probe attests actual reader privileges and fails wider raw data access',async()=>{
    const f=actualDocuments();try{assert.equal((await f.documents.probe()).ok,true);await admin.query('GRANT SELECT ON public.domain_job_results TO legaltech_review_reader_ci');assert.equal((await f.documents.probe()).ok,false);}finally{await admin.query('REVOKE SELECT ON public.domain_job_results FROM legaltech_review_reader_ci');await f.documents.stop();}
  });
  await t.test('V133/V134/V135/V136 eleven-pool service exposes review browsing decisions lost-ack replay and global shutdown',async()=>{
    await resumeDurable();const input=await adoptNew(),request=await pinnedDecision(input,{decision:'REJECT'});let lost=true,reviewHealthy=true,documentHealthy=true;
    const {drain:unusedDomain,...serviceDomain}=pipelineOptions,{drain:unusedWorker,...serviceWorker}=managedWorker;
    const review={pool:reviewerPool,expectedRole:'legaltech_reviewer_ci',authorizeAppend:async()=>true,authorizeDecision:async()=>true,authorizeReview:async()=>true,
      audit:async c=>{if(c.phase==='ACCEPTED'&&lost){lost=false;throw new Error('synthetic-lost-review-ack');}},probeReview:async()=>({ok:reviewHealthy})};
    const session={tenantId:tenantA,actorId:actorA,capabilities:['inbound:review','document:read'],authContext:{method:'SERVER_SESSION',mfaVerified:false},status:'ACTIVE'};
    const options={drain:{...drainOptions,ownerId:uuid(),authorize:async()=>true},ingress:ingressOptions,review,reviewDocuments:{...reviewDocumentProviders,maxPending:1,probeDocuments:async()=>({ok:documentHealthy})},reviewRead:{...reviewReaderOptions,audit:async()=>{},probeRead:async()=>({ok:reviewHealthy})},processing:{domain:serviceDomain,worker:serviceWorker,
      queueReaderPool,expectedQueueReaderRole:'legaltech_queue_reader_ci',authorizeResultRead:async()=>true,authorizeAdoption:async()=>true,
      artifacts:{manifest:{resolveVersion:async r=>manifests.get(r.id),probe:async()=>({ok:true})},storage:{readVersion:async r=>({tenantId:r.tenantId,objectKey:r.objectKey,versionId:r.versionId,hash:r.hash,contentLength:r.size,body:(async function*(){yield bytes;})()}),probe:async()=>({ok:true})},authorizeVersion:async()=>true,verifyEvidence:async()=>true},
      canary:{tenantId:tenantA,actorId:actorA,serviceActorId:serviceActor,authorizeCanary:async()=>true,createFixture:async()=>{const f=approvedUpload(),m=approvedSources.get(f.uploadId);return {confirmedSynthetic:true,payloadId:m.payloadId,payloadHash:m.payloadHash,expectedResultCode:'CLASSIFIED',expectedResultHash:resultHash};},timeoutMs:5000,maxAgeMs:30000}},
      http:{...httpFixture,reviewUi:{allowedOrigin:'https://review.example.test'},authProvider:{authenticate:async()=>session}},probes:Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(k=>[k,async()=>({ok:true})])),readiness:{probeTimeoutMs:5000},canaryIntervalMs:10000};
    for(const field of ['reviews','domainOutbox','drain','readiness'])assert.throws(()=>createCapacityBoundService({...options,review:{...review,[field]:{}}}),/REVIEW_OVERRIDE_FORBIDDEN/);
    assert.throws(()=>createCapacityBoundService({...options,review:{...review,pool:drainWorkerPool}}),/REVIEW_SEPARATE_POOL_REQUIRED/);
    assert.throws(()=>createCapacityBoundService({...options,http:{...options.http,reviewIntake:{}}}),/HTTP_OVERRIDE_FORBIDDEN/);
    const root=createCapacityBoundService(options);let stopped;
    try{await root.start({port:0});const base=`http://127.0.0.1:${root.server.address().port}`;
      const ready=async()=>{let r;const end=Date.now()+15000;do{r=await fetch(base+'/api/v1/ready');await r.arrayBuffer();if(r.status===200)return;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<end);assert.equal(r.status,200,JSON.stringify({service:root.status(),review:root.reviewIntake.status(),probe:await root.reviewIntake.probe()}));};await ready();
      const readMetadata=async path=>{let response;const deadline=Date.now()+10000;do{response=await fetch(base+path);if(response.status!==503)return response;await response.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);return response;};
      const shell=await readMetadata('/review');assert.equal(shell.status,200);const shellText=await shell.text();assert.ok(shellText.includes('Review adopted results'));assert.ok(shellText.includes('data-available="true"'));assert.ok(shell.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
      const module=await readMetadata('/review/assets/reviewClient.js');assert.equal(module.status,200);assert.ok((await module.text()).includes('export class ReviewClient'));
      const crossRead=await fetch(base+'/api/v1/processing/reviews/'+input.eventId,{headers:{origin:'https://evil.example.test'}});assert.equal(crossRead.status,403);await crossRead.arrayBuffer();
      const crossWrite=await fetch(base+'/api/v1/processing/review-decisions',{method:'POST',headers:{origin:'https://evil.example.test','content-type':'application/json'},body:'{}'});assert.equal(crossWrite.status,403);await crossWrite.arrayBuffer();assert.equal((await decisionsFor(input.eventId)).length,0);
      const detail=await readMetadata('/api/v1/processing/reviews/'+input.eventId);assert.equal(detail.status,200);const metadata=await detail.json();assert.equal(metadata.resultHash,request.expectedResultHash);assert.equal(metadata.resultJobId,request.expectedResultJobId);
      const download=await readMetadata('/api/v1/processing/reviews/'+input.eventId+'/document?resultJobId='+metadata.resultJobId+'&resultHash='+metadata.resultHash);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);assert.equal(download.headers.get('x-content-sha256'),artifactHash);assert.ok(download.headers.get('content-disposition').startsWith('attachment;'));assert.equal((await decisionsFor(input.eventId)).length,0);
      for(const field of ['reader','drain','readiness','pool','expectedRole'])assert.throws(()=>createCapacityBoundService({...options,reviewDocuments:{...options.reviewDocuments,[field]:{}}}),/REVIEW_DOCUMENT_OVERRIDE_FORBIDDEN/);
      assert.throws(()=>createCapacityBoundService({...options,http:{...options.http,reviewDocuments:{}}}),/HTTP_OVERRIDE_FORBIDDEN/);
      const listing=await readMetadata('/api/v1/processing/reviews?limit=100');assert.equal(listing.status,200);assert.ok((await listing.json()).items.some(item=>item.eventId===input.eventId));
      assert.throws(()=>createCapacityBoundService({...options,reviewRead:{...options.reviewRead,pool:reviewerPool}}),/REVIEW_READ_SEPARATE_POOL_REQUIRED/);
      for(const field of ['reader','drain','readiness'])assert.throws(()=>createCapacityBoundService({...options,reviewRead:{...options.reviewRead,[field]:{}}}),/REVIEW_READ_OVERRIDE_FORBIDDEN/);
      const browser=new ReviewClient({randomUUID:()=>uuid(),fetchImpl:(path,opts)=>fetch(base+path,{...opts,headers:{...opts.headers,...(opts.method==='POST'?{origin:'https://review.example.test'}:{})}})});
      const browseDeadline=Date.now()+15000;do{
        await browser.list();for(let page=0;page<100&&!browser.state().error&&!browser.state().items.some(x=>x.eventId===input.eventId)&&browser.state().nextCursor;page++)await browser.list({next:true});
        if(!browser.state().error){assert.ok(browser.state().items.some(x=>x.eventId===input.eventId));await browser.select(input.eventId);}
        if(browser.state().selected)break;assert.equal(browser.state().error,'READ_UNAVAILABLE');await new Promise(resolve=>setTimeout(resolve,100));
      }while(Date.now()<browseDeadline);assert.ok(browser.state().selected);assert.equal(browser.state().selected.resultHash,request.expectedResultHash);
      await browser.decide({decision:'REJECT',sourceReviewed:true});const retryKey=browser.state().pending?.decisionKey;
      const end=Date.now()+10000;while(lost&&Date.now()<end){assert.ok(browser.state().pending);await new Promise(resolve=>setTimeout(resolve,100));await browser.retry();}
      assert.equal(lost,false);assert.equal(browser.state().error,'OUTCOME_UNKNOWN');assert.equal(browser.state().pending.decisionKey,retryKey);assert.equal((await decisionsFor(input.eventId)).length,1);
      const retryEnd=Date.now()+10000;do{await browser.retry();if(browser.state().receipt)break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<retryEnd);
      const output=browser.state().receipt;assert.ok(output);assert.equal(output.replayed,true);assert.equal(output.resultHash,request.expectedResultHash);assert.equal(output.tenantId,undefined);assert.equal(browser.state().pending,null);assert.equal(await eventStatus(input.eventId),'REJECTED');assert.equal((await writebacksFor(input.eventId)).length,0);browser.dispose();
      reviewHealthy=false;root.readiness.invalidate();const unavailable=await fetch(base+'/api/v1/ready');assert.equal(unavailable.status,503);await unavailable.arrayBuffer();reviewHealthy=true;documentHealthy=true;root.readiness.invalidate();await ready();
      documentHealthy=false;root.readiness.invalidate();const deniedSource=await fetch(base+'/api/v1/ready');assert.equal(deniedSource.status,503);await deniedSource.arrayBuffer();documentHealthy=true;root.readiness.invalidate();await ready();
      stopped=await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});assert.equal(stopped.drained,true,JSON.stringify({stopped,review:root.reviewIntake.status(),drain:await durable.status(scope)}));assert.equal((await durable.status(scope)).inFlight,0);assert.equal((await durable.status(scope)).state,'DRAINED');
    }finally{reviewHealthy=true;documentHealthy=true;if(!stopped?.drained){await root.stop({actorId:'synthetic-operator',reasonHash:reason,timeoutMs:5000});root.server.closeAllConnections();}}
  });
  await t.test('V133 stale result pins cannot decide an actual adopted event',async()=>{
    const input=await adoptNew(),request=await pinnedDecision(input,{matterId:await openMatter()});
    for(const change of [{expectedResultJobId:uuid()},{expectedResultHash:'0'.repeat(64)}])await assert.rejects(reviews.decide({...request,...change}),/CONFLICT/);
    assert.equal(await eventStatus(input.eventId),'PROCESSED');assert.equal((await decisionsFor(input.eventId)).length,0);assert.equal((await writebacksFor(input.eventId)).length,0);
  });
  await t.test('V133 final review authority withdrawal rolls back decision transition and writeback',async()=>{
    const input=await adoptNew(),request=await pinnedDecision(input,{matterId:await openMatter()}),phases=[];
    const guarded=new PostgresReviewDecisions({domainOutbox:new PostgresDomainOutbox({pool:reviewerPool,expectedRole:'legaltech_reviewer_ci',authorizeAppend:async()=>true}),authorizeDecision:async c=>{phases.push(c.phase);return c.phase!=='COMMIT';}});
    await assert.rejects(guarded.decide(request),/FORBIDDEN/);assert.deepEqual(phases,['ADMIT','COMMIT']);assert.equal(await eventStatus(input.eventId),'PROCESSED');assert.equal((await decisionsFor(input.eventId)).length,0);assert.equal((await writebacksFor(input.eventId)).length,0);
  });
  await t.test('V133 simultaneous identical approvals serialize to one decision and one writeback',async()=>{
    const input=await adoptNew(),request=await pinnedDecision(input,{matterId:await openMatter()});const receipts=await Promise.all([reviews.decide(request),reviews.decide(request)]);
    assert.deepEqual(receipts.map(r=>r.replayed).sort(),[false,true]);assert.equal((await decisionsFor(input.eventId)).length,1);assert.equal((await writebacksFor(input.eventId)).length,1);
  });
  await t.test('V133 approval replay cannot acknowledge a matter that has since closed',async()=>{
    const input=await adoptNew(),matterId=await openMatter(),request=await pinnedDecision(input,{matterId});await reviews.decide(request);await admin.query("UPDATE public.matters SET status='CLOSED' WHERE id=$1",[matterId]);
    await assert.rejects(reviews.decide(request),/FORBIDDEN/);assert.equal((await decisionsFor(input.eventId)).length,1);assert.equal((await writebacksFor(input.eventId)).length,1);
  });
  await t.test('V133 widened reviewer grants and leaked review API execution fail readiness',async()=>{
    for(const table of ['inbound_events','actors']){await admin.query(`GRANT UPDATE ON public.${table} TO legaltech_reviewer_ci`);try{assert.equal((await reviews.probe()).ok,false);}finally{await admin.query(`REVOKE UPDATE ON public.${table} FROM legaltech_reviewer_ci`);}}
    await admin.query('GRANT USAGE ON SCHEMA review_security TO legaltech_runtime_ci');await admin.query('GRANT EXECUTE ON FUNCTION review_security.lock_scope(uuid,uuid,uuid) TO legaltech_runtime_ci');
    try{assert.equal((await createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})({})).ok,false);}finally{await admin.query('REVOKE EXECUTE ON FUNCTION review_security.lock_scope(uuid,uuid,uuid) FROM legaltech_runtime_ci');await admin.query('REVOKE USAGE ON SCHEMA review_security FROM legaltech_runtime_ci');}
    assert.equal((await reviews.probe()).ok,true);
  });
  await t.test('V133 tampered review function policy and conditional trigger fail readiness',async()=>{
    await admin.query('GRANT EXECUTE ON FUNCTION public.check_domain_review_decision() TO PUBLIC');try{assert.equal((await reviews.probe()).ok,false);}finally{await admin.query('REVOKE EXECUTE ON FUNCTION public.check_domain_review_decision() FROM PUBLIC');}
    const definition=(await admin.query("SELECT pg_get_functiondef('public.check_domain_review_decision()'::regprocedure) AS sql")).rows[0].sql;
    await admin.query(definition.replace('AS $function$','AS $function$\n-- synthetic tamper\n'));try{assert.equal((await reviews.probe()).ok,false);}finally{await admin.query(definition);}
    await admin.query('ALTER POLICY domain_review_append ON public.domain_review_decisions WITH CHECK(true)');try{assert.equal((await reviews.probe()).ok,false);}finally{await admin.query('ALTER POLICY domain_review_append ON public.domain_review_decisions WITH CHECK(tenant_id=public.app_current_tenant_id() AND decided_by=public.app_current_actor_id())');}
    const trigger=(await admin.query("SELECT pg_get_triggerdef(oid) AS sql FROM pg_trigger WHERE tgname='inbound_review_transition' AND tgrelid='public.inbound_events'::regclass")).rows[0].sql;
    await admin.query('DROP TRIGGER inbound_review_transition ON public.inbound_events');try{await admin.query(trigger.replace('EXECUTE FUNCTION','WHEN (false) EXECUTE FUNCTION'));assert.equal((await reviews.probe()).ok,false);}finally{await admin.query('DROP TRIGGER IF EXISTS inbound_review_transition ON public.inbound_events');await admin.query(trigger);}
    assert.equal((await reviews.probe()).ok,true);
  });
  await t.test('V133 actor revocation waits for the acknowledged review transaction',async()=>{
    const input=await adoptNew(),request=await pinnedDecision(input,{decision:'REJECT'});let finish,entered=false;const gate=new Promise(resolve=>{finish=resolve;});
    const guarded=new PostgresReviewDecisions({domainOutbox:new PostgresDomainOutbox({pool:reviewerPool,expectedRole:'legaltech_reviewer_ci',authorizeAppend:async()=>true}),authorizeDecision:async c=>{if(c.phase==='COMMIT'){entered=true;await gate;}return true;}});
    const task=guarded.decide(request);let changed=false,revocation;
    try{const end=Date.now()+5000;while(!entered&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(entered,true);
      revocation=admin.query("UPDATE public.actors SET status='DISABLED' WHERE id=$1",[actorA]).then(()=>{changed=true;});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(changed,false);finish();assert.equal((await task).status,'DECIDED');await revocation;assert.equal(changed,true);await assert.rejects(reviews.decide(request),/FORBIDDEN/);
    }finally{finish();await task.catch(()=>{});await revocation;await admin.query("UPDATE public.actors SET status='ACTIVE' WHERE id=$1",[actorA]);}
  });
  await t.test('V130 approval atomically records the decision, the APPROVED transition and one writeback intent, and replays',async()=>{
    const input=await adoptNew(),matterId=await openMatter(),request=decisionFor(input.eventId,{matterId});
    const receipt=await reviews.decide(request);assert.equal(receipt.status,'DECIDED');assert.equal(receipt.replayed,false);assert.equal(receipt.resultJobId,input.jobId);
    assert.equal(await eventStatus(input.eventId),'APPROVED');const rows=await decisionsFor(input.eventId);assert.equal(rows.length,1);assert.equal(rows[0].decided_by,actorA);assert.equal(rows[0].matter_id,matterId);
    assert.deepEqual((await writebacksFor(input.eventId)).map(r=>r.job_id),[receipt.writebackJobId]);
    const replay=await reviews.decide(request);assert.equal(replay.replayed,true);assert.equal((await decisionsFor(input.eventId)).length,1);assert.equal((await writebacksFor(input.eventId)).length,1);
  });
  await t.test('V130 rejection records the decision and the REJECTED transition with no writeback',async()=>{
    const input=await adoptNew(),receipt=await reviews.decide(decisionFor(input.eventId,{decision:'REJECT'}));
    assert.equal(receipt.writebackJobId,null);assert.equal(await eventStatus(input.eventId),'REJECTED');assert.equal((await writebacksFor(input.eventId)).length,0);
  });
  await t.test('V130 a second, different decision for a decided event is a conflict and changes nothing',async()=>{
    const input=await adoptNew(),matterId=await openMatter(),request=decisionFor(input.eventId,{matterId});await reviews.decide(request);
    await assert.rejects(reviews.decide(decisionFor(input.eventId,{decision:'REJECT'})),/REVIEW_DECISION_CONFLICT/);
    await assert.rejects(reviews.decide({...request,matterId:await openMatter()}),/REVIEW_DECISION_CONFLICT/);
    assert.equal(await eventStatus(input.eventId),'APPROVED');assert.equal((await decisionsFor(input.eventId)).length,1);assert.equal((await writebacksFor(input.eventId)).length,1);
  });
  await t.test('V130 unadopted events, closed or cross-tenant matters, service identities and withdrawn authority are denied',async()=>{
    const unadopted=await createInbound();await assert.rejects(reviews.decide(decisionFor(unadopted.eventId,{matterId:await openMatter()})),/FORBIDDEN/);
    assert.equal(await eventStatus(unadopted.eventId),'RECEIVED');await processOwn(unadopted.jobId);
    const input=await adoptNew(),closed=await openMatter();await admin.query("UPDATE public.matters SET status='CLOSED' WHERE id=$1",[closed]);
    for(const [request,setup] of [[decisionFor(input.eventId,{matterId:closed}),null],[decisionFor(input.eventId,{matterId:await openMatter(tenantB)}),null],
      [decisionFor(input.eventId,{actorId:serviceActor,matterId:await openMatter()}),null],[decisionFor(input.eventId,{matterId:await openMatter()}),'deny']]){
      if(setup==='deny')decisionAllowed=false;
      try{await assert.rejects(reviews.decide(request),/FORBIDDEN/);}finally{decisionAllowed=true;}
    }
    assert.equal(await eventStatus(input.eventId),'PROCESSED');assert.equal((await decisionsFor(input.eventId)).length,0);assert.equal((await writebacksFor(input.eventId)).length,0);
  });
  await t.test('V130 direct SQL cannot record a decision without its transition, transition without a decision, or bind a forged result',async()=>{
    const input=await adoptNew(),result=(await admin.query('SELECT * FROM public.domain_job_results WHERE job_id=$1',[input.jobId])).rows[0];
    const insert=(tx,over={})=>{const row={tenant_id:tenantA,event_id:input.eventId,result_job_id:input.jobId,result_hash:result.result_hash,decision:'REJECT',matter_id:null,decided_by:actorA,decision_key_hash:'d'.repeat(64),request_hash:'e'.repeat(64),writeback_job_id:null,...over};
      return tx.query(`INSERT INTO public.domain_review_decisions(tenant_id,event_id,result_job_id,result_hash,decision,matter_id,decided_by,decision_key_hash,request_hash,writeback_job_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,Object.values(row));};
    await assert.rejects(reviewerTransactions.run({tenantId:tenantA,actorId:actorA},tx=>insert(tx)),/UNAVAILABLE|OUTCOME_UNKNOWN/);
    await assert.rejects(reviewerTransactions.run({tenantId:tenantA,actorId:actorA},tx=>tx.query("UPDATE public.inbound_events SET status='REJECTED' WHERE id=$1",[input.eventId])),/UNAVAILABLE/);
    await assert.rejects(reviewerTransactions.run({tenantId:tenantA,actorId:actorA},async tx=>{await insert(tx,{result_hash:'c'.repeat(64)});await tx.query("UPDATE public.inbound_events SET status='REJECTED' WHERE id=$1",[input.eventId]);}),/UNAVAILABLE|OUTCOME_UNKNOWN/);
    await assert.rejects(reviewerTransactions.run({tenantId:tenantA,actorId:actorA},async tx=>{await insert(tx,{decided_by:serviceActor});await tx.query("UPDATE public.inbound_events SET status='REJECTED' WHERE id=$1",[input.eventId]);}),/UNAVAILABLE|OUTCOME_UNKNOWN/);
    assert.equal(await eventStatus(input.eventId),'PROCESSED');assert.equal((await decisionsFor(input.eventId)).length,0);
  });
  await t.test('V130 append-only grants, tenant RLS and separation of duties hold for every other principal',async()=>{
    assert.equal((await reviewerTransactions.run({tenantId:tenantB,actorId:actorB},tx=>tx.query('SELECT * FROM public.domain_review_decisions'))).rows.length,0);
    for(const sql of ['UPDATE public.domain_review_decisions SET decision=decision','DELETE FROM public.domain_review_decisions','TRUNCATE public.domain_review_decisions'])assert.equal(await reviewerPool.query(sql).then(()=>false,e=>e.code==='42501'),true);
    for(const pool of [runtime,queueWorkerPool,queueReaderPool,relayPool,domainReaderPool])assert.equal(await pool.query('SELECT * FROM public.domain_review_decisions').then(()=>false,e=>e.code==='42501'),true);
    const input=await adoptNew(),matterId=await openMatter();
    await admin.query('GRANT legaltech_domain_result_writer TO legaltech_reviewer_ci');
    try{await assert.rejects(reviews.decide(decisionFor(input.eventId,{matterId})),/REVIEW_DECISION_UNAVAILABLE/);}finally{await admin.query('REVOKE legaltech_domain_result_writer FROM legaltech_reviewer_ci');}
    assert.equal(await eventStatus(input.eventId),'PROCESSED');
  });
  await t.test('V130 a disabled decision trigger fails closed before any decision',async()=>{
    const input=await adoptNew(),matterId=await openMatter();
    await admin.query('ALTER TABLE public.domain_review_decisions DISABLE TRIGGER domain_review_decision_binding');
    try{await assert.rejects(reviews.decide(decisionFor(input.eventId,{matterId})),/REVIEW_DECISION_UNAVAILABLE/);}finally{await admin.query('ALTER TABLE public.domain_review_decisions ENABLE TRIGGER domain_review_decision_binding');}
    assert.equal((await decisionsFor(input.eventId)).length,0);
  });
  await t.test('V137 real fourteen-pool inventory reserves fleet headroom and detects live waiting pressure',async()=>{
    const entries=[['DOMAIN',runtime],['RELAY',relayPool],['PRODUCER',queueProducerPool],['WORKER',queueWorkerPool],['DOMAIN_READER',domainReaderPool],['QUEUE_READER',queueReaderPool],
      ['DRAIN_WORKER',drainWorkerPool],['DRAIN_OPERATOR',drainOperatorPool],['DRAIN_READER',drainReaderPool],['GRAPH_PRODUCER',graphProducerOptions.pool],['GRAPH_WORKER',graphWorkerOptions.pool],['GRAPH_READER',graphReaderOptions.pool],['REVIEW',reviewerPool],['REVIEW_READER',reviewReaderOptions.pool]];
    const bindings=entries.map(([name,pool])=>({name,pool})),guard=new DeploymentCapacity({profile:{...capacityProfile,maxWaitingPerPool:0},bindings});
    assert.equal(guard.status().poolCount,14);assert.equal((await guard.probe(async()=>({ok:(await queueReaderPool.query('SELECT 1 AS value')).rows[0].value===1}))).ok,true);
    assert.throws(()=>new DeploymentCapacity({profile:{...capacityProfile,maxConcurrentReplicas:100},bindings}),/BUDGET_EXCEEDED/);
    const held=[];let waiting;
    try{
      for(let i=0;i<queueReaderPool.options.max;i++)held.push(await queueReaderPool.connect());
      waiting=queueReaderPool.connect();assert.equal(queueReaderPool.waitingCount,1);
      assert.equal((await guard.probe(async()=>true)).ok,false);assert.equal(guard.status().uncertain,false);
    }finally{
      for(const client of held)client.release();if(waiting)(await waiting).release();
    }
    assert.equal((await guard.probe(async()=>true)).ok,true);
  });

});
