// Mandatory security concept: V117 production admission regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApiServer} from '../src/httpApi.js';
import {ReadinessCoordinator} from '../src/readiness.js';
import {REQUIRED_PRODUCTION_PROBES,createProductionReadiness,isProductionReadiness} from '../src/productionAdmission.js';
import {StaticAuthProvider} from '../src/auth.js';
import {InMemoryAbuseLimiter} from '../src/abuseControl.js';
import {PlatformStore} from '../src/store.js';
import {Platform} from '../src/platform.js';
import {appError} from '../src/errors.js';

const session={tenantId:'tenant-a',actorId:'user-a',sessionId:'session-a',capabilities:['matter:read'],roles:[],authContext:{method:'OIDC',mfaVerified:true}};
const probes=()=>Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(name=>[name,async()=>true]));
const productionReadiness=()=>createProductionReadiness({probes:probes(),probeTimeoutMs:100});
const limiter=()=>({checkIp:async()=>{},checkTenant:async()=>{},checkRead:async()=>{}});
function adapters(options={}) {
  return {platform:{store:{audit(){}},listMatters:()=>[]},authProvider:{authenticate:async()=>session},abuseLimiter:limiter(),...options};
}
async function withServer(options,run) {
  const server=createApiServer(adapters(options));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}

test('V117 production cannot opt out of required registered readiness',()=>{
  for(const readiness of [null,{publicStatus:async()=>({status:'READY'})},new ReadinessCoordinator({checks:[{name:'DB',probe:async()=>true}]})]) {
    assert.throws(()=>createApiServer(adapters({productionMode:true,readiness})),/PRODUCTION_READINESS_REQUIRED/);
  }
  const previous=process.env.NODE_ENV;
  try { process.env.NODE_ENV='production';assert.throws(()=>createApiServer(adapters({productionMode:false})),/PRODUCTION_READINESS_REQUIRED/); }
  finally { if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous; }
});
test('V117 production coverage cannot omit weaken or replace required probes',async()=>{
  for(const name of REQUIRED_PRODUCTION_PROBES) {
    const missing=probes();delete missing[name];assert.throws(()=>createProductionReadiness({probes:missing}),/PROBES_REQUIRED/);
    const failed=probes();failed[name]=async()=>false;
    const ready=createProductionReadiness({probes:failed,probeTimeoutMs:100});
    assert.deepEqual(await ready.publicStatus(),{status:'NOT_READY'});
  }
  assert.throws(()=>createProductionReadiness({probes:{...probes(),EXTRA:async()=>true}}),/PROBES_REQUIRED/);
  assert.throws(()=>createProductionReadiness({probes:probes(),cacheTtlMs:1001}),/CACHE_INVALID/);
  const ready=productionReadiness();assert.equal(isProductionReadiness(ready),true);
  assert.equal(isProductionReadiness({...ready}),false);
  assert.throws(()=>{ready.publicStatus=async()=>({status:'READY'});},TypeError);
});
test('V117 production rejects synthetic platform storage auth local limiting and dev workers',()=>{
  const readiness=productionReadiness(),base=adapters({readiness,productionMode:true});
  for(const extra of [{devWorkers:true},{platform:Object.create(Platform.prototype)},
    {platform:{store:Object.create(PlatformStore.prototype)}},{authProvider:new StaticAuthProvider()},
    {abuseLimiter:new InMemoryAbuseLimiter()}]) {
    assert.throws(()=>createApiServer({...base,...extra}),/REFERENCE_ADAPTER_FORBIDDEN/);
  }
  assert.throws(()=>createApiServer({...base,abuseLimiter:{checkIp(){},checkTenant(){}}}),/API_ADAPTER_REQUIRED/);
});
test('V117 unavailable readiness blocks reads writes sessions and unknown routes before auth or mutation',async()=>{
  let auth=0,exchange=0,logout=0,mutations=0;
  await withServer({readiness:{publicStatus:async()=>({status:'NOT_READY'})},
    authProvider:{authenticate:async()=>{auth++;return session}},
    platform:{listMatters:()=>{mutations++;return []}},
    identitySessionService:{exchange:async()=>{exchange++;return {}},logout:()=>{logout++;return {}}}},async base=>{
    for(const [method,route] of [['GET','/api/v1/matters'],['POST','/api/v1/inbound'],['POST','/api/v1/auth/session'],['POST','/api/v1/auth/logout'],['GET','/api/v1/new-route']]) {
      const r=await fetch(base+route,{method});assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'NOT_READY'});assert.equal(r.headers.get('retry-after'),'1');
    }
    assert.equal((await fetch(base+'/api/v1/health')).status,200);
    assert.equal((await fetch(base+'/api/v1/ready')).status,503);
  });
  assert.deepEqual([auth,exchange,logout,mutations],[0,0,0,0]);
});
test('V117 throwing malformed and hanging readiness fail closed without provider details',async()=>{
  for(const publicStatus of [async()=>{throw new Error('SENSITIVE_PROVIDER_FAILURE')},async()=>({status:'READYISH',secret:'SENSITIVE_PROVIDER_FAILURE'}),async()=>null,()=>new Promise(()=>{})]) {
    await withServer({readiness:{publicStatus},readinessTimeoutMs:100},async base=>{
      const r=await fetch(base+'/api/v1/matters');assert.equal(r.status,503);assert.equal((await r.text()).includes('SENSITIVE_PROVIDER_FAILURE'),false);
    });
  }
});
test('V117 ready degraded and absent synthetic readiness retain intended behaviour',async()=>{
  for(const readiness of [null,{publicStatus:async()=>({status:'READY'})},{publicStatus:async()=>({status:'DEGRADED'})}]) {
    await withServer({readiness},async base=>assert.equal((await fetch(base+'/api/v1/matters')).status,200));
  }
});
test('V117 production accepts verified session context and rejects wrapped static sessions',async()=>{
  for(const method of ['OIDC','SERVER_SESSION','STATIC']) {
    await withServer({productionMode:true,readiness:productionReadiness(),authProvider:{authenticate:async()=>({...session,authContext:{method,mfaVerified:false}})}},async base=>{
      const r=await fetch(base+'/api/v1/matters');assert.equal(r.status,method==='STATIC'?401:200);
    });
  }
});
test('V117 readiness failure during authentication blocks data dispatch',async()=>{
  let ready=true,reads=0;
  await withServer({readiness:{publicStatus:async()=>({status:ready?'READY':'NOT_READY'})},
    authProvider:{authenticate:async()=>{ready=false;return session}},platform:{listMatters:()=>{reads++;return []}}},async base=>{
    assert.equal((await fetch(base+'/api/v1/matters')).status,503);
  });assert.equal(reads,0);
});
test('V117 failed readiness during session exchange suppresses cookie issuance',async()=>{
  let ready=true;
  await withServer({readiness:{publicStatus:async()=>({status:ready?'READY':'NOT_READY'})},identitySessionService:{exchange:async()=>{ready=false;return {expiresAt:'2099-01-01',setCookie:'SECRET_COOKIE'}}}},async base=>{
    const r=await fetch(base+'/api/v1/auth/session',{method:'POST'});assert.equal(r.status,503);assert.equal(r.headers.get('set-cookie'),null);
  });
});
test('V117 invalidation prevents an older concurrent healthy probe from restoring admission',async()=>{
  let resolveOld,started,calls=0;
  const start=new Promise(resolve=>{started=resolve});
  const ready=new ReadinessCoordinator({checks:[{name:'DATABASE',probe:async()=>{calls++;if(calls===1){started();return new Promise(resolve=>{resolveOld=resolve})}return false}}],probeTimeoutMs:100,cacheTtlMs:250});
  const one=ready.publicStatus(),two=ready.publicStatus();await start;
  ready.invalidate();assert.equal((await ready.publicStatus()).status,'NOT_READY');resolveOld(true);
  assert.equal((await one).status,'NOT_READY');assert.equal((await two).status,'NOT_READY');
  assert.equal((await ready.publicStatus()).status,'NOT_READY');assert.equal(calls,2);
});
test('V117 concurrent request admission coalesces probes and invalidation closes every request',async()=>{
  let ready=true,calls=0;
  const checks=probes();checks.DATABASE_RUNTIME=async()=>{calls++;return ready};
  const readiness=createProductionReadiness({probes:checks,probeTimeoutMs:100});
  await withServer({productionMode:true,readiness},async base=>{
    assert.ok((await Promise.all(Array.from({length:12},()=>fetch(base+'/api/v1/matters')))).every(r=>r.status===200));assert.equal(calls,1);
    ready=false;readiness.invalidate();assert.ok((await Promise.all(Array.from({length:12},()=>fetch(base+'/api/v1/matters')))).every(r=>r.status===503));assert.equal(calls,2);
  });
});
test('V117 asynchronous IP tenant and read limit rejection stops dispatch or disclosure',async()=>{
  for(const method of ['checkIp','checkTenant','checkRead']) {
    const abuseLimiter=limiter();abuseLimiter[method]=async()=>{await Promise.resolve();throw appError('rate limit exceeded',{status:429,code:'RATE_LIMITED'})};
    let reads=0;
    await withServer({abuseLimiter,platform:{listMatters:()=>{reads++;return [{id:'m1',tenantId:'tenant-a',visibility:'STANDARD'}]}}},async base=>{
      const r=await fetch(base+'/api/v1/matters');assert.equal(r.status,429);assert.equal((await r.text()).includes('m1'),false);
    });assert.equal(reads,method==='checkRead'?1:0);
  }
});
test('V117 asynchronous integration attempt audit failure prevents connector mutation',async()=>{
  let mutations=0;
  const integrations={registry:{get:()=>true},graph:{tenantId:'tenant-a',createMailboxSubscription:()=>{mutations++}}};
  const platform={store:{audit:async()=>{throw new Error('SECRET_AUDIT_FAILURE')}}};
  const actor={...session,capabilities:['integration:manage']};
  await withServer({platform,integrations,authProvider:{authenticate:async()=>actor}},async base=>{
    const r=await fetch(base+'/api/v1/integrations/graph/subscriptions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mailboxId:'synthetic-mailbox'})});
    assert.equal(r.status,500);assert.equal((await r.text()).includes('SECRET_AUDIT_FAILURE'),false);
  });assert.equal(mutations,0);
});
test('V117 critical dependency timeout blocks production while liveness remains available',async()=>{
  const checks=probes();checks.AUDIT_SINK=()=>new Promise(()=>{});
  const readiness=createProductionReadiness({probes:checks,probeTimeoutMs:100});
  await withServer({productionMode:true,readiness},async base=>{
    assert.equal((await fetch(base+'/api/v1/matters')).status,503);
    assert.equal((await fetch(base+'/api/v1/health')).status,200);
  });
});
test('V117 bounded cache expires and dependency recovery restores admission',async()=>{
  let now=1000,ready=true;const checks=probes();checks.QUEUE=async()=>ready;
  const readiness=createProductionReadiness({probes:checks,now:()=>now,probeTimeoutMs:100});
  await withServer({productionMode:true,readiness},async base=>{
    assert.equal((await fetch(base+'/api/v1/matters')).status,200);
    ready=false;now+=251;assert.equal((await fetch(base+'/api/v1/matters')).status,503);
    ready=true;readiness.invalidate();assert.equal((await fetch(base+'/api/v1/matters')).status,200);
  });
});
test('V117 dependency failure during async tenant admission cannot serve data',async()=>{
  let ready=true,reads=0;const abuseLimiter=limiter();abuseLimiter.checkTenant=async()=>{ready=false};
  await withServer({readiness:{publicStatus:async()=>({status:ready?'READY':'NOT_READY'})},abuseLimiter,platform:{listMatters:()=>{reads++;return []}}},async base=>{
    assert.equal((await fetch(base+'/api/v1/matters')).status,503);
  });assert.equal(reads,0);
});
test('V117 awaiting asynchronous security read monitoring blocks provider failure disclosure',async()=>{
  await withServer({platform:{listMatters:()=>[{id:'m1',tenantId:'tenant-a',visibility:'STANDARD'}],securityMonitor:{observeRead:async()=>{throw new Error('SECRET_PROVIDER_FAILURE')}}}},async base=>{
    const r=await fetch(base+'/api/v1/matters');assert.equal(r.status,500);const text=await r.text();assert.equal(text.includes('m1'),false);assert.equal(text.includes('SECRET_PROVIDER_FAILURE'),false);
  });
});
test('V117 production health and readiness do not depend on the failed shared IP limiter',async()=>{
  const checks=probes();checks.RATE_LIMIT_STORE=async()=>false;
  const readiness=createProductionReadiness({probes:checks,probeTimeoutMs:100});let called=0;
  const abuseLimiter=limiter();abuseLimiter.checkIp=async()=>{called++;throw new Error('SHARED_LIMITER_DOWN')};
  await withServer({productionMode:true,readiness,abuseLimiter},async base=>{
    assert.equal((await fetch(base+'/api/v1/health')).status,200);
    assert.equal((await fetch(base+'/api/v1/ready')).status,503);
  });assert.equal(called,0);
});
