// Mandatory security concept: V126 processing HTTP and managed shutdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProcessingService,createPostgresProcessingService} from '../src/processingService.js';
import {ReadinessCoordinator} from '../src/readiness.js';
import {fixtureDrain,httpOptions,ready,HASH,deferred,tick} from '../test-support/processingV126.js';
function service(extra={}){const f=httpOptions(),events=[];const pipeline={handlers:f.options.handlers,status:()=>({}),start:async()=>{events.push('start');},stop:async()=>{events.push('stop');return {drained:true};},canary:{run:async()=>{events.push('canary');return {ok:true};}},...extra.pipeline};
  const root=createProcessingService({pipeline,drain:f.fixture.drain,readiness:f.options.readiness,http:{authProvider:f.options.authProvider,abuseLimiter:f.options.abuseLimiter,authorizeRequest:f.options.authorizeRequest,audit:f.options.audit},canaryIntervalMs:100,...extra,pipeline});return {root,f,events};}
const stop=root=>root.stop({actorId:'operator',reasonHash:HASH,timeoutMs:100});
test('V126 service construction neither opens listeners nor starts workers',async()=>{
  const {root,events}=service();assert.equal(root.status().state,'IDLE');assert.equal(root.server.listening,false);assert.deepEqual(events,[]);assert.equal((await stop(root)).drained,true);
});
test('V126 service starts actual pipeline before serving then launches functional canary',async()=>{
  const {root,events}=service();await root.start({port:0});await tick();assert.deepEqual(events.slice(0,2),['start','canary']);assert.equal(root.status().state,'RUNNING');assert.equal(root.server.listening,true);assert.equal((await stop(root)).drained,true);assert.equal(root.status().state,'STOPPED');assert.equal(root.server.listening,false);
});
test('V126 service refuses duplicate start and can cancel an unsettled startup',async()=>{
  const gate=deferred();const {root}=service({pipeline:{start:async()=>gate.promise}});const starting=root.start({port:0});const failed=assert.rejects(starting,/START_FAILED/);await tick();await assert.rejects(root.start({port:0}),/ALREADY_ACTIVE/);assert.equal((await root.stop({actorId:'operator',reasonHash:HASH,timeoutMs:10})).drained,false);gate.resolve();await failed;await stop(root);assert.equal(root.server.listening,false);
});
test('V126 shared begin waits on other process lease and keeps this service unready',async()=>{
  const {root,f}=service();const lease=await f.fixture.drain.acquire({kind:'BACKGROUND',operationId:'other:work'});await root.start({port:0});assert.equal((await stop(root)).drained,false);assert.equal(root.status().state,'FAILED');assert.equal(root.server.listening,false);await assert.rejects(root.start({port:0}));await f.fixture.drain.release(lease);
});
test('V126 hanging shared begin cannot claim shutdown complete or permit restart',async()=>{
  const gate=deferred(),f=fixtureDrain({begin:async()=>gate.promise});const {root}=service({drain:f.drain});await root.start({port:0});const result=await root.stop({actorId:'operator',reasonHash:HASH,timeoutMs:10});assert.equal(result.drained,false);assert.equal(root.status().state,'STOP_TIMEOUT');await assert.rejects(root.start({port:0}));
  const pending=stop(root);gate.resolve({state:'DRAINED',generation:2,inFlight:0,acceptingNew:false});assert.equal((await pending).drained,false);assert.equal(root.status().state,'FAILED');
});
test('V126 slow worker shutdown retains stop task and allows safe subsequent wait',async()=>{
  const gate=deferred();const {root}=service({pipeline:{stop:async()=>gate.promise}});await root.start({port:0});assert.equal((await root.stop({actorId:'operator',reasonHash:HASH,timeoutMs:10})).drained,false);assert.equal(root.status().state,'STOP_TIMEOUT');gate.resolve({drained:true});assert.equal((await stop(root)).drained,true);
});
test('V126 periodic canaries never overlap an unsettled run',async()=>{
  const gate=deferred(),entered=deferred();let calls=0;const {root}=service({pipeline:{canary:{run:async()=>{calls++;entered.resolve();return gate.promise;}}}});await root.start({port:0});await entered.promise;await new Promise(r=>setTimeout(r,130));assert.equal(calls,1);assert.equal(root.status().canaryInFlight,true);const shutdown=stop(root);gate.resolve({ok:false});await shutdown;
});
test('V126 canary rejection stays handled and can retry while serving remains health gated',async()=>{
  let calls=0;const {root}=service({pipeline:{canary:{run:async()=>{calls++;throw new Error('test-only-canary-down');}}}});await root.start({port:0});await new Promise(r=>setTimeout(r,130));assert.ok(calls>=2);await stop(root);
});
test('V126 shutdown immediately closes admission before remote control responds',async()=>{
  const gate=deferred(),f=fixtureDrain({begin:async()=>gate.promise});const {root}=service({drain:f.drain});await root.start({port:0});const shutdown=stop(root);assert.equal(root.status().state,'STOPPING');gate.resolve({state:'DRAINED',generation:2,inFlight:0,acceptingNew:false});await shutdown;
});
test('V126 failed worker start closes listener and refuses automatic restart',async()=>{
  const {root,events}=service({pipeline:{start:async()=>{throw new Error('test-only-start-down');}}});await assert.rejects(root.start({port:0}),/START_FAILED/);assert.equal(root.server.listening,false);assert.equal(root.status().state,'FAILED');assert.ok(events.includes('stop'));await assert.rejects(root.start({port:0}));await stop(root);
});
test('V126 HTTP bindings cannot be overridden through root options',()=>{
  const f=httpOptions();for(const key of ['handlers','drain','readiness','accepting'])assert.throws(()=>createProcessingService({pipeline:{start(){},stop(){},status(){},canary:{run(){}},handlers:f.options.handlers},drain:f.fixture.drain,readiness:ready(),http:{[key]:{}}}),/OVERRIDE/);
});
test('V126 PostgreSQL root refuses caller drain injection before constructing processing',()=>{
  const f=fixtureDrain();assert.throws(()=>createPostgresProcessingService({drain:{backend:f.backend,authorize:async()=>true,deploymentId:'test-only'},processing:{domain:{drain:f.drain},worker:{}}}),/OVERRIDE/);
});
test('V126 readiness invalidation never overlaps a hanging provider even after timeout',async()=>{
  const gate=deferred(),entered=deferred();let calls=0;const r=new ReadinessCoordinator({checks:[{name:'DB',probe:async()=>{calls++;entered.resolve();return gate.promise;}}],probeTimeoutMs:100,cacheTtlMs:250});const first=r.evaluate();await entered.promise;r.invalidate();const second=await r.evaluate();assert.equal(second.checks[0].code,'CHECK_BUSY');assert.equal(calls,1);assert.equal((await first).status,'NOT_READY');r.invalidate();assert.equal((await r.evaluate()).checks[0].code,'CHECK_BUSY');assert.equal(calls,1);gate.resolve(true);await tick();r.invalidate();assert.equal((await r.evaluate()).status,'READY');assert.equal(calls,2);
});
test('V126 forced readiness evaluations still respect active provider ownership',async()=>{
  const gate=deferred(),entered=deferred();let calls=0;const r=new ReadinessCoordinator({checks:[{name:'DB',probe:async()=>{calls++;entered.resolve();return gate.promise;}}],probeTimeoutMs:100});const first=r.evaluate();await entered.promise;assert.equal((await r.evaluate({force:true})).status,'NOT_READY');assert.equal(calls,1);gate.resolve(true);await first;
});
for(const at of [NaN,Infinity,999])test(`V126 cached ready cannot survive invalid or backward clock ${at}`,async()=>{
  let time=1000;const r=new ReadinessCoordinator({checks:[{name:'DB',probe:async()=>true}],now:()=>time});assert.equal((await r.evaluate()).status,'READY');time=at;const bad=await r.evaluate();assert.equal(bad.status,'NOT_READY');assert.equal(bad.checks[0].code,'CLOCK_INVALID');time=1001;assert.equal((await r.evaluate()).status,'READY');
});
test('V126 clock rollback during probe completion cannot cache healthy admission',async()=>{
  let time=1000;const gate=deferred(),entered=deferred();const r=new ReadinessCoordinator({checks:[{name:'DB',probe:async()=>{entered.resolve();await gate.promise;return true;}}],now:()=>time,probeTimeoutMs:100});const result=r.evaluate();await entered.promise;time=500;gate.resolve();assert.equal((await result).status,'NOT_READY');assert.equal(r.cached,null);
});
