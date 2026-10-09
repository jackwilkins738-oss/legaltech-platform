import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadinessCoordinator} from '../src/readiness.js';
import {createApiServer} from '../src/httpApi.js';

function coordinator(checks,options={}) { return new ReadinessCoordinator({checks,cacheTtlMs:250,probeTimeoutMs:100,...options}); }
async function withServer(readiness,run) {
  const platform={store:{audit(){}},securityMonitor:null};
  const authProvider={async authenticate(){ throw new Error('auth must not run for readiness routes'); }};
  const server=createApiServer({platform,authProvider,readiness});
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',error=>error?reject(error):resolve()));
  try {
    const {port}=server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally { await new Promise(resolve=>server.close(resolve)); }
}

test('V76 readiness is READY only when all probes pass',async()=>{
  const ready=coordinator([
    {name:'DATABASE',probe:async()=>true},
    {name:'QUEUE',critical:false,probe:async()=>({ok:true,code:'CONNECTED'})},
  ]);
  const result=await ready.evaluate();
  assert.equal(result.status,'READY');
  assert.deepEqual(result.checks.map(x=>[x.name,x.ok,x.code]),[['DATABASE',true,'OK'],['QUEUE',true,'CONNECTED']]);
});

test('V76 a failed critical dependency makes the process NOT_READY',async()=>{
  const ready=coordinator([{name:'DATABASE',probe:async()=>false},{name:'QUEUE',critical:false,probe:async()=>true}]);
  assert.equal((await ready.evaluate()).status,'NOT_READY');
});

test('V76 noncritical dependency failure is explicit DEGRADED rather than hidden',async()=>{
  const ready=coordinator([{name:'DATABASE',probe:async()=>true},{name:'TEAMS_DELIVERY',critical:false,probe:async()=>false}]);
  assert.equal((await ready.evaluate()).status,'DEGRADED');
});

test('V76 probe errors are redacted to bounded codes',async()=>{
  const secret='SENSITIVE_FAILURE_DETAIL_DO_NOT_ECHO_123';
  const ready=coordinator([{name:'DATABASE',probe:async()=>{throw new Error(secret);}}]);
  const result=await ready.evaluate();
  assert.equal(result.status,'NOT_READY');
  assert.equal(result.checks[0].code,'CHECK_FAILED');
  assert.equal(JSON.stringify(result).includes(secret),false);
});

test('V76 probe timeout fails closed and does not leak probe payload',async()=>{
  const ready=coordinator([{name:'DATABASE',probe:async({signal})=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({ok:true,code:'LATE_SECRET'}),{once:true}))}]);
  const result=await ready.evaluate();
  assert.equal(result.status,'NOT_READY');
  assert.equal(result.checks[0].code,'CHECK_TIMEOUT');
});

test('V76 cached readiness bounds dependency probe load',async()=>{
  let calls=0; let now=1000;
  const ready=coordinator([{name:'DATABASE',probe:async()=>{calls++;return true;}}],{now:()=>now});
  await ready.evaluate(); await ready.evaluate();
  assert.equal(calls,1);
  now+=251;
  await ready.evaluate();
  assert.equal(calls,2);
});

test('V76 concurrent callers share one in-flight readiness evaluation',async()=>{
  let calls=0;
  const ready=coordinator([{name:'DATABASE',probe:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return true;}}]);
  const results=await Promise.all([ready.evaluate(),ready.evaluate(),ready.evaluate()]);
  assert.equal(calls,1); assert.ok(results.every(x=>x.status==='READY'));
});

test('V76 malformed checks and unsafe result fields fail closed',async()=>{
  assert.throws(()=>coordinator([{name:'database',probe:async()=>true}]),/INVALID_READINESS_CHECK_NAME/);
  assert.throws(()=>coordinator([{name:'DB',probe:async()=>true},{name:'DB',probe:async()=>true}]),/DUPLICATE/);
  assert.throws(()=>new ReadinessCoordinator({checks:[{name:'DB',probe:async()=>true}],probeTimeoutMs:99}),/INVALID_READINESS_TIMEOUT/);
  const ready=coordinator([{name:'DB',probe:async()=>({ok:true,secret:'do-not-echo'})}]);
  const result=await ready.evaluate();
  assert.equal(result.status,'NOT_READY'); assert.equal(result.checks[0].code,'CHECK_FAILED');
});

test('V76 unsafe dependency result code is not reflected',async()=>{
  const ready=coordinator([{name:'DB',probe:async()=>({ok:false,code:'secret=abc/123'})}]);
  assert.equal((await ready.evaluate()).checks[0].code,'CHECK_FAILED');
});

test('V76 liveness remains process-only while readiness fails closed',async()=>{
  const ready=coordinator([{name:'DATABASE',probe:async()=>false}]);
  await withServer(ready,async base=>{
    const health=await fetch(`${base}/api/v1/health`);
    assert.equal(health.status,200); assert.deepEqual(await health.json(),{status:'ok'});
    const readiness=await fetch(`${base}/api/v1/ready`);
    assert.equal(readiness.status,503); assert.deepEqual(await readiness.json(),{status:'NOT_READY'});
  });
});

test('V76 readiness endpoint does not disclose dependency names or failure reasons',async()=>{
  const ready=coordinator([{name:'SECRET_DATABASE_CLUSTER',probe:async()=>({ok:false,code:'CONNECTION_FAILED'})}]);
  await withServer(ready,async base=>{
    const response=await fetch(`${base}/api/v1/ready`); const text=await response.text();
    assert.equal(response.status,503); assert.equal(text.includes('SECRET_DATABASE_CLUSTER'),false); assert.equal(text.includes('CONNECTION_FAILED'),false);
  });
});

test('V76 degraded readiness stays routable while making degraded state explicit',async()=>{
  const ready=coordinator([{name:'DATABASE',probe:async()=>true},{name:'TEAMS',critical:false,probe:async()=>false}]);
  await withServer(ready,async base=>{
    const response=await fetch(`${base}/api/v1/ready`);
    assert.equal(response.status,200); assert.deepEqual(await response.json(),{status:'DEGRADED'});
  });
});

test('V76 missing readiness coordinator fails closed rather than claiming ready',async()=>{
  await withServer(null,async base=>{
    const response=await fetch(`${base}/api/v1/ready`);
    assert.equal(response.status,503); assert.deepEqual(await response.json(),{status:'NOT_READY'});
  });
});
