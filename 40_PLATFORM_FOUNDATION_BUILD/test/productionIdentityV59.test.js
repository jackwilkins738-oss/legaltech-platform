import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  JwksClient,OidcJwtVerifier,ProductionOidcAuthProvider,InMemoryServerSessionStore,
  SessionCookieAuthProvider,IdentitySessionService,PRODUCTION_SESSION_COOKIE_NAME
} from '../src/productionIdentity.js';
import {requireRecentStepUp} from '../src/auth.js';
import {createApiServer} from '../src/httpApi.js';

const issuer='https://login.example.test/tenant/v2.0';
const audience='api://legaltech';
const directoryTenantId='directory-a';
const now=Date.parse('2026-10-08T12:00:00.000Z');
const seconds=ms=>Math.floor(ms/1000);
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const publicJwk=pair.publicKey.export({format:'jwk'});
const jwk={...publicJwk,kid:'kid-1',use:'sig',alg:'RS256'};
function b64(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function sign(extra={},headerExtra={}){
  const header={alg:'RS256',typ:'JWT',kid:'kid-1',...headerExtra};
  const claims={iss:issuer,aud:audience,tid:directoryTenantId,oid:'object-1',sub:'subject-1',sid:'provider-session-1',iat:seconds(now-60_000),nbf:seconds(now-60_000),exp:seconds(now+60*60_000),auth_time:seconds(now-2*60_000),amr:['pwd','mfa'],...extra};
  const input=`${b64(header)}.${b64(claims)}`;
  const signature=crypto.sign('RSA-SHA256',Buffer.from(input,'ascii'),pair.privateKey).toString('base64url');
  return `${input}.${signature}`;
}
function fetchJwks(counter){return async()=>{counter.calls++;return new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'content-type':'application/json'}});};}
function verifier(counter={calls:0}){
  const client=new JwksClient({jwksUri:'https://login.example.test/tenant/discovery/v2.0/keys',issuer,fetchImpl:fetchJwks(counter),clock:()=>now});
  return {counter,verifier:new OidcJwtVerifier({issuer,audience,allowedDirectoryTenantIds:[directoryTenantId],jwksClient:client,clock:()=>now})};
}

test('V59 verifies RS256 OIDC token against bounded same-origin JWKS and caches keys',async()=>{
  const x=verifier();
  const first=await x.verifier.verify(sign());
  const second=await x.verifier.verify(sign({sub:'subject-2'}));
  assert.equal(first.directoryTenantId,directoryTenantId);
  assert.equal(first.objectId,'object-1');
  assert.equal(first.mfaVerified,true);
  assert.equal(second.subject,'subject-2');
  assert.equal(x.counter.calls,1);
});

test('V59 rejects algorithm confusion before any JWKS network call',async()=>{
  const x=verifier();
  const token=sign({}, {alg:'HS256'});
  await assert.rejects(x.verifier.verify(token),e=>e.code==='AUTH_REQUIRED');
  assert.equal(x.counter.calls,0);
});

test('V59 rejects forged signature, issuer, audience, expiry and foreign directory tenant',async()=>{
  for(const token of [
    (()=>{const [h,payload,sig]=sign().split('.');const bytes=Buffer.from(sig,'base64url');bytes[0]^=1;return `${h}.${payload}.${bytes.toString('base64url')}`;})(),
    sign({iss:'https://evil.example.test/tenant/v2.0'}),
    sign({aud:'api://other'}),
    sign({exp:seconds(now-120_000)}),
    sign({tid:'directory-b'}),
  ]){
    const x=verifier();
    await assert.rejects(x.verifier.verify(token),e=>['AUTH_REQUIRED','OIDC_CLAIMS_INVALID'].includes(e.code));
  }
});

test('V59 rejects attacker-controlled JWK URLs and cross-origin JWKS configuration',async()=>{
  const x=verifier();
  const injected=sign({}, {jku:'https://evil.example.test/jwks'});
  await assert.rejects(x.verifier.verify(injected),e=>e.code==='AUTH_REQUIRED');
  assert.throws(()=>new JwksClient({jwksUri:'https://evil.example.test/jwks',issuer,fetchImpl:async()=>null}),e=>e.code==='AUTH_CONFIGURATION_INVALID');
});

test('V59 application privileges come from trusted resolver, never token roles/capabilities',async()=>{
  const x=verifier();let seen;
  const auth=new ProductionOidcAuthProvider({verifier:x.verifier,resolveIdentity:async identity=>{seen=identity;return {tenantId:'tenant-internal',actorId:'actor-internal',roles:['CASE_HANDLER'],capabilities:['matter:read'],securityZoneIds:[],matterMembershipIds:[],documentAccessRefs:[]};}});
  const token=sign({roles:['GLOBAL_ADMIN'],capabilities:['integration:manage','matter:break_glass'],tenant_id:'forged-internal-tenant'});
  const session=await auth.authenticate({authorization:`Bearer ${token}`});
  assert.equal(seen.directoryTenantId,directoryTenantId);
  assert.equal(session.tenantId,'tenant-internal');
  assert.deepEqual(session.roles,['CASE_HANDLER']);
  assert.deepEqual(session.capabilities,['matter:read']);
  assert.equal(session.authContext.method,'OIDC');
  assert.equal(session.authContext.mfaVerified,true);
  assert.doesNotMatch(JSON.stringify(seen),/GLOBAL_ADMIN|integration:manage|forged-internal-tenant/);
});

test('V59 recent step-up requires verified MFA and fresh auth_time',async()=>{
  const x=verifier();
  const auth=new ProductionOidcAuthProvider({verifier:x.verifier,resolveIdentity:async()=>({tenantId:'tenant-a',actorId:'actor-a'})});
  const fresh=await auth.authenticate({authorization:`Bearer ${sign()}`});
  assert.equal(requireRecentStepUp(fresh,{now,maxAgeMs:5*60_000}),true);
  const stale=await auth.authenticate({authorization:`Bearer ${sign({auth_time:seconds(now-10*60_000)})}`});
  assert.throws(()=>requireRecentStepUp(stale,{now,maxAgeMs:5*60_000}),e=>e.code==='STEP_UP_REQUIRED');
  const noMfa=await auth.authenticate({authorization:`Bearer ${sign({amr:['pwd']})}`});
  assert.throws(()=>requireRecentStepUp(noMfa,{now}),e=>e.code==='STEP_UP_REQUIRED');
});

test('V59 opaque server sessions expire, idle out and revoke without exposing provider bearer token',()=>{
  let clock=now;
  const store=new InMemoryServerSessionStore({clock:()=>clock,absoluteTtlMs:10*60_000,idleTtlMs:2*60_000});
  const issued=store.issue({tenantId:'tenant-a',actorId:'actor-a',capabilities:['matter:read'],authContext:{method:'OIDC',mfaVerified:true,authTime:new Date(now).toISOString(),expiresAt:new Date(now+30*60_000).toISOString(),providerSessionId:'sid-1'}});
  assert.match(issued.token,/^[A-Za-z0-9_-]{40,}$/);
  assert.equal(store.get(issued.token).authContext.method,'SERVER_SESSION');
  clock+=60_000;assert.equal(store.get(issued.token).actorId,'actor-a');
  clock+=121_000;assert.throws(()=>store.get(issued.token),e=>e.code==='AUTH_REQUIRED');
  const again=store.issue({tenantId:'tenant-a',actorId:'actor-a',authContext:{method:'OIDC',mfaVerified:false,authTime:null,expiresAt:new Date(now+30*60_000).toISOString(),providerSessionId:'sid-revoke'}});
  assert.equal(store.revokeProviderSession('sid-revoke'),1);
  assert.throws(()=>store.get(again.token),e=>e.code==='AUTH_REQUIRED');
});

test('V59 cookie auth rejects bearer ambiguity and cross-site unsafe requests',async()=>{
  const store=new InMemoryServerSessionStore({clock:()=>now});
  const issued=store.issue({tenantId:'tenant-a',actorId:'actor-a'});
  const auth=new SessionCookieAuthProvider({store,allowedOrigin:'https://app.example.test'});
  const cookie=`${PRODUCTION_SESSION_COOKIE_NAME}=${issued.token}`;
  assert.equal((await auth.authenticate({cookie},{method:'GET'})).actorId,'actor-a');
  await assert.rejects(auth.authenticate({cookie,authorization:'Bearer bad'},{method:'GET'}),e=>e.code==='AUTH_REQUIRED');
  await assert.rejects(auth.authenticate({cookie,origin:'https://evil.example.test'},{method:'POST'}),e=>e.code==='CSRF_CHECK_FAILED');
  assert.equal((await auth.authenticate({cookie,origin:'https://app.example.test','sec-fetch-site':'same-origin'},{method:'POST'})).tenantId,'tenant-a');
});

test('V59 identity exchange issues hardened __Host cookie and logout revokes it',async()=>{
  const x=verifier();
  const oidc=new ProductionOidcAuthProvider({verifier:x.verifier,resolveIdentity:async()=>({tenantId:'tenant-a',actorId:'actor-a',capabilities:['matter:read']})});
  const store=new InMemoryServerSessionStore({clock:()=>now});
  const service=new IdentitySessionService({oidcAuthProvider:oidc,sessionStore:store,allowedOrigin:'https://app.example.test'});
  const exchanged=await service.exchange({authorization:`Bearer ${sign()}`});
  assert.match(exchanged.setCookie,/^__Host-legaltech_session=[A-Za-z0-9_-]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Strict$/);
  const cookie=exchanged.setCookie.split(';',1)[0];
  const provider=new SessionCookieAuthProvider({store,allowedOrigin:'https://app.example.test'});
  assert.equal((await provider.authenticate({cookie},{method:'GET'})).actorId,'actor-a');
  const loggedOut=await service.logout({cookie,origin:'https://app.example.test'});
  assert.match(loggedOut.setCookie,/Max-Age=0/);
  await assert.rejects(provider.authenticate({cookie},{method:'GET'}),e=>e.code==='AUTH_REQUIRED');
});

test('V59 HTTP session exchange moves normal API use from bearer token to opaque cookie',async t=>{
  const x=verifier();
  const oidc=new ProductionOidcAuthProvider({verifier:x.verifier,resolveIdentity:async()=>({tenantId:'tenant-a',actorId:'actor-a',capabilities:['matter:read']})});
  const store=new InMemoryServerSessionStore({clock:()=>now});
  const service=new IdentitySessionService({oidcAuthProvider:oidc,sessionStore:store,allowedOrigin:'https://app.example.test'});
  const auth=new SessionCookieAuthProvider({store,allowedOrigin:'https://app.example.test'});
  const platform={listMatters:()=>[],getMatter:()=>null};
  const server=createApiServer({platform,authProvider:auth,identitySessionService:service});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  const exchange=await fetch(base+'/api/v1/auth/session',{method:'POST',headers:{authorization:`Bearer ${sign()}`}});
  assert.equal(exchange.status,200);
  const setCookie=exchange.headers.get('set-cookie');assert.ok(setCookie);
  const cookie=setCookie.split(';',1)[0];
  const matters=await fetch(base+'/api/v1/matters',{headers:{cookie}});
  assert.equal(matters.status,200);assert.deepEqual(await matters.json(),{items:[],next_cursor:null});
  const logout=await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{cookie,origin:'https://app.example.test','sec-fetch-site':'same-origin'}});
  assert.equal(logout.status,200);
  assert.equal((await fetch(base+'/api/v1/matters',{headers:{cookie}})).status,401);
});
