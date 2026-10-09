// Mandatory security concept: V118 shared session regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {PostgresServerSessionStore} from '../src/postgresSessions.js';
import {createPostgresIdentityBoundary} from '../src/postgresIdentityBoundary.js';
import {IdentitySessionService,SessionCookieAuthProvider,InMemoryServerSessionStore,ProductionOidcAuthProvider} from '../src/productionIdentity.js';
import {createApiServer} from '../src/httpApi.js';
import {createProductionReadiness,REQUIRED_PRODUCTION_PROBES} from '../src/productionAdmission.js';

const tenantId='11800000-0000-4000-8000-000000000001',actorId='11800000-0000-4000-8000-000000000011';
const expiresAt='2099-01-01T00:00:00.000Z';
const session={tenantId,actorId,capabilities:['matter:read'],roles:[],authContext:{method:'OIDC',mfaVerified:true,authTime:null,expiresAt,providerSessionId:'synthetic-provider-session'}};
function fakeBroker({dataQuery=async()=>({rows:[]}),broker=true,role='broker'}={}) {
  const calls=[],releases=[];
  const pool={connect:async()=>({query:async(sql,values)=>{
    calls.push({sql,values});
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:role,login_role:role,tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes('AS broker,'))return {rows:[{broker,privileged:false,owns_relations:false,owns_schema:false,can_access_domain:false}]};
    return dataQuery(sql,values);
  },release:destroy=>releases.push(destroy)})};
  return {pool,calls,releases};
}
const store=(x,options={})=>new PostgresServerSessionStore({brokerPool:x.pool,expectedRole:'broker',resolveIdentity:async()=>session,providerNamespace:'https://issuer.example.invalid/tenant',timeoutMs:100,...options});
const token=()=>crypto.randomBytes(32).toString('base64url');
const binding={tenant_id:tenantId,actor_id:actorId};
const row={...binding,session_id:crypto.randomUUID(),mfa_verified:true,auth_time:null,expires_at:expiresAt};
const lookup=(sql)=>{
  if(sql.startsWith('SELECT tenant_id'))return {rows:[binding]};
  if(sql.startsWith('UPDATE identity_security.server_sessions s'))return {rows:[row]};
  return {rows:[]};
};

test('V118 shared issuance commits before returning a cookie credential and stores only token/provider hashes',async()=>{
  const x=fakeBroker({dataQuery:async sql=>sql.includes('INSERT INTO identity_security.server_sessions')?{rows:[{expires_at:expiresAt,max_age_seconds:300}]}:{rows:[]}});
  const issued=await store(x).issue(session);assert.match(issued.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(issued.maxAgeSeconds,300);
  const insert=x.calls.find(c=>c.sql.includes('INSERT INTO identity_security.server_sessions'));
  assert.match(insert.values[0],/^[a-f0-9]{64}$/);assert.match(insert.values[6],/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(x.calls).includes(issued.token),false);assert.equal(JSON.stringify(x.calls).includes('synthetic-provider-session'),false);
  assert.equal(JSON.stringify(insert.values).includes('matter:read'),false);assert.ok(x.calls.some(c=>c.sql==='COMMIT'));assert.deepEqual(x.releases,[false]);
});
test('V118 missing broker membership and wrong login fail closed before session access',async()=>{
  for(const options of [{broker:false},{role:'owner'}]) {
    const x=fakeBroker(options);await assert.rejects(store(x).issue(session),error=>error.code==='AUTH_REQUIRED');
    assert.equal(x.calls.some(c=>c.sql.includes('INSERT INTO identity_security.server_sessions')),false);assert.deepEqual(x.releases,[true]);
  }
});
test('V118 shared authentication refreshes permissions and uses stored MFA/expiry metadata',async()=>{
  const x=fakeBroker({dataQuery:async sql=>lookup(sql)});
  const current=await store(x,{resolveIdentity:async()=>({...session,capabilities:[],authContext:{method:'OIDC',mfaVerified:false,expiresAt}})}).get(token());
  assert.deepEqual(current.capabilities,[]);assert.equal(current.authContext.method,'SERVER_SESSION');assert.equal(current.authContext.mfaVerified,true);assert.equal(current.authContext.providerSessionId,null);
  assert.equal(current.sessionId,row.session_id);
});
test('V118 unknown expired revoked and malformed credentials cannot use current identity',async()=>{
  let resolutions=0;const x=fakeBroker();const s=store(x,{resolveIdentity:async()=>{resolutions++;return session}});
  for(const credential of [token(),'too-short',"';SELECT 1;",'A'.repeat(44)])await assert.rejects(s.get(credential),error=>error.code==='AUTH_REQUIRED');
  assert.equal(resolutions,0);
});
test('V118 revocation or expiry during asynchronous identity resolution blocks final authentication',async()=>{
  let initial=false;const x=fakeBroker({dataQuery:async sql=>{if(sql.startsWith('SELECT tenant_id')){initial=true;return {rows:[binding]}}return {rows:[]}}});
  await assert.rejects(store(x).get(token()),error=>error.code==='AUTH_REQUIRED');assert.equal(initial,true);
  assert.equal(x.calls.some(c=>c.sql.startsWith('UPDATE identity_security.server_sessions s')),true);assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);
});
test('V118 directory outages and changed actor/tenant binding cannot grant authority',async()=>{
  for(const resolveIdentity of [async()=>{throw new Error('SECRET_DIRECTORY_FAILURE')},async()=>({...session,actorId:'11800000-0000-4000-8000-000000000012'}),async()=>({...session,tenantId:'11800000-0000-4000-8000-000000000002'})]) {
    const x=fakeBroker({dataQuery:async sql=>lookup(sql)});await assert.rejects(store(x,{resolveIdentity}).get(token()),error=>error.code==='AUTH_REQUIRED');
    assert.equal(x.calls.some(c=>c.sql.startsWith('UPDATE identity_security.server_sessions s')),false);
  }
});
test('V118 session revocation reports success only after shared commit',async()=>{
  const x=fakeBroker({dataQuery:async sql=>sql.startsWith('UPDATE identity_security.server_sessions SET')?{rows:[{token_hash:'synthetic-hash'}]}:{rows:[]}});
  assert.equal(await store(x).revoke(token()),true);assert.ok(x.calls.some(c=>c.sql==='COMMIT'));
  const failed=fakeBroker({dataQuery:async sql=>{if(sql==='COMMIT')throw new Error('SECRET_CONNECTION_FAILURE');return {rows:[{}]}}});
  await assert.rejects(store(failed).revoke(token()),error=>error.code==='AUTH_REQUIRED');assert.deepEqual(failed.releases,[true]);
});
test('V118 provider revocation tombstone and existing-session revocation share one transaction',async()=>{
  const x=fakeBroker({dataQuery:async sql=>sql.startsWith('UPDATE identity_security.server_sessions SET')?{rows:[{},{}]}:{rows:[]}});
  assert.equal(await store(x).revokeProviderSession('synthetic-provider-session'),2);
  const statements=x.calls.map(c=>c.sql);assert.ok(statements.findIndex(s=>s.startsWith('INSERT INTO identity_security.provider_session_revocations'))<statements.findIndex(s=>s.startsWith('UPDATE identity_security.server_sessions SET')));
  assert.ok(statements.includes('COMMIT'));assert.equal(JSON.stringify(x.calls).includes('synthetic-provider-session'),false);
});
test('V118 issuer namespace separates matching provider session IDs',async()=>{
  const a=fakeBroker(),b=fakeBroker();await store(a).revokeProviderSession('shared-sid');await store(b,{providerNamespace:'https://issuer.example.invalid/other'}).revokeProviderSession('shared-sid');
  assert.notEqual(a.calls.find(c=>c.sql.startsWith('INSERT INTO identity_security.provider_session_revocations')).values[0],b.calls.find(c=>c.sql.startsWith('INSERT INTO identity_security.provider_session_revocations')).values[0]);
});
test('V118 asynchronous containment failure stops issuance and failed async logout cannot claim sign-out',async()=>{
  let issued=0;const service=new IdentitySessionService({oidcAuthProvider:{authenticate:async()=>session},sessionStore:{get:async()=>session,issue:async()=>{issued++;return {}},revoke:async()=>{throw new Error('BROKER_DOWN')}},allowedOrigin:'https://app.example.invalid',securityInterlock:{assertAllowed:async()=>{throw new Error('CONTAINED')}}});
  await assert.rejects(service.exchange({}),/CONTAINED/);assert.equal(issued,0);
  await assert.rejects(service.logout({cookie:`__Host-legaltech_session=${token()}`,origin:'https://app.example.invalid'}),/BROKER_DOWN/);
});
test('V118 async issue and revoke are awaited before the exchange/logout result',async()=>{
  const issuedToken=token();let revoked=false;
  const service=new IdentitySessionService({oidcAuthProvider:{authenticate:async()=>session},sessionStore:{get:async()=>session,issue:async()=>({token:issuedToken,expiresAt,maxAgeSeconds:300}),revoke:async()=>{await Promise.resolve();revoked=true}},allowedOrigin:'https://app.example.invalid'});
  assert.ok((await service.exchange({})).setCookie.includes(issuedToken));
  const result=await service.logout({cookie:`__Host-legaltech_session=${issuedToken}`,origin:'https://app.example.invalid'});assert.equal(revoked,true);assert.match(result.setCookie,/Max-Age=0/);
});
test('V118 production rejects hidden in-memory cookie and exchange session adapters',()=>{
  const readiness=createProductionReadiness({probes:Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(name=>[name,async()=>true]))});
  const memory=new InMemoryServerSessionStore(),cookieAuth=new SessionCookieAuthProvider({store:memory,allowedOrigin:'https://app.example.invalid'});
  const exchange=new IdentitySessionService({oidcAuthProvider:{authenticate:async()=>session},sessionStore:memory,allowedOrigin:'https://app.example.invalid'});
  const options={productionMode:true,readiness,platform:{},authProvider:{authenticate:async()=>session},abuseLimiter:{checkIp(){},checkTenant(){},checkRead(){}}};
  for(const extra of [{authProvider:cookieAuth},{identitySessionService:exchange}])assert.throws(()=>createApiServer({...options,...extra}),/REFERENCE_ADAPTER_FORBIDDEN/);
});
test('V118 shared identity factory binds cookie exchange and SESSION_STORE probe to one PostgreSQL store',()=>{
  const x=fakeBroker(),oidc=new ProductionOidcAuthProvider({verifier:{verify:async()=>({})},resolveIdentity:async()=>session});
  const identity=createPostgresIdentityBoundary({brokerPool:x.pool,expectedBrokerRole:'broker',resolveIdentity:async()=>session,providerNamespace:'https://issuer.example.invalid',oidcAuthProvider:oidc,allowedOrigin:'https://app.example.invalid',securityInterlock:{assertAllowed:async()=>{}}});
  assert.ok(identity.sessionStore instanceof PostgresServerSessionStore);assert.ok(identity.authProvider instanceof SessionCookieAuthProvider);assert.ok(identity.identitySessionService instanceof IdentitySessionService);assert.equal(typeof identity.sessionProbe,'function');assert.equal(Object.isFrozen(identity),true);
  assert.throws(()=>createPostgresIdentityBoundary({}),/CONFIGURATION_INVALID/);
});
test('V118 shared session probe requires both forced-RLS tables and narrowly scoped write permissions',async()=>{
  for(const writableExpiry of [false,true]) {
    const x=fakeBroker({dataQuery:async sql=>{
      if(sql.startsWith('SELECT c.relname'))return {rows:[{relrowsecurity:true,relforcerowsecurity:true,active:true},{relrowsecurity:true,relforcerowsecurity:true,active:true}]};
      if(sql.startsWith('SELECT has_table_privilege'))return {rows:[{can_read:true,can_issue:true,can_touch:true,can_revoke:true,can_rewrite:writableExpiry,can_remove:false,can_read_revocations:true,can_record_revocations:true,can_remove_revocations:false}]};
      return {rows:[]};
    }});
    const result=await store(x).probe();assert.equal(result.ok,!writableExpiry);
  }
});
test('V118 shared database outage fails authentication and readiness without local fallback',async()=>{
  const s=new PostgresServerSessionStore({brokerPool:{connect:async()=>{throw new Error('SECRET_PROVIDER_CONNECTION')}},expectedRole:'broker',resolveIdentity:async()=>session,providerNamespace:'https://issuer.example.invalid'});
  await assert.rejects(s.get(token()),error=>error.code==='AUTH_REQUIRED');assert.deepEqual(await s.probe(),{ok:false,code:'SHARED_SESSION_STORE_UNAVAILABLE'});
});
