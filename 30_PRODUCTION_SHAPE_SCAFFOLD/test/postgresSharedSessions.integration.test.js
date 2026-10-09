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
import {createPostgresRuntimeProbe} from '../src/postgresRuntime.js';

const enabled=process.env.LEGALTECH_RUN_POSTGRES_TESTS==='true';
const tenantA='11700000-0000-4000-8000-000000000001',actorA='11700000-0000-4000-8000-000000000011';
const tenantB='11700000-0000-4000-8000-000000000002',actorB='11700000-0000-4000-8000-000000000012';
const uuid=()=>crypto.randomUUID();

test('V118 real PostgreSQL shared identity and tenant isolation',{skip:!enabled,timeout:120000},async t=>{
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

  await t.test('all 47 checksum-pinned migrations execute and actual runtime catalog verification passes',async()=>{
    assert.equal(manifest.migrations.length,47);
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
});
