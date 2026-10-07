import test from 'node:test';
import assert from 'node:assert/strict';
import {IntegrationRegistry} from '../src/integrationRegistry.js';
import {MockGraphHarness} from '../src/graphHarness.js';
import {ProclaimValidationHarness} from '../src/proclaimValidation.js';
import {MockProclaimAdapter} from '../src/adapters.js';
const invalid=e=>e.code==='INVALID_REQUEST';
function fixture(adapter=new MockProclaimAdapter()) {
  const registry=new IntegrationRegistry(),proclaim=new ProclaimValidationHarness({registry,adapter,tenantId:'ta'});
  proclaim.configure();return {registry,proclaim,adapter};
}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
for(const thrown of [new Error('private-provider-error'),{message:'private-provider-error'},'private-provider-error',null]) test(`validation never exposes raw adapter failure ${typeof thrown}`,async()=>{
  const x=fixture({async getHistory(){throw thrown;}}),result=await x.proclaim.runValidation();
  assert.equal(result.status,'RED');assert.equal(result.checks.find(c=>c.name==='READ_HISTORY').detail,'SYNTHETIC_HISTORY_READ_FAILED');
  assert.equal(JSON.stringify(x.registry.list('ta')).includes('private-provider-error'),false);
});
for(const response of [null,{},'history',42,[null],[{}],[{tenantId:'tb',externalMatterId:'P',id:'foreign'}],[{tenantId:'ta',externalMatterId:'OTHER',id:'foreign'}]]) test('malformed or foreign history cannot produce a passing read check',async()=>{
  const x=fixture({async getHistory(){return response;}}),r=await x.proclaim.runValidation({externalMatterId:'P'});assert.equal(r.status,'RED');assert.equal(r.fail,1);
});
test('empty valid history is a read pass but cannot prove writes or reconciliation',async()=>{
  const x=fixture(),r=await x.proclaim.runValidation();assert.equal(r.status,'AMBER');assert.equal(r.pass,1);assert.equal(r.notTested,2);assert.equal(r.blocked,2);
  for(const name of ['WRITE_IDEMPOTENCY_CONTRACT','WRITE_READ_RECONCILIATION'])assert.equal(r.checks.find(c=>c.name===name).status,'NOT_TESTED');assert.equal(x.adapter.history.length,0);
});
test('capability discovery advertises actual callable adapter methods only',()=>{
  const x=fixture({async getHistory(){return [];}}),caps=x.registry.get('ta','PROCLAIM').capabilities;assert.deepEqual(caps,['GET_HISTORY']);
});
test('validation cannot silently restore revoked read capability',async()=>{
  const x=fixture();x.registry.upsert({tenantId:'ta',kind:'PROCLAIM',capabilities:[]});let reads=0;x.adapter.getHistory=async()=>{reads++;return [];};
  const r=await x.proclaim.runValidation();assert.equal(r.status,'RED');assert.equal(reads,0);assert.deepEqual(x.registry.get('ta','PROCLAIM').capabilities,[]);
});
for(const externalMatterId of [{},'', 'a\0b', 'x'.repeat(513)]) test('invalid validation target is rejected before adapter I/O',async()=>{
  let reads=0;const x=fixture({async getHistory(){reads++;return [];}});await assert.rejects(x.proclaim.runValidation({externalMatterId}),invalid);assert.equal(reads,0);
});
test('older validation response cannot overwrite a newer failure',async()=>{
  const first=gate(),started=gate();let calls=0;const x=fixture({async getHistory(){if(calls++===0){started.resolve();return first.promise;}throw Error('private-provider-error');}});
  const old=x.proclaim.runValidation();await started.promise;const fresh=await x.proclaim.runValidation();assert.equal(fresh.status,'RED');first.resolve([]);const stale=await old;
  assert.equal(stale.superseded,true);assert.equal(stale.persisted,false);assert.equal(x.registry.get('ta','PROCLAIM').metadata.lastValidation.status,'RED');
});
test('configuration change retires an in-flight validation and clears old evidence',async()=>{
  const wait=gate(),started=gate(),x=fixture({async getHistory(){started.resolve();return wait.promise;}}),pending=x.proclaim.runValidation();await started.promise;
  x.proclaim.configure({endpointLabel:'new-synthetic-endpoint'});wait.resolve([]);assert.equal((await pending).superseded,true);assert.equal(x.registry.get('ta','PROCLAIM').metadata.lastValidation,null);
});
test('registry reconfiguration during validation cannot be overwritten',async()=>{
  const wait=gate(),started=gate(),x=fixture({async getHistory(){started.resolve();return wait.promise;}}),pending=x.proclaim.runValidation();await started.promise;
  x.registry.upsert({tenantId:'ta',kind:'PROCLAIM',capabilities:[],status:'REVOKED'});wait.resolve([]);assert.equal((await pending).superseded,true);assert.equal(x.registry.get('ta','PROCLAIM').status,'REVOKED');
});
test('caller cannot mutate the stored validation result after return',async()=>{
  const x=fixture(),r=await x.proclaim.runValidation();r.checks[0].status='FORGED';assert.equal(x.registry.get('ta','PROCLAIM').metadata.lastValidation.checks[0].status,'PASS');
});
test('registry deep copies original metadata input and returned snapshots',()=>{
  const r=new IntegrationRegistry(),metadata={mailboxes:['approved']},health={details:{state:'HEALTHY'}};
  const out=r.upsert({tenantId:'ta',kind:'MICROSOFT_GRAPH',metadata,health});metadata.mailboxes.push('foreign');health.details.state='FORGED';out.metadata.mailboxes.push('also-foreign');
  assert.deepEqual(r.get('ta','MICROSOFT_GRAPH').metadata.mailboxes,['approved']);assert.equal(r.get('ta','MICROSOFT_GRAPH').health.details.state,'HEALTHY');
});
for(const change of [{tenantId:{}},{kind:{}},{capabilities:'MAIL_READ'},{capabilities:[{}]},{metadata:[]},{health:null},{metadata:{value:1n}},{metadata:{value:()=>1}},{metadata:{value:NaN}}]) test('invalid registry record is rejected atomically',()=>{
  const r=new IntegrationRegistry();r.upsert({tenantId:'ta',kind:'MICROSOFT_GRAPH',status:'READY'});const before=r.list('ta');
  assert.throws(()=>r.upsert({tenantId:'ta',kind:'MICROSOFT_GRAPH',...change}),invalid);assert.deepEqual(r.list('ta'),before);
});
test('cyclic registry metadata is rejected without corrupting an existing record',()=>{
  const r=new IntegrationRegistry();r.upsert({tenantId:'ta',kind:'MICROSOFT_GRAPH'});const before=r.list('ta'),metadata={};metadata.self=metadata;
  assert.throws(()=>r.upsert({tenantId:'ta',kind:'MICROSOFT_GRAPH',metadata}),invalid);assert.deepEqual(r.list('ta'),before);
});
test('successful registry updates advance revision while preserving the connection ID',()=>{
  const r=new IntegrationRegistry(),a=r.upsert({tenantId:'ta',kind:'PROCLAIM'}),b=r.upsert({tenantId:'ta',kind:'PROCLAIM',status:'READY'});assert.equal(a.id,b.id);assert.equal(b.revision,a.revision+1);
});
test('Graph checkpoint tokens remain internal across mutation results and snapshots',()=>{
  const registry=new IntegrationRegistry(),graph=new MockGraphHarness({registry,tenantId:'ta'});graph.configure({mailboxes:['approved@example.invalid']});
  const r=graph.setDelta('approved@example.invalid','private-checkpoint-token');assert.equal(JSON.stringify(r).includes('private-checkpoint-token'),false);assert.equal(JSON.stringify(graph.snapshot()).includes('private-checkpoint-token'),false);
  assert.equal(graph.delta.get('approved@example.invalid'),'private-checkpoint-token');assert.equal(graph.snapshot().deltaCheckpoints[0].checkpointPresent,true);
});
test('Graph checkpoint-only scope revocation is visibly degraded',()=>{
  const registry=new IntegrationRegistry(),graph=new MockGraphHarness({registry,tenantId:'ta'});graph.configure({mailboxes:['approved@example.invalid']});graph.setDelta('approved@example.invalid','private-checkpoint-token');graph.configure({reader:false,mailboxes:['approved@example.invalid']});
  assert.equal(graph.healthCheck().state,'DEGRADED');assert.equal(graph.healthCheck().checkpointAttention,1);assert.equal(graph.snapshot().deltaCheckpoints[0].scopeStatus,'OUT_OF_SCOPE');
});
test('malformed mailbox configuration fails closed rather than crashing snapshot',()=>{
  const registry=new IntegrationRegistry(),graph=new MockGraphHarness({registry,tenantId:'ta'});graph.configure({mailboxes:['approved@example.invalid']});graph.createMailboxSubscription('approved@example.invalid');
  registry.upsert({tenantId:'ta',kind:'MICROSOFT_GRAPH',capabilities:['MAIL_READ'],metadata:{mailboxes:null}});assert.equal(graph.snapshot().subscriptions[0].status,'OUT_OF_SCOPE');assert.throws(()=>graph.setDelta('approved@example.invalid','delta'),e=>e.code==='NOT_FOUND');
});
for(const value of ['bad\0value','bad\nvalue']) test('Graph opaque input control characters are rejected before state mutation',()=>{
  const registry=new IntegrationRegistry(),graph=new MockGraphHarness({registry,tenantId:'ta'});graph.configure({mailboxes:['approved@example.invalid']});
  assert.throws(()=>graph.setDelta('approved@example.invalid',value),invalid);assert.equal(graph.delta.size,0);
});
test('configuration alone cannot claim healthy validated Proclaim evidence',()=>{
  const x=fixture();assert.equal(x.registry.get('ta','PROCLAIM').health.state,'UNVERIFIED');
});
test('successful read validation still reports incomplete connector evidence',async()=>{
  const x=fixture();await x.proclaim.runValidation();const conn=x.registry.get('ta','PROCLAIM');assert.equal(conn.status,'VALIDATION_INCOMPLETE');assert.equal(conn.health.state,'READ_ONLY_VALIDATED');
});
test('registry tuple namespaces cannot alias tenant/kind delimiters',()=>{
  const r=new IntegrationRegistry(),a=r.upsert({tenantId:'ta',kind:'B:PROCLAIM',metadata:{value:'one'}}),b=r.upsert({tenantId:'ta:B',kind:'PROCLAIM',metadata:{value:'two'}});
  assert.notEqual(a.id,b.id);assert.equal(r.get('ta','B:PROCLAIM').metadata.value,'one');assert.equal(r.get('ta:B','PROCLAIM').metadata.value,'two');
});
test('metadata accessors are rejected before executing caller code',()=>{
  const r=new IntegrationRegistry();let calls=0;const metadata={};Object.defineProperty(metadata,'value',{enumerable:true,get(){calls++;return 'private-provider-error';}});
  assert.throws(()=>r.upsert({tenantId:'ta',kind:'PROCLAIM',metadata}),invalid);assert.equal(calls,0);assert.equal(r.list('ta').length,0);
});
for(const metadata of [{value:'x'.repeat(256*1024)},{value:new Date()},{value:Symbol('invalid')},{value:Infinity}]) test('registry metadata remains bounded and JSON-safe',()=>{
  const r=new IntegrationRegistry();assert.throws(()=>r.upsert({tenantId:'ta',kind:'PROCLAIM',metadata}),invalid);assert.equal(r.list('ta').length,0);
});
test('too-deep registry metadata is rejected without storing a connection',()=>{
  const r=new IntegrationRegistry(),metadata={};let node=metadata;for(let i=0;i<12;i++){node.child={};node=node.child;}
  assert.throws(()=>r.upsert({tenantId:'ta',kind:'PROCLAIM',metadata}),invalid);assert.equal(r.list('ta').length,0);
});
test('valid owned history passes without retaining provider payload text',async()=>{
  const x=fixture({async getHistory(){return [{id:'history-one',tenantId:'ta',externalMatterId:'P',payload:{text:'private-document-text'}}];}}),r=await x.proclaim.runValidation({externalMatterId:'P'});
  assert.equal(r.pass,1);assert.equal(r.fail,0);assert.equal(JSON.stringify(x.registry.list('ta')).includes('private-document-text'),false);
});
test('missing configured connection denies validation before I/O',async()=>{
  const registry=new IntegrationRegistry();let calls=0;const proclaim=new ProclaimValidationHarness({registry,tenantId:'ta',adapter:{async getHistory(){calls++;return [];}}});
  await assert.rejects(proclaim.runValidation(),e=>e.code==='NOT_FOUND');assert.equal(calls,0);
});
test('newer successful validation cannot be replaced by an older failed response',async()=>{
  const wait=gate(),started=gate();let calls=0;const x=fixture({async getHistory(){if(calls++===0){started.resolve();await wait.promise;throw Error('private-provider-error');}return [];}}),old=x.proclaim.runValidation();await started.promise;
  const fresh=await x.proclaim.runValidation();wait.resolve();assert.equal((await old).superseded,true);assert.equal(x.registry.get('ta','PROCLAIM').metadata.lastValidation.status,fresh.status);
});
test('reconfiguration clears completed validation evidence',async()=>{
  const x=fixture();await x.proclaim.runValidation();x.proclaim.configure({apiVersion:'OTHER-SYNTHETIC'});const conn=x.registry.get('ta','PROCLAIM');assert.equal(conn.metadata.lastValidation,null);assert.equal(conn.health.state,'UNVERIFIED');
});
test('invalid reconfiguration cannot retire a valid in-flight check',async()=>{
  const wait=gate(),started=gate(),x=fixture({async getHistory(){started.resolve();return wait.promise;}}),pending=x.proclaim.runValidation();await started.promise;
  assert.throws(()=>x.proclaim.configure({apiVersion:{}}),invalid);wait.resolve([]);assert.equal((await pending).persisted,true);
});
test('UI renders checkpoint presence without rendering legacy opaque token fields',async()=>{
  const fs=await import('node:fs'),vm=await import('node:vm'),source=fs.readFileSync(new URL('../ui/app.js',import.meta.url),'utf8');
  const c=vm.createContext({localStorage:{getItem:()=>null},document:{querySelector:()=>({})},performance:{now:()=>0}});vm.runInContext(source.slice(0,source.indexOf('const commands=')),c);
  vm.runInContext("state.graph.deltaCheckpoints=[{mailboxId:'approved@example.invalid',token:'private-checkpoint-token',checkpointPresent:true,scopeStatus:'OUT_OF_SCOPE'}]",c);
  const html=vm.runInContext('integrationsView()',c);assert.match(html,/Checkpoint recorded/);assert.match(html,/OUT_OF_SCOPE/);assert.doesNotMatch(html,/private-checkpoint-token/);
});
test('HTTP validation and Graph snapshots never expose failure text or checkpoint tokens',async t=>{
  const {createApiServer}=await import('../src/httpApi.js'),{StaticAuthProvider}=await import('../src/auth.js'),{PlatformStore}=await import('../src/store.js');
  const x=fixture({async getHistory(){throw Error('private-provider-error');}}),graph=new MockGraphHarness({registry:x.registry,tenantId:'ta'});graph.configure({mailboxes:['approved@example.invalid']});
  const store=new PlatformStore(),server=createApiServer({platform:{store},authProvider:new StaticAuthProvider([{token:'test-admin',tenantId:'ta',actorId:'admin',capabilities:['integration:read','integration:manage']}]),integrations:{registry:x.registry,graph,proclaim:x.proclaim,summary:tenant=>({items:x.registry.list(tenant),graph:graph.healthCheck()})}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();});
  const base=`http://127.0.0.1:${server.address().port}`,headers={authorization:'Bearer test-admin','content-type':'application/json'};
  const validate=await fetch(base+'/api/v1/integrations/proclaim/validate',{method:'POST',headers,body:'{}'});assert.equal(validate.status,200);const body=await validate.text();assert.match(body,/SYNTHETIC_HISTORY_READ_FAILED/);assert.doesNotMatch(body,/private-provider-error/);
  const checkpoint=await fetch(base+'/api/v1/integrations/graph/delta-checkpoints',{method:'POST',headers,body:JSON.stringify({mailboxId:'approved@example.invalid',deltaToken:'private-checkpoint-token'})});assert.equal(checkpoint.status,200);assert.doesNotMatch(await checkpoint.text(),/private-checkpoint-token/);
  for(const path of ['/api/v1/integrations','/api/v1/integrations/graph']){const response=await fetch(base+path,{headers});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/private-provider-error|private-checkpoint-token/);}
});
test('UI cannot present failed, stale or unproved validation as a success',async()=>{
  const fs=await import('node:fs'),vm=await import('node:vm'),source=fs.readFileSync(new URL('../ui/app.js',import.meta.url),'utf8');
  const c=vm.createContext({localStorage:{getItem:()=>null},document:{querySelector:()=>({})},performance:{now:()=>0}});vm.runInContext(source.slice(0,source.indexOf('const commands=')),c);
  vm.runInContext("globalThis.notices=[];notice=(message,error=false)=>notices.push({message,error});proclaimValidationNotice({status:'RED',persisted:true,mode:'MOCK'});proclaimValidationNotice({status:'AMBER',superseded:true});proclaimValidationNotice({status:'GREEN',persisted:true,mode:'MOCK'});proclaimValidationNotice({status:'AMBER',persisted:true,mode:'MOCK'});",c);
  assert.deepEqual(Array.from(c.notices,x=>x.error),[true,true,true,false]);assert.match(c.notices[3].message,/remain unverified/);
});
