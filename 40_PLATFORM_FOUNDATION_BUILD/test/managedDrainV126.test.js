// Mandatory security concept: V126 processing HTTP and managed shutdown.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedDeploymentDrain,isManagedDeploymentDrain} from '../src/managedDeploymentDrain.js';
import {DeploymentDrainController} from '../src/deploymentDrain.js';
import {fixtureDrain,deferred,HASH,tick} from '../test-support/processingV126.js';

test('V126 shared drain membership rejects local and copied controllers',()=>{
  const {drain}=fixtureDrain();assert.equal(isManagedDeploymentDrain(drain),true);assert.equal(isManagedDeploymentDrain({...drain}),false);assert.equal(isManagedDeploymentDrain(new DeploymentDrainController({authorize:()=>true})),false);
  assert.throws(()=>new ManagedDeploymentDrain({}),/CONFIGURATION/);
});
test('V126 backend stores lease before drain and waits for exact release',async()=>{
  const {drain}=fixtureDrain();const lease=await drain.acquire({kind:'BACKGROUND',operationId:'work:1'});assert.equal((await drain.begin({actorId:'operator',reasonHash:HASH})).state,'DRAINING');
  assert.equal((await drain.probe()).ok,false);await drain.release(lease);assert.equal((await drain.status()).state,'DRAINED');
  await drain.resume({actorId:'operator'});assert.equal((await drain.probe()).ok,true);
});
test('V126 two controllers observe one backend and refuse resume with other process lease',async()=>{
  const first=fixtureDrain(),second=new ManagedDeploymentDrain({backend:first.backend,authorize:async()=>true,deploymentId:'test-only-deployment'});
  const lease=await second.acquire({kind:'INGRESS',operationId:'other:1'});await first.drain.begin({actorId:'operator',reasonHash:HASH});await assert.rejects(first.drain.resume({actorId:'operator'}));
  await second.release(lease);assert.equal((await first.drain.status()).inFlight,0);
});
test('V126 lost acquisition reply remains unready until remote lease reconciles',async()=>{
  let f;f=fixtureDrain({acquire:async input=>{await f.backend.acquire(input);throw new Error('test-only-secret');}});
  await assert.rejects(f.drain.acquire({kind:'INGRESS',operationId:'lost:1'}),/UNVERIFIED/);assert.equal(f.held.size,1);assert.equal((await f.drain.probe()).ok,false);
  await assert.rejects(f.drain.acquire({kind:'INGRESS',operationId:'another:1'}));assert.deepEqual(await f.drain.reconcile({operationId:'lost:1'}),{reconciled:true});assert.equal(f.held.size,0);assert.equal((await f.drain.probe()).ok,true);
});
test('V126 rejected backend acquisition reconciles only with authoritative absence',async()=>{
  const f=fixtureDrain({acquire:async()=>{throw new Error('test-only-no-write');}});await assert.rejects(f.drain.acquire({kind:'INGRESS',operationId:'absent:1'}));await f.drain.reconcile({operationId:'absent:1'});assert.equal((await f.drain.probe()).ok,true);
});
test('V126 lost release reply retains uncertainty and accepts exact durable replay proof',async()=>{
  let f;f=fixtureDrain({release:async input=>{await f.backend.release(input);throw new Error('test-only-lost');}});const value=await f.drain.acquire({kind:'BACKGROUND',operationId:'release:1'});
  await assert.rejects(f.drain.release(value));assert.equal((await f.drain.probe()).ok,false);await f.drain.reconcile({operationId:'release:1'});assert.equal((await f.drain.probe()).ok,true);
});
test('V126 different acquisition operations may run concurrently without duplicating one operation',async()=>{
  const gate=deferred();let f;f=fixtureDrain({acquire:async input=>{await gate.promise;return f.backend.acquire(input);}});
  const a=f.drain.acquire({kind:'BACKGROUND',operationId:'parallel:1'}),b=f.drain.acquire({kind:'BACKGROUND',operationId:'parallel:2'});await tick();await assert.rejects(f.drain.acquire({kind:'BACKGROUND',operationId:'parallel:1'}));gate.resolve();await Promise.all([a,b]);assert.equal(f.held.size,2);
});
test('V126 abort racing acquisition still gives owner the lease to release',async()=>{
  const gate=deferred(),controller=new AbortController();let f;f=fixtureDrain({acquire:async input=>{await gate.promise;return f.backend.acquire(input);}});
  const task=f.drain.acquire({kind:'INGRESS',operationId:'abort:1',signal:controller.signal});await tick();controller.abort();gate.resolve();const value=await task;await f.drain.release(value);assert.equal(f.held.size,0);
});
for(const value of [null,{token:'short',generation:1},{token:'synthetic_invalid_token',generation:0},{token:'synthetic_invalid_token',generation:1,secret:'test-only'}])test(`V126 malformed acquired lease fails closed ${JSON.stringify(value)}`,async()=>{
  const {drain}=fixtureDrain({acquire:async()=>value});await assert.rejects(drain.acquire({kind:'INGRESS',operationId:'malformed:1'}));assert.equal((await drain.probe()).ok,false);
});
for(const phase of ['ACQUIRE','STATUS','BEGIN','RESUME','RELEASE','RECONCILE'])test(`V126 strict current authorization blocks ${phase}`,async()=>{
  let denied=null;const f=fixtureDrain({},async v=>v.phase===denied?false:true);let value;
  if(phase==='RELEASE')value=await f.drain.acquire({kind:'BACKGROUND',operationId:'auth:1'});
  if(phase==='RESUME')await f.drain.begin({actorId:'operator',reasonHash:HASH});denied=phase;
  const actions={ACQUIRE:()=>f.drain.acquire({kind:'INGRESS',operationId:'auth:1'}),STATUS:()=>f.drain.status(),BEGIN:()=>f.drain.begin({actorId:'operator',reasonHash:HASH}),RESUME:()=>f.drain.resume({actorId:'operator'}),RELEASE:()=>f.drain.release(value),RECONCILE:()=>f.drain.reconcile({operationId:'unknown:1'})};await assert.rejects(actions[phase]());
});
test('V126 malformed status and impossible drained counts cannot attest readiness',async()=>{
  for(const result of [{state:'DRAINED',generation:1,inFlight:1,acceptingNew:false},{state:'ACTIVE',generation:1,inFlight:0,acceptingNew:false},{state:'ACTIVE',generation:1,inFlight:0,acceptingNew:true,detail:'test-only'}])assert.equal((await fixtureDrain({status:async()=>result}).drain.probe()).ok,false);
});
test('V126 control-plane lost acknowledgement cannot be cleared by lease lookup',async()=>{
  const f=fixtureDrain({begin:async()=>{throw new Error('test-only-lost');}});await assert.rejects(f.drain.begin({actorId:'operator',reasonHash:HASH}));const entry=f.calls.find(x=>x[0]==='begin');assert.equal(entry,undefined);assert.equal((await f.drain.probe()).ok,false);await assert.rejects(f.drain.resume({actorId:'operator'}));
});
test('V126 forged or duplicate release cannot discard tracked effects',async()=>{
  const f=fixtureDrain(),v=await f.drain.acquire({kind:'INGRESS',operationId:'forged:1'});await assert.rejects(f.drain.release({...v,generation:v.generation+1}));assert.equal(f.held.size,1);await f.drain.release(v);await assert.rejects(f.drain.release(v));
});
