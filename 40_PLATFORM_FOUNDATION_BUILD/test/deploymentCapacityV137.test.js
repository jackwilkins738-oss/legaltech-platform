// Mandatory security concept: V137 deployment capacity admission regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DeploymentCapacity,isDeploymentCapacity,validateConnectionPlan,bindDeploymentCapacityService} from '../src/deploymentCapacity.js';
import {createDurablePostgresProcessingService} from '../src/durableProcessingService.js';
import {main} from '../bin/checkDeploymentCapacity.js';
import {createProductionReadiness,REQUIRED_PRODUCTION_PROBES} from '../src/productionAdmission.js';
const names=['DOMAIN','RELAY','PRODUCER','WORKER','DOMAIN_READER','QUEUE_READER','DRAIN_WORKER','DRAIN_OPERATOR','DRAIN_READER'];
const profile=()=>({connectionLimit:120,reservedConnections:20,maxConcurrentReplicas:3,maxWaitingPerPool:4});
const descriptor=name=>({name,max:3,connectionTimeoutMillis:1000});
const plan=()=>({profile:profile(),pools:names.map(descriptor)});
function fixture({config=profile(),count=9}={}){
  const all=[...names,'GRAPH_PRODUCER','GRAPH_WORKER','GRAPH_READER','REVIEW','REVIEW_READER'];
  const bindings=all.slice(0,count).map(name=>({name,pool:{options:{max:2,connectionTimeoutMillis:1000,password:'PRIVATE_VALUE'},totalCount:0,idleCount:0,waitingCount:0,connect(){throw Error('SHOULD_NOT_OPEN');}}}));
  const guard=new DeploymentCapacity({profile:config,bindings});return {bindings,guard,config};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};
test('V137 reserves ordinary connections and budgets overlapping replicas',()=>{
  const result=validateConnectionPlan(plan());assert.equal(result.perReplica,27);assert.equal(result.fleetConnections,81);assert.equal(result.headroom,19);
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.profile));assert.ok(Object.isFrozen(result.pools));assert.ok(Object.isFrozen(result.pools[0]));
  const p=plan();p.profile.connectionLimit=101;assert.equal(validateConnectionPlan(p).headroom,0);p.profile.connectionLimit=100;assert.throws(()=>validateConnectionPlan(p),/BUDGET_EXCEEDED/);
});
for(const key of ['connectionLimit','reservedConnections','maxConcurrentReplicas','maxWaitingPerPool'])for(const invalid of [undefined,NaN,Infinity,'3',-1,1.2])test(`V137 rejects ${key} ${String(invalid)}`,()=>{
  const p=plan();p.profile[key]=invalid;assert.throws(()=>validateConnectionPlan(p),/CONFIGURATION/);
});
test('V137 rejects zero reservation, zero replicas and unbounded numeric declarations',()=>{
  for(const [key,value] of [['reservedConnections',0],['maxConcurrentReplicas',0],['connectionLimit',100001],['reservedConnections',100001],['maxConcurrentReplicas',1001],['maxWaitingPerPool',1001]]){
    const p=plan();p.profile[key]=value;assert.throws(()=>validateConnectionPlan(p));
  }
  const p=plan();p.profile.maxWaitingPerPool=0;assert.equal(validateConnectionPlan(p).headroom,19);
});
test('V137 rejects accessors, unknown keys and sparse declarations without executing getters',()=>{
  let read=0;const p=plan();Object.defineProperty(p.profile,'connectionLimit',{get(){read++;return 120;}});assert.throws(()=>validateConnectionPlan(p));assert.equal(read,0);
  const extra=plan();extra.secret='PRIVATE_VALUE';assert.throws(()=>validateConnectionPlan(extra));
  const sparse=plan();sparse.pools.length=10;assert.throws(()=>validateConnectionPlan(sparse));
  const accessor=plan();Object.defineProperty(accessor.pools,'0',{get(){read++;return descriptor('DOMAIN');}});assert.throws(()=>validateConnectionPlan(accessor));assert.equal(read,0);
  const symbol=plan();symbol.profile[Symbol('secret')]=true;assert.throws(()=>validateConnectionPlan(symbol));
});
test('V137 includes every mandatory pool and all Graph pools as one group',()=>{
  for(const name of names){const p=plan();p.pools=p.pools.filter(x=>x.name!==name);assert.throws(()=>validateConnectionPlan(p));}
  for(const extra of [['GRAPH_PRODUCER'],['GRAPH_PRODUCER','GRAPH_WORKER']]){
    const p=plan();p.pools.push(...extra.map(descriptor));assert.throws(()=>validateConnectionPlan(p));
  }
  const p=plan();p.profile.maxConcurrentReplicas=1;p.pools.push(...['GRAPH_PRODUCER','GRAPH_WORKER','GRAPH_READER','REVIEW','REVIEW_READER'].map(descriptor));assert.equal(validateConnectionPlan(p).pools.length,14);
  p.pools[13]=descriptor('DOMAIN');assert.throws(()=>validateConnectionPlan(p));
});
for(const [key,value] of [['max',0],['max',10001],['max','3'],['connectionTimeoutMillis',0],['connectionTimeoutMillis',99],['connectionTimeoutMillis',10001],['connectionTimeoutMillis',null]])test(`V137 rejects pool ${key} ${value}`,()=>{
  const p=plan();p.pools[0][key]=value;assert.throws(()=>validateConnectionPlan(p));
});
test('V137 construction opens no pools and copies deployment declarations',()=>{
  const f=fixture();assert.equal(isDeploymentCapacity(f.guard),true);assert.equal(isDeploymentCapacity({...f.guard}),false);assert.ok(Object.isFrozen(f.guard));
  f.config.maxConcurrentReplicas=999;f.bindings.reverse();assert.deepEqual(f.guard.status(),{healthy:true,uncertain:false,probeInFlight:false,poolCount:9,perReplica:18,fleetConnections:54,headroom:46});
  assert.equal(JSON.stringify(f.guard.status()).includes('PRIVATE_VALUE'),false);
});
for(const count of [9,10,11,12,13,14])test(`V137 runtime inventory ${count} pools respects complete Graph group`,()=>{
  if(count===10||count===11)assert.throws(()=>fixture({count}));else assert.equal(fixture({count}).guard.status().poolCount,count);
});
test('V137 review-only and reader-only inventories are supported',()=>{
  for(const name of ['REVIEW','REVIEW_READER']){const f=fixture(),p={name,pool:{...f.bindings[0].pool,options:{max:1,connectionTimeoutMillis:500}}};assert.equal(new DeploymentCapacity({profile:profile(),bindings:[...f.bindings,p]}).status().poolCount,10);}
});
test('V137 refuses aliased pools and missing concrete pool configuration',()=>{
  const f=fixture();f.bindings[1].pool=f.bindings[0].pool;assert.throws(()=>new DeploymentCapacity({profile:profile(),bindings:f.bindings}));
  for(const mutate of [p=>delete p.options,p=>delete p.options.max,p=>delete p.options.connectionTimeoutMillis,p=>{p.options.connectionTimeoutMillis=0;},p=>{p.totalCount=undefined;},p=>{p.idleCount=1;}]){
    const x=fixture();mutate(x.bindings[0].pool);assert.throws(()=>new DeploymentCapacity({profile:profile(),bindings:x.bindings}));
  }
});
for(const change of ['max','timeout','options','negative','overfull','idle','counterThrows'])test(`V137 ${change} drift latches unhealthy until reconstruction`,async()=>{
  const f=fixture(),p=f.bindings[0].pool;
  const old={options:p.options,max:p.options.max,connectionTimeoutMillis:p.options.connectionTimeoutMillis};
  if(change==='max')p.options.max=3;
  if(change==='timeout')p.options.connectionTimeoutMillis=2000;
  if(change==='options')p.options={...p.options};
  if(change==='negative')p.waitingCount=-1;
  if(change==='overfull')p.totalCount=3;
  if(change==='idle')p.idleCount=1;
  if(change==='counterThrows')Object.defineProperty(p,'waitingCount',{configurable:true,get(){throw Error('PRIVATE_VALUE');}});
  assert.equal(f.guard.status().healthy,false);assert.equal(f.guard.status().uncertain,true);
  Object.defineProperty(p,'waitingCount',{value:0,writable:true,configurable:true});p.totalCount=0;p.idleCount=0;p.options=old.options;p.options.max=old.max;p.options.connectionTimeoutMillis=old.connectionTimeoutMillis;
  assert.equal((await f.guard.probe(async()=>true)).ok,false);assert.equal(new DeploymentCapacity({profile:profile(),bindings:f.bindings}).status().healthy,true);
});
test('V137 queue overload fails closed but can recover after real clearance',async()=>{
  const f=fixture(),p=f.bindings[0].pool;p.waitingCount=5;let called=0;
  assert.equal((await f.guard.probe(async()=>{called++;return true;})).ok,false);assert.equal(called,0);assert.equal(f.guard.status().uncertain,false);
  p.waitingCount=4;assert.equal((await f.guard.probe(async()=>true)).ok,true);
  p.waitingCount=0;p.totalCount=2;assert.equal((await f.guard.probe(async()=>({ok:true}))).ok,true);
});
test('V137 post-probe recheck catches changes during a passing database check',async()=>{
  const f=fixture();assert.equal((await f.guard.probe(async()=>{f.bindings[0].pool.options.max=3;return true;})).ok,false);assert.equal(f.guard.status().uncertain,true);
});
test('V137 canceled probe retains actual ownership and refuses overlapping work',async()=>{
  const f=fixture(),gate=deferred(),controller=new AbortController();let entered=false,seen;
  const task=f.guard.probe(async({signal})=>{seen=signal;entered=true;await gate.promise;return true;},{signal:controller.signal});
  assert.equal(entered,true);controller.abort();assert.equal(seen.aborted,true);assert.equal(f.guard.status().probeInFlight,true);
  assert.equal((await f.guard.probe(async()=>true)).ok,false);gate.resolve();assert.equal((await task).ok,false);assert.equal(f.guard.status().probeInFlight,false);assert.equal((await f.guard.probe(async()=>true)).ok,true);
});
test('V137 failed and malformed provider responses cannot disclose diagnostics or pass readiness',async()=>{
  const f=fixture();for(const response of [false,null,{},'READY',{ok:true,secret:'PRIVATE_VALUE'},{ok:true,code:'private value'},Object.defineProperty({},'ok',{get(){throw Error('PRIVATE_VALUE');}})])assert.deepEqual(await f.guard.probe(async()=>response),{ok:false,code:'DEPLOYMENT_CAPACITY_UNVERIFIED'});
  assert.deepEqual(await f.guard.probe(async()=>{throw Error('PRIVATE_VALUE');}),{ok:false,code:'DEPLOYMENT_CAPACITY_UNVERIFIED'});
  assert.equal((await f.guard.probe(async()=>({ok:true,code:'DATABASE_VERIFIED'}))).ok,true);
});
test('V137 readiness timeout retains probe ownership across invalidation and renewal',async()=>{
  const f=fixture(),gate=deferred();let calls=0;
  const probes=Object.fromEntries(REQUIRED_PRODUCTION_PROBES.map(name=>[name,name==='DATABASE_RUNTIME'?args=>f.guard.probe(async()=>{calls++;return gate.promise;},args):async()=>true]));
  const readiness=createProductionReadiness({probes,probeTimeoutMs:100});assert.deepEqual(await readiness.publicStatus(),{status:'NOT_READY'});assert.equal(f.guard.status().probeInFlight,true);
  readiness.invalidate();assert.deepEqual(await readiness.publicStatus(),{status:'NOT_READY'});assert.equal(calls,1);
  gate.resolve(true);await new Promise(resolve=>setImmediate(resolve));readiness.invalidate();assert.deepEqual(await readiness.publicStatus(),{status:'READY'});
});
test('V137 CLI validates bounded secret-free plans and redacts every failure',()=>{
  const dir=mkdtempSync(join(tmpdir(),'legaltech-capacity-'));
  try{
    const path=join(dir,'plan.json');writeFileSync(path,JSON.stringify(plan()));const lines=[];
    assert.equal(main([path],{write:s=>lines.push(s)}),0);assert.deepEqual(JSON.parse(lines.pop()),{status:'VALID_PLAN',poolCount:9,perReplica:27,fleetConnections:81,headroom:19});
    for(const input of ['{PRIVATE_VALUE',JSON.stringify({...plan(),password:'PRIVATE_VALUE'}),' '.repeat(32769)]){writeFileSync(path,input);assert.equal(main([path],{write:s=>lines.push(s)}),1);assert.equal(lines.pop(),'{"status":"INVALID_PLAN"}');}
    for(const args of [[],['/missing/PRIVATE_VALUE'],[path,path]])assert.equal(main(args,{write:s=>lines.push(s)}),1);
    writeFileSync(path,JSON.stringify(plan()));const child=spawnSync(process.execPath,['bin/checkDeploymentCapacity.js',path],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).status,'VALID_PLAN');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('V137 service shutdown cannot prove drainage while a canceled database probe remains owned',async()=>{
  const f=fixture(),gate=deferred(),controller=new AbortController();let starts=0;
  const service=bindDeploymentCapacityService({status:()=>({state:'STOPPED'}),start:async()=>{starts++;return {state:'RUNNING'};},stop:async()=>({drained:true,state:'STOPPED'})},f.guard);
  assert.equal((await service.start()).state,'RUNNING');
  const pending=f.guard.probe(()=>gate.promise,{signal:controller.signal});controller.abort();
  assert.equal(service.status().capacityProbeInFlight,true);assert.equal((await service.stop()).drained,false);await assert.rejects(service.start(),/UNVERIFIED/);assert.equal(starts,1);
  gate.resolve(true);assert.equal((await pending).ok,false);assert.equal((await service.stop()).drained,true);assert.equal((await service.start()).state,'RUNNING');
});
test('V137 capacity health cannot override an undrained service or permit a drifted restart',async()=>{
  const f=fixture(),service=bindDeploymentCapacityService({status:()=>({state:'STOP_TIMEOUT'}),start:async()=>assert.fail('drifted start'),stop:async()=>({drained:false})},f.guard);
  assert.equal((await service.stop()).drained,false);f.bindings[0].pool.options.max=3;await assert.rejects(service.start(),/UNVERIFIED/);
  assert.throws(()=>bindDeploymentCapacityService(service,{status:()=>({healthy:true})}),/CONFIGURATION/);
});
test('V137 durable construction requires an explicit fleet budget before provisioning',()=>{
  const f=fixture(),p=f.bindings.map(x=>x.pool);
  const options={processing:{domain:{domainPool:p[0],relayPool:p[1],producerPool:p[2],expectedDomainRole:'domain',expectedRelayRole:'relay',expectedProducerRole:'producer'},
    worker:{workerPool:p[3],domainReaderPool:p[4],expectedWorkerRole:'worker',expectedDomainReaderRole:'domain_reader'},queueReaderPool:p[5],expectedQueueReaderRole:'queue_reader'},
    drain:{workerPool:p[6],operatorPool:p[7],readerPool:p[8],expectedWorkerRole:'drain_worker',expectedOperatorRole:'drain_operator',expectedReaderRole:'drain_reader'}};
  assert.throws(()=>createDurablePostgresProcessingService(options),/DEPLOYMENT_CAPACITY_CONFIGURATION/);
  assert.throws(()=>createDurablePostgresProcessingService({...options,capacity:{...profile(),maxConcurrentReplicas:100}}),/BUDGET_EXCEEDED/);
  const graph=fixture({count:12}).bindings.slice(9);
  const webhooks={producerOptions:{pool:graph[0].pool,expectedRole:'graph_producer'},workerOptions:{pool:graph[1].pool,expectedRole:'graph_worker'},readerOptions:{pool:graph[2].pool,expectedRole:'graph_reader'}};
  const capacity={connectionLimit:38,reservedConnections:20,maxConcurrentReplicas:1,maxWaitingPerPool:4};
  assert.throws(()=>createDurablePostgresProcessingService({...options,capacity,webhooks}),/BUDGET_EXCEEDED/);
});
