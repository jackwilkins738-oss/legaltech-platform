// Mandatory security concept: V126 processing HTTP and managed shutdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createProcessingHttp} from '../src/processingHttp.js';
import {StaticAuthProvider} from '../src/auth.js';
import {InMemoryAbuseLimiter} from '../src/abuseControl.js';
import {DeploymentDrainController} from '../src/deploymentDrain.js';
import {appError} from '../src/errors.js';
import {httpOptions,inbound,policy,session,id,deferred,tick,ready,fixtureDrain} from '../test-support/processingV126.js';
async function serve(extra,run){const f=httpOptions(extra),api=createProcessingHttp(f.options);await new Promise(r=>api.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${api.server.address().port}`;
  try{await run(base,f,api);}finally{await api.stop({timeoutMs:100});api.server.closeAllConnections();await new Promise(r=>api.server.close(r));}}
const post=(base,value=inbound,extra={})=>fetch(base+'/api/v1/processing/inbound',{method:'POST',headers:{'content-type':'application/json','idempotency-key':value.commandId,...extra},body:JSON.stringify(value)});
test('V126 HTTP factory rejects local identity limiter drain and unregistered readiness',()=>{
  const f=httpOptions();for(const extra of [{authProvider:new StaticAuthProvider()},{abuseLimiter:new InMemoryAbuseLimiter()},{drain:new DeploymentDrainController({authorize:()=>true})},{readiness:{publicStatus:async()=>({status:'READY'})}},{audit:null},{authorizeRequest:null}])assert.throws(()=>createProcessingHttp({...f.options,...extra}),/CONFIGURATION/);
});
test('V126 HTTP registration binds trusted actor and stable command trace with metadata receipt',async()=>{
  await serve({},async(base,f)=>{const r=await post(base);assert.equal(r.status,202);assert.deepEqual(await r.json(),{commandId:inbound.commandId,jobId:inbound.jobId,objectId:inbound.eventId,status:'ACCEPTED',replayed:false});assert.equal(f.input[0].tenantId,session.tenantId);assert.equal(f.input[0].actorId,session.actorId);assert.equal(f.input[0].traceId,`http-command:${inbound.commandId}`);await tick();assert.equal(f.fixture.held.size,0);assert.deepEqual(f.audits.map(v=>v.phase),['ATTEMPT','ACCEPTED']);assert.equal(JSON.stringify(f.audits).includes(inbound.externalEventId),false);});
});
test('V126 HTTP policy evaluation uses the policy handler and capability',async()=>{
  await serve({},async(base,f)=>{const r=await fetch(base+'/api/v1/processing/policy-evaluations',{method:'POST',headers:{'content-type':'application/json','idempotency-key':policy.commandId},body:JSON.stringify(policy)});assert.equal(r.status,202);assert.equal(f.input[0].matterId,policy.matterId);assert.equal(f.input[0].traceId,`http-command:${policy.commandId}`);});
});
test('V126 idempotent HTTP replay retains immutable domain binding across server traces',async()=>{
  const seen=[];await serve({handlers:{registerInbound:async v=>{seen.push(v);return {tenantId:v.tenantId,commandId:v.commandId,jobId:v.jobId,kind:'PROCESS_INBOUND',objectId:v.eventId,status:'ACCEPTED',replayed:seen.length>1};},requestPolicyEvaluation:async()=>{}}},async(base)=>{assert.equal((await post(base)).status,202);await tick();const r=await post(base);assert.equal(r.status,202);assert.equal((await r.json()).replayed,true);assert.equal(seen[0].traceId,seen[1].traceId);});
});
for(const extra of [{tenantId:id(99)},{actorId:id(99)},{signal:{}},{payloadRef:'test-only'},{policyVersionId:id(99)},{__unknown:'test-only'}])test(`V126 extra body fields are rejected ${Object.keys(extra)}`,async()=>{
  await serve({},async(base,f)=>{assert.equal((await post(base,{...inbound,...extra})).status,400);assert.equal(f.input.length,0);});
});
for(const [field,value] of [['commandId','not-a-uuid'],['payloadHash','A'.repeat(64)],['sourceSystem','PROCLAIM'],['externalEventId','https://example.test/unsafe?value=1'],['payloadId',null]])test(`V126 malformed bound artifact and command fields reject ${field}`,async()=>{
  await serve({},async(base,f)=>{assert.equal((await post(base,{...inbound,[field]:value})).status,400);assert.equal(f.input.length,0);});
});
test('V126 missing or mismatched idempotency header never dispatches',async()=>{
  await serve({},async(base,f)=>{for(const key of ['',id(99)])assert.equal((await post(base,inbound,{'idempotency-key':key})).status,400);assert.equal(f.input.length,0);});
});
test('V126 capability and verified identity are both mandatory',async()=>{
  for(const s of [{...session,capabilities:[]},{...session,authContext:{method:'STATIC',mfaVerified:false}}])await serve({authProvider:{authenticate:async()=>s}},async(base,f)=>{const r=await post(base);assert.ok([401,404].includes(r.status));assert.equal(f.input.length,0);});
});
test('V126 authorization withdrawn between admit and dispatch blocks mutation',async()=>{
  await serve({authorizeRequest:async v=>v.phase==='ADMIT'},async(base,f)=>{assert.equal((await post(base)).status,404);assert.equal(f.input.length,0);await tick();assert.equal(f.fixture.held.size,0);});
});
test('V126 async attempt audit rejection prevents dispatch',async()=>{
  await serve({audit:async()=>{throw new Error('test-only-private-detail');}},async(base,f)=>{const r=await post(base);assert.equal(r.status,500);assert.equal((await r.text()).includes('private-detail'),false);assert.equal(f.input.length,0);});
});
test('V126 postcommit audit failure is outcome unverified and never a success receipt',async()=>{
  await serve({audit:async v=>{if(v.phase==='ACCEPTED')throw new Error('test-only-audit-down');}},async(base,f)=>{const r=await post(base);assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'OUTCOME_UNVERIFIED'});assert.equal(f.input.length,1);assert.equal(r.headers.get('retry-after'),null);});
});
for(const message of ['DOMAIN_COMMAND_COMMIT_OUTCOME_UNKNOWN','test-only-internal-failure'])test(`V126 command uncertainty is redacted ${message}`,async()=>{
  await serve({handlers:{registerInbound:async()=>{throw new Error(message);},requestPolicyEvaluation:async()=>{}}},async base=>{const r=await post(base);assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'OUTCOME_UNVERIFIED'});});
});
test('V126 command conflict is explicit and does not trigger a new identifier',async()=>{
  await serve({handlers:{registerInbound:async()=>{throw new Error('DOMAIN_COMMAND_CONFLICT');},requestPolicyEvaluation:async()=>{}}},async base=>{const r=await post(base);assert.equal(r.status,409);assert.deepEqual(await r.json(),{code:'COMMAND_CONFLICT'});});
});
test('V126 forged mismatched command receipt cannot become accepted',async()=>{
  await serve({handlers:{registerInbound:async v=>({tenantId:id(99),commandId:v.commandId,jobId:v.jobId,kind:'PROCESS_INBOUND',objectId:v.eventId,status:'ACCEPTED',replayed:false}),requestPolicyEvaluation:async()=>{}}},async base=>{const r=await post(base);assert.equal(r.status,503);assert.equal((await r.json()).status,'OUTCOME_UNVERIFIED');});
});
test('V126 timeout retains ingress lease and concurrency slot until actual effect settles',async()=>{
  const gate=deferred(),entered=deferred();await serve({requestTimeoutMs:100,maxInFlight:1,handlers:{registerInbound:async v=>{entered.resolve();await gate.promise;return {tenantId:v.tenantId,commandId:v.commandId,jobId:v.jobId,kind:'PROCESS_INBOUND',objectId:v.eventId,status:'ACCEPTED',replayed:false};},requestPolicyEvaluation:async()=>{}}},async(base,f,api)=>{
    const request=post(base);await entered.promise;const r=await request;assert.equal(r.status,503);assert.equal(f.fixture.held.size,1);assert.equal(api.status().inFlight,1);assert.equal((await post(base)).status,503);assert.equal((await api.stop({timeoutMs:10})).drained,false);assert.throws(()=>api.resume(),/UNDRAINED/);gate.resolve();await tick();await tick();assert.equal((await api.stop({timeoutMs:100})).drained,true);assert.equal(f.fixture.held.size,0);
  });
});
test('V126 disconnect aborts but cannot release an outstanding processor early',async()=>{
  const entered=deferred(),gate=deferred();await serve({handlers:{registerInbound:async v=>{entered.resolve(v.signal);await gate.promise;throw new Error('test-only-aborted');},requestPolicyEvaluation:async()=>{}}},async(base,f,api)=>{
    const req=http.request(base+'/api/v1/processing/inbound',{method:'POST',headers:{'content-type':'application/json','idempotency-key':inbound.commandId}});req.on('error',()=>{});req.end(JSON.stringify(inbound));const signal=await entered.promise;
    const aborted=new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));req.destroy();await aborted;
    try{assert.equal(signal.aborted,true);assert.equal(f.fixture.held.size,1);}finally{gate.resolve();}await tick();await tick();assert.equal((await api.stop()).drained,true);
  });
});
test('V126 lost drain release acknowledgement blocks following requests and restart',async()=>{
  const f=fixtureDrain({release:async()=>{throw new Error('test-only-lost');}});await serve({drain:f.drain},async(base,_,api)=>{assert.equal((await post(base)).status,202);await tick();assert.equal((await post(base)).status,503);assert.equal(api.status().uncertain,true);assert.equal((await api.stop({timeoutMs:10})).drained,false);assert.throws(()=>api.resume(),/UNDRAINED/);});
});
test('V126 operational liveness survives failed admission and shared IP rate limiter',async()=>{
  await serve({accepting:()=>false,abuseLimiter:{checkIp:async()=>{throw new Error('test-only-down');},checkTenant:async()=>{}}},async(base,f)=>{assert.equal((await fetch(base+'/api/v1/health')).status,200);assert.equal((await fetch(base+'/api/v1/ready')).status,503);assert.equal((await post(base)).status,503);assert.equal(f.input.length,0);});
});
test('V126 no worker adoption drain administration or legacy ingest route is exposed',async()=>{
  await serve({},async(base,f)=>{for(const route of ['/api/v1/inbound-events','/api/v1/dev/workers/drain-one','/api/v1/processing/adopt','/api/v1/processing/drain','/api/v1/processing/inbound?tenantId='+id(99)])assert.equal((await fetch(base+route,{method:'POST'})).status,404);assert.equal(f.input.length,0);});
});
test('V126 unsupported encoding oversized and invalid JSON bodies never dispatch',async()=>{
  await serve({},async(base,f)=>{for(const [headers,bytes] of [[{'content-encoding':'gzip'},JSON.stringify(inbound)],[{},' '.repeat(17000)],[{},'{invalid']]){const r=await fetch(base+'/api/v1/processing/inbound',{method:'POST',headers:{'content-type':'application/json','idempotency-key':inbound.commandId,...headers},body:bytes});assert.equal(r.status,400);}assert.equal(f.input.length,0);});
});
test('V126 duplicate security headers are denied before authentication',async()=>{
  let calls=0;await serve({authProvider:{authenticate:async()=>{calls++;return session;}}},async base=>{
    const status=await new Promise(resolve=>{const req=http.request(base+'/api/v1/processing/inbound',{method:'POST',headers:['Content-Type','application/json','Idempotency-Key',inbound.commandId,'Authorization','Bearer test-only-a','Authorization','Bearer test-only-b']},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.end(JSON.stringify(inbound));});assert.equal(status,400);assert.equal(calls,0);
  });
});
test('V126 bounded readiness is rechecked after authorization changes',async()=>{
  const readiness=ready();await serve({readiness,authorizeRequest:async()=>{readiness.publicStatus;readiness.invalidate();return false;}},async(base,f)=>{assert.equal((await post(base)).status,404);assert.equal(f.input.length,0);});
});
test('V126 trusted limiter rate error stays typed and blocks mutation',async()=>{
  await serve({abuseLimiter:{checkIp:async()=>{},checkTenant:async()=>{throw appError('rate limited',{status:429,code:'RATE_LIMITED'});}}},async(base,f)=>{const r=await post(base);assert.equal(r.status,429);assert.equal(f.input.length,0);});
});
