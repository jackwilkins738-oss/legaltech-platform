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
import {createPostgresRuntimeProbe} from '../src/postgresRuntime.js';

const enabled=process.env.LEGALTECH_RUN_POSTGRES_TESTS==='true';
const tenantA='11700000-0000-4000-8000-000000000001',actorA='11700000-0000-4000-8000-000000000011';
const tenantB='11700000-0000-4000-8000-000000000002',actorB='11700000-0000-4000-8000-000000000012';
const uuid=()=>crypto.randomUUID();

test('V118/V119 real PostgreSQL shared identity, security and tenant isolation',{skip:!enabled,timeout:120000},async t=>{
  if(process.env.PGDATABASE!=='legaltech_security_ci')throw new Error('EMPTY_SYNTHETIC_CI_DATABASE_REQUIRED');
  const {Pool}=await import('pg');
  const base={host:process.env.PGHOST??'127.0.0.1',port:Number(process.env.PGPORT??5432),database:process.env.PGDATABASE,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,max:2};
  const {PGPASSWORD:adminPassword}=process.env;
  const admin=new Pool({...base,user:process.env.PGUSER,password:adminPassword});
  admin.on('error',()=>{});
  const pools=[admin];
  t.after(async()=>{await Promise.all(pools.map(pool=>pool.end()))});
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
  for(const [login,group] of [['legaltech_reader_ci','legaltech_security_reader'],['legaltech_operator_ci','legaltech_security_operator'],['legaltech_limiter_ci','legaltech_rate_limiter']]){
    await admin.query(`CREATE ROLE ${login} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await admin.query(`GRANT ${group} TO ${login}`);
  }
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await admin.query('GRANT USAGE ON SCHEMA public TO legaltech_runtime_ci');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON public.matters TO legaltech_runtime_ci');
  await admin.query('GRANT SELECT ON public.matter_actor_access,public.matter_break_glass_grants,public.actor_security_zones TO legaltech_runtime_ci');
  const makePool=(user,max=1)=>{const pool=new Pool({...base,user,password,max});pool.on('error',()=>{});pools.push(pool);return pool};
  const runtime=makePool('legaltech_runtime_ci',2),runtimeSingle=makePool('legaltech_runtime_ci'),brokerOne=makePool('legaltech_broker_ci'),brokerTwo=makePool('legaltech_broker_ci');
  const transactions=new PostgresTenantTransactions({pool:runtime,expectedRole:'legaltech_runtime_ci'});
  let capabilities=['matter:read'],resolve=async({tenantId,actorId})=>({tenantId,actorId,capabilities,roles:[]});
  const options={expectedRole:'legaltech_broker_ci',providerNamespace:'https://issuer.example.invalid/tenant',resolveIdentity:(...args)=>resolve(...args),timeoutMs:5000};
  const one=new PostgresServerSessionStore({...options,brokerPool:brokerOne}),two=new PostgresServerSessionStore({...options,brokerPool:brokerTwo});
  const session=(providerSessionId=`provider-${uuid()}`)=>({tenantId:tenantA,actorId:actorA,capabilities:['matter:read'],roles:[],authContext:{method:'OIDC',mfaVerified:true,authTime:null,expiresAt:new Date(Date.now()+3600000).toISOString(),providerSessionId}});

  await t.test('all 48 checksum-pinned migrations execute and actual runtime catalog verification passes',async()=>{
    assert.equal(manifest.migrations.length,48);
    const result=await createPostgresRuntimeProbe({pool:runtime,expectedRole:'legaltech_runtime_ci'})({});assert.equal(result.ok,true);
    assert.equal((await one.probe()).ok,true);
    const hidden=await runtime.query('SELECT * FROM identity_security.server_sessions').then(()=>false,error=>error.code==='42501');assert.equal(hidden,true);
    assert.equal(await brokerOne.query('SELECT * FROM public.matters').then(()=>false,error=>error.code==='42501'),true);
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
    await assert.rejects(operator.release({tenantId:tenantA,actorId:actorA,control:'ALL_EGRESS',traceId:'release',resolutionCode:'RESOLVED'}),/DUAL_CONTROL/);
    authorized=false;await assert.rejects(operator.activate({...activation,control:'NEW_SESSION'}),/FORBIDDEN/);authorized=true;
    // A second authorised actor in the same tenant is required by the composite FK.
    const second=uuid();await admin.query("INSERT INTO public.actors(id,tenant_id,actor_type) VALUES($1,$2,'USER')",[second,tenantA]);
    await operator.release({tenantId:tenantA,actorId:second,control:'ALL_EGRESS',traceId:'release',resolutionCode:'RESOLVED'});
    assert.equal(await gateTwo.assertAllowed({tenantId:tenantA,operation:'EXPORT'}),true);
    const events=await readerOne.query('SELECT event_type FROM operational_security.interlock_events WHERE interlock_id=$1 ORDER BY at',[active.id]);
    assert.deepEqual(events.rows.map(x=>x.event_type),['INTERLOCK_ACTIVATED','INTERLOCK_RELEASED']);
    const reactivated=await operator.activate(activation);assert.notEqual(reactivated.id,active.id);
    const concurrent=await Promise.all([operator.activate(activation),operatorTwo.activate(activation)]);assert.ok(concurrent.every(x=>x.replayed));
    assert.equal((await readerOne.query('SELECT event_id FROM operational_security.interlock_events WHERE interlock_id=$1',[reactivated.id])).rows.length,1);
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

});
