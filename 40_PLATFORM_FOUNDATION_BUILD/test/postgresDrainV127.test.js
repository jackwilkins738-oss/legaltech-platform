// Mandatory security concept: V127 durable deployment drain.
import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresDeploymentDrainBackend} from '../src/postgresDeploymentDrain.js';
import {DRAIN_FUNCTION_HASHES} from '../src/postgresDrainFunctionHashes.js';
import {ManagedDeploymentDrain} from '../src/managedDeploymentDrain.js';
import {createDurablePostgresProcessingService} from '../src/durableProcessingService.js';
import {deferred,tick,fixtureDrain} from '../test-support/processingV126.js';

const deploymentId='synthetic-v127',ownerId='12700000-0000-4000-8000-000000000001',token='a'.repeat(64);
const tables=['principal_scopes','deployments','leases','controls','events'];
const view={state:'ACTIVE',generation:2,inFlight:0,acceptingNew:true};
function fake({member={},relations,functions,query=async()=>({rows:[{result:view}]}),authorizeBackend=async()=>true,releaseThrows=false}={}){
  const calls=[],releases=[];
  const pool=role=>({connect:async()=>({query:async(sql,values)=>{
    calls.push({role,sql,values});
    if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:role,login_role:role,tenant_context:null,actor_context:null}]};
    if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};
    if(sql.includes(' AS member,'))return {rows:[{member:true,privileged:false,owns_schema:false,table_access:false,owner_unsafe:false,...member}]};
    if(sql.includes(' AS policy_count'))return {rows:relations??tables.map(relname=>({relname,enabled:true,forced:true,owner:'legaltech_drain_owner',policy_count:'1',owner_policy:true}))};
    if(sql.includes(' AS source_hash'))return {rows:functions??Object.entries(DRAIN_FUNCTION_HASHES).map(([proname,spec])=>({proname,source_hash:spec.hash,arguments:spec.arguments,owner:'legaltech_drain_owner',public_execute:false,definer:proname==='operate',executable:proname==='operate',config:['row_security=on','search_path=pg_catalog, pg_temp']}))};
    if(sql.includes(' AS unsafe'))return {rows:[{unsafe:false}]};
    if(sql.startsWith('SELECT drain_security.operate'))return query(sql,values);
    return {rows:[]};
  },release:destroy=>{releases.push({role,destroy});if(releaseThrows)throw new Error('synthetic-release-failed');}})});
  const options={workerPool:pool('drain_worker'),operatorPool:pool('drain_operator'),readerPool:pool('drain_reader'),expectedWorkerRole:'drain_worker',expectedOperatorRole:'drain_operator',expectedReaderRole:'drain_reader',deploymentId,ownerId,authorizeBackend,timeoutMs:100};
  return {backend:new PostgresDeploymentDrainBackend(options),options,calls,releases};
}
const acquired={token,generation:2};
const acquire=b=>b.acquire({deploymentId,operationId:'work:1',kind:'INGRESS'});

test('V127 construction does not open pools or provision deployment',()=>{assert.equal(fake().calls.length,0);});
for(const field of ['workerPool','operatorPool','readerPool','expectedWorkerRole','expectedOperatorRole','expectedReaderRole','deploymentId','ownerId','authorizeBackend','timeoutMs'])test(`V127 missing/invalid configuration refuses ${field}`,()=>{
  const x=fake();assert.throws(()=>new PostgresDeploymentDrainBackend({...x.options,[field]:null}),/CONFIGURATION/);
});
test('V127 worker/operator/reader pools and roles must remain separate',()=>{
  const x=fake();assert.throws(()=>new PostgresDeploymentDrainBackend({...x.options,readerPool:x.options.workerPool}),/CONFIGURATION/);
  assert.throws(()=>new PostgresDeploymentDrainBackend({...x.options,expectedReaderRole:x.options.expectedWorkerRole}),/CONFIGURATION/);
});
test('V127 acquire binds deployment and stable owner and creates an opaque token before returning only committed lease',async()=>{
  const x=fake({query:async()=>({rows:[{result:acquired}]})});assert.deepEqual(await acquire(x.backend),acquired);
  const call=x.calls.find(c=>c.sql.startsWith('SELECT drain_security.operate'));assert.equal(call.role,'drain_worker');assert.equal(call.values[0],deploymentId);
  const input=JSON.parse(call.values[2]);assert.equal(input.ownerId,ownerId);assert.match(input.token,/^[a-f0-9]{64}$/);
  assert.ok(x.calls.some(c=>c.sql==='COMMIT'));assert.equal(x.releases.at(-1).destroy,false);
});
test('V127 cross-deployment input refuses before connection/authorization',()=>{const x=fake();assert.throws(()=>x.backend.status({deploymentId:'another'}),/UNVERIFIED/);assert.equal(x.calls.length,0);});
for(const field of ['member','privileged','owns_schema','table_access','owner_unsafe'])test(`V127 unsafe role posture closes ${field}`,async()=>{
  const x=fake({member:{[field]:field!=='member'}});await assert.rejects(acquire(x.backend),/UNVERIFIED/);assert.equal(x.calls.some(c=>c.sql.startsWith('SELECT drain_security.operate')),false);assert.equal(x.releases.at(-1).destroy,true);
});
test('V127 missing/disabled forced-RLS policy refuses backend use',async()=>{
  for(const relations of [[],tables.map(relname=>({relname,enabled:true,forced:false,owner:'legaltech_drain_owner',policy_count:'1',owner_policy:true}))]){
    const x=fake({relations});assert.equal((await x.backend.probe()).ok,false);
  }
});
for(const mutate of [f=>f.source_hash='b'.repeat(64),f=>f.owner='unsafe',f=>f.public_execute=true,f=>f.definer=false,f=>f.config=['search_path=public','row_security=on'],f=>f.executable=false])test(`V127 altered function contract fails closed ${mutate.toString()}`,async()=>{
  const functions=Object.entries(DRAIN_FUNCTION_HASHES).map(([proname,v])=>({proname,source_hash:v.hash,arguments:v.arguments,owner:'legaltech_drain_owner',public_execute:false,definer:proname==='operate',executable:proname==='operate',config:['search_path=pg_catalog, pg_temp','row_security=on']}));mutate(functions.find(f=>f.proname==='operate'));
  assert.equal((await fake({functions}).backend.probe()).ok,false);
});
for(const phase of ['ADMIT','DISPATCH','COMMIT'])test(`V127 current strict authorization refuses ${phase} without committed mutation`,async()=>{
  const x=fake({authorizeBackend:async v=>v.phase===phase?false:true,query:async()=>({rows:[{result:acquired}]})});await assert.rejects(acquire(x.backend),/UNVERIFIED/);assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);
});
test('V127 signal cancellation while authorizer waits prevents SQL dispatch',async()=>{
  const d=deferred(),controller=new AbortController(),x=fake({authorizeBackend:async()=>{await d.promise;return true;}});
  const task=x.backend.acquire({deploymentId,operationId:'abort:1',kind:'BACKGROUND',signal:controller.signal});await tick();controller.abort();d.resolve();await assert.rejects(task,/UNVERIFIED/);assert.equal(x.calls.some(c=>c.sql.startsWith('SELECT drain_security.operate')),false);
});
for(const reply of [null,{token:'short',generation:2},{...acquired,extra:'synthetic'},{token,generation:0},{token,generation:Number.MAX_SAFE_INTEGER+1}])test(`V127 malformed lease result cannot commit ${JSON.stringify(reply)}`,async()=>{
  const x=fake({query:async()=>({rows:[{result:reply}]})});await assert.rejects(acquire(x.backend),/UNVERIFIED/);assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);
});
test('V127 forged release acknowledgement cannot discard a tracked lease',async()=>{
  const x=fake({query:async()=>({rows:[{result:{released:true,token:'b'.repeat(64),generation:2}}]})});await assert.rejects(x.backend.release({deploymentId,operationId:'release:1',lease:acquired}),/UNVERIFIED/);
});
test('V127 control replies must attest actual closed initialization and fenced empty resume',async()=>{
  const x=fake();await assert.rejects(x.backend.initialize({operationId:'init:1',actorId:'operator'}),/UNVERIFIED/);
  await assert.rejects(x.backend.begin({deploymentId,operationId:'begin:1',actorId:'operator',reasonHash:token}),/UNVERIFIED/);
  await assert.rejects(x.backend.resume({deploymentId,operationId:'resume:1',actorId:'operator',expectedGeneration:2}),/UNVERIFIED/);
});
test('V127 absence proof requires an exact null lease',async()=>{
  const x=fake({query:async()=>({rows:[{result:{state:'ABSENT',lease:acquired}}]})});await assert.rejects(x.backend.lookupOperation({deploymentId,operationId:'absent:1'}),/UNVERIFIED/);
});
test('V127 unknown provider/release errors remain sanitized and have no local fallback',async()=>{
  const x=fake({query:async()=>{throw new Error('synthetic-provider-secret');}});await assert.rejects(acquire(x.backend),error=>error.message==='POSTGRES_DRAIN_UNVERIFIED');
  const y=fake({releaseThrows:true});assert.equal((await y.backend.probe()).ok,false);
});
test('V127 durable production root requires nine unique pools and disallows backend overrides',()=>{
  assert.throws(()=>createDurablePostgresProcessingService({}),/OVERRIDE/);assert.throws(()=>createDurablePostgresProcessingService({drain:{backend:{}}}),/OVERRIDE/);
  assert.throws(()=>createDurablePostgresProcessingService({processing:{},drain:fake().options}),/SEPARATE_POOLS/);
});
test('V127 status cannot publish health when an acquisition becomes uncertain while its remote read waits',async()=>{
  const d=deferred();let x;x=fixtureDrain({status:async()=>{await d.promise;return {state:'ACTIVE',generation:1,inFlight:0,acceptingNew:true};},acquire:async()=>{throw new Error('synthetic-lost');}});
  const pending=x.drain.status();await tick();await assert.rejects(x.drain.acquire({kind:'INGRESS',operationId:'lost:during-status'}));d.resolve();await assert.rejects(pending,/UNVERIFIED/);
});
test('V127 a status generation older than a held lease cannot attest readiness',async()=>{
  const x=fixtureDrain({acquire:async()=>({token:'synthetic_generation_token',generation:5}),status:async()=>({state:'ACTIVE',generation:4,inFlight:1,acceptingNew:true})});
  await x.drain.acquire({kind:'BACKGROUND',operationId:'rollback:1'});assert.equal((await x.drain.probe()).ok,false);
});
