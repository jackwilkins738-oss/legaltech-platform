import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryAbuseLimiter} from '../src/abuseControl.js';
import {createApiServer} from '../src/httpApi.js';
import {StaticAuthProvider} from '../src/auth.js';

function denied(fn,code){assert.throws(fn,error=>error.code===code);}

test('V78 actor read budget counts visible records across resources',()=>{
  const limiter=new InMemoryAbuseLimiter({maxReadRecordsPerActor:3,maxDistinctMattersPerActor:10});
  const session={tenantId:'tenant-a',actorId:'user-a'};
  limiter.checkRead(session,{resource:'work',count:2,matterIds:['m1','m2']});
  limiter.checkRead(session,{resource:'audit',count:1,matterIds:['m1']});
  denied(()=>limiter.checkRead(session,{resource:'exceptions',count:1,matterIds:[] }),'READ_VOLUME_LIMITED');
});

test('V78 read budgets are isolated by tenant and actor',()=>{
  const limiter=new InMemoryAbuseLimiter({maxReadRecordsPerActor:1,maxDistinctMattersPerActor:10});
  limiter.checkRead({tenantId:'tenant-a',actorId:'user-a'},{resource:'work',count:1});
  assert.doesNotThrow(()=>limiter.checkRead({tenantId:'tenant-a',actorId:'user-b'},{resource:'work',count:1}));
  assert.doesNotThrow(()=>limiter.checkRead({tenantId:'tenant-b',actorId:'user-a'},{resource:'work',count:1}));
  denied(()=>limiter.checkRead({tenantId:'tenant-a',actorId:'user-a'},{resource:'work',count:1}),'READ_VOLUME_LIMITED');
});

test('V78 distinct-matter budget stops split-endpoint extraction',()=>{
  const limiter=new InMemoryAbuseLimiter({maxReadRecordsPerActor:100,maxDistinctMattersPerActor:2});
  const session={tenantId:'tenant-a',actorId:'user-a'};
  limiter.checkRead(session,{resource:'matters',count:2,matterIds:['m1','m2']});
  denied(()=>limiter.checkRead(session,{resource:'work',count:1,matterIds:['m3']}),'READ_VOLUME_LIMITED');
});

test('V78 denied read does not partially consume the next budget state',()=>{
  const limiter=new InMemoryAbuseLimiter({maxReadRecordsPerActor:3,maxDistinctMattersPerActor:2});
  const session={tenantId:'tenant-a',actorId:'user-a'};
  limiter.checkRead(session,{resource:'work',count:1,matterIds:['m1']});
  denied(()=>limiter.checkRead(session,{resource:'work',count:3,matterIds:['m2','m3']}),'READ_VOLUME_LIMITED');
  assert.doesNotThrow(()=>limiter.checkRead(session,{resource:'work',count:2,matterIds:['m2']}));
});

test('V78 read window reset restores budget without carrying prior matter set',()=>{
  let now=0; const limiter=new InMemoryAbuseLimiter({windowMs:1000,maxReadRecordsPerActor:1,maxDistinctMattersPerActor:1,now:()=>now});
  const session={tenantId:'tenant-a',actorId:'user-a'};
  limiter.checkRead(session,{resource:'work',count:1,matterIds:['m1']});
  denied(()=>limiter.checkRead(session,{resource:'work',count:1,matterIds:['m2']}),'READ_VOLUME_LIMITED');
  now=1001;
  assert.doesNotThrow(()=>limiter.checkRead(session,{resource:'work',count:1,matterIds:['m2']}));
});

test('V78 malformed internal read-budget context fails closed',()=>{
  const limiter=new InMemoryAbuseLimiter();
  denied(()=>limiter.checkRead({tenantId:'tenant-a',actorId:'user-a'},{resource:'../../secret',count:1}),'READ_BUDGET_CONTEXT_INVALID');
  denied(()=>limiter.checkRead({tenantId:'tenant-a',actorId:'user-a'},{resource:'work',count:-1}),'READ_BUDGET_CONTEXT_INVALID');
  denied(()=>limiter.checkRead({tenantId:'tenant-a',actorId:'user-a'},{resource:'work',count:1,matterIds:['bad\nvalue']}),'READ_BUDGET_CONTEXT_INVALID');
});

async function withMatterServer(t,{limiter,monitor=null}={}){
  const matters=[{id:'m1',tenantId:'tenant-a'},{id:'m2',tenantId:'tenant-a'}];
  const platform={securityMonitor:monitor,listMatters(){return matters;}};
  const authProvider=new StaticAuthProvider([{token:'synthetic',tenantId:'tenant-a',actorId:'user-a',capabilities:['matter:read']}]);
  const server=createApiServer({platform,authProvider,abuseLimiter:limiter});
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}

test('V78 HTTP collection response is refused before egress when actor record budget is exceeded',async t=>{
  const base=await withMatterServer(t,{limiter:new InMemoryAbuseLimiter({maxReadRecordsPerActor:3,maxDistinctMattersPerActor:10,maxPerIp:100,maxPerTenant:100})});
  const headers={authorization:'Bearer synthetic'};
  let response=await fetch(`${base}/api/v1/matters`,{headers}); assert.equal(response.status,200); assert.equal((await response.json()).items.length,2);
  response=await fetch(`${base}/api/v1/matters`,{headers}); const body=await response.json();
  assert.equal(response.status,429); assert.equal(body.code,'READ_VOLUME_LIMITED'); assert.equal('items' in body,false);
});

test('V78 authorized collection reads are sent to security monitoring before response',async t=>{
  const observed=[]; const monitor={observeRequest(){},observeRead(input){observed.push(input);}};
  const base=await withMatterServer(t,{limiter:new InMemoryAbuseLimiter({maxReadRecordsPerActor:100}),monitor});
  const response=await fetch(`${base}/api/v1/matters`,{headers:{authorization:'Bearer synthetic'}}); assert.equal(response.status,200);
  assert.equal(observed.length,1); assert.equal(observed[0].resource,'matters'); assert.equal(observed[0].count,2); assert.deepEqual(observed[0].matterIds,['m1','m2']);
});
