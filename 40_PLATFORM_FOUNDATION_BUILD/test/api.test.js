import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PlatformStore} from '../src/store.js';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import {Platform} from '../src/platform.js';
import {StaticAuthProvider} from '../src/auth.js';
import {createApiServer} from '../src/httpApi.js';

const TEST_DIR=path.dirname(fileURLToPath(import.meta.url));

const seed={matters:[
  {id:'mat_a1',tenantId:'tenant-a',externalId:'P-A1',externalRefs:['CLM-70001']},
  {id:'mat_b1',tenantId:'tenant-b',externalId:'P-B1',externalRefs:['CLM-80001']},
]};

async function fx(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legaltech-api-'));
  const store=new PlatformStore(path.join(dir,'db.sqlite'),seed);
  const platform=new Platform({store,objectStorage:new LocalObjectStorage(path.join(dir,'obj')),aiGateway:new DeterministicAIGateway(),proclaim:new MockProclaimAdapter()});
  const authProvider=new StaticAuthProvider([
    {token:'token-a',actorId:'user-a',tenantId:'tenant-a',capabilities:['matter:read','inbound:read','inbound:create','exception:read','exception:resolve','dev:workers']},
    {token:'token-b',actorId:'user-b',tenantId:'tenant-b',capabilities:['matter:read','inbound:read','inbound:create','exception:read','exception:resolve']},
    {token:'token-limited',actorId:'limited-a',tenantId:'tenant-a',capabilities:['matter:read']},
  ]);
  const server=createApiServer({platform,authProvider,devWorkers:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {dir,store,platform,server,base,async close(){await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

const headers=(token,extra={})=>({authorization:`Bearer ${token}`,'content-type':'application/json',...extra});

test('health is public but matter access requires authentication',async()=>{const x=await fx();try{
  assert.equal((await fetch(`${x.base}/api/v1/health`)).status,200);
  const unauth=await fetch(`${x.base}/api/v1/matters/mat_a1`);assert.equal(unauth.status,401);
}finally{await x.close();}});

test('authenticated tenant can read own matter but cross-tenant object is indistinguishable from missing',async()=>{const x=await fx();try{
  const own=await fetch(`${x.base}/api/v1/matters/mat_a1`,{headers:headers('token-a')});assert.equal(own.status,200);
  const cross=await fetch(`${x.base}/api/v1/matters/mat_b1`,{headers:headers('token-a')});assert.equal(cross.status,404);assert.equal((await cross.json()).code,'NOT_FOUND');
  const missing=await fetch(`${x.base}/api/v1/matters/nope`,{headers:headers('token-a')});assert.equal(missing.status,404);assert.equal((await missing.json()).code,'NOT_FOUND');
}finally{await x.close();}});

test('client cannot spoof tenant on inbound event',async()=>{const x=await fx();try{
  const res=await fetch(`${x.base}/api/v1/inbound-events`,{method:'POST',headers:headers('token-a',{'idempotency-key':'ingest-0001'}),body:JSON.stringify({tenantId:'tenant-b',subject:'CLM-80001',body:'secret'})});
  assert.equal(res.status,404);assert.equal(x.store.countEvents('tenant-a'),0);assert.equal(x.store.countEvents('tenant-b'),0);
}finally{await x.close();}});

test('API enforces idempotency key and server-side tenant scope',async()=>{const x=await fx();try{
  const missing=await fetch(`${x.base}/api/v1/inbound-events`,{method:'POST',headers:headers('token-a'),body:JSON.stringify({subject:'CLM-70001',body:'hello'})});assert.equal(missing.status,400);
  const opts={method:'POST',headers:headers('token-a',{'idempotency-key':'ingest-0002'}),body:JSON.stringify({subject:'CLM-70001',body:'hello'})};
  const a=await (await fetch(`${x.base}/api/v1/inbound-events`,opts)).json();const b=await (await fetch(`${x.base}/api/v1/inbound-events`,opts)).json();assert.equal(a.eventId,b.eventId);assert.equal(b.replayed,true);assert.equal(x.store.countEvents('tenant-a'),1);
}finally{await x.close();}});

test('capability denial does not reveal endpoint resource detail',async()=>{const x=await fx();try{
  const res=await fetch(`${x.base}/api/v1/exceptions`,{headers:headers('token-limited')});assert.equal(res.status,404);assert.equal((await res.json()).code,'NOT_FOUND');
}finally{await x.close();}});

test('ambiguous inbound can be resolved through API and approved writeback is reconciled',async()=>{const x=await fx();try{
  const accepted=await (await fetch(`${x.base}/api/v1/inbound-events`,{method:'POST',headers:headers('token-a',{'idempotency-key':'ingest-0003'}),body:JSON.stringify({subject:'unknown matter',body:'please review'})})).json();
  await fetch(`${x.base}/api/v1/dev/workers/drain-one`,{method:'POST',headers:headers('token-a'),body:JSON.stringify({worker:'inbound'})});
  const listed=await (await fetch(`${x.base}/api/v1/exceptions`,{headers:headers('token-a')})).json();assert.equal(listed.items.length,1);
  const exceptionId=listed.items[0].id;
  const resolved=await fetch(`${x.base}/api/v1/exceptions/${exceptionId}/resolve`,{method:'POST',headers:headers('token-a',{'idempotency-key':'resolve-0001'}),body:JSON.stringify({resolution:'APPROVE',matterId:'mat_a1'})});assert.equal(resolved.status,200);
  await fetch(`${x.base}/api/v1/dev/workers/drain-one`,{method:'POST',headers:headers('token-a'),body:JSON.stringify({worker:'writeback'})});
  assert.equal(x.platform.getEvent('tenant-a',accepted.eventId).status,'COMPLETED');
}finally{await x.close();}});

test('human rejection closes exception and never creates a writeback job',async()=>{const x=await fx();try{
  const accepted=await (await fetch(`${x.base}/api/v1/inbound-events`,{method:'POST',headers:headers('token-a',{'idempotency-key':'ingest-0004'}),body:JSON.stringify({subject:'unknown matter',body:'please review'})})).json();
  await fetch(`${x.base}/api/v1/dev/workers/drain-one`,{method:'POST',headers:headers('token-a'),body:JSON.stringify({worker:'inbound'})});
  const listed=await (await fetch(`${x.base}/api/v1/exceptions`,{headers:headers('token-a')})).json();
  const r=await fetch(`${x.base}/api/v1/exceptions/${listed.items[0].id}/resolve`,{method:'POST',headers:headers('token-a',{'idempotency-key':'reject-0001'}),body:JSON.stringify({resolution:'REJECT',notes:'not related to this firm'})});assert.equal(r.status,200);
  assert.equal(x.platform.getEvent('tenant-a',accepted.eventId).status,'REJECTED');
  assert.equal(await x.platform.processWritebackNext(),null);
}finally{await x.close();}});

test('malformed JSON returns stable safe error envelope',async()=>{const x=await fx();try{
  const r=await fetch(`${x.base}/api/v1/inbound-events`,{method:'POST',headers:headers('token-a',{'idempotency-key':'ingest-0005'}),body:'{"bad"'});assert.equal(r.status,400);const b=await r.json();assert.equal(b.code,'INVALID_JSON');assert.ok(b.trace_id);
}finally{await x.close();}});

test('read-side collection APIs are tenant scoped and capability protected',async()=>{const x=await fx();try{
  x.platform.ingest({tenantId:'tenant-a',idempotencyKey:'list-0001',input:{subject:'CLM-70001',body:'hello'}});await x.platform.processNext();
  const matters=await (await fetch(`${x.base}/api/v1/matters`,{headers:headers('token-a')})).json();assert.equal(matters.items.length,1);assert.equal(matters.items[0].tenantId,'tenant-a');
  const events=await (await fetch(`${x.base}/api/v1/inbound-events`,{headers:headers('token-a')})).json();assert.equal(events.items.length,1);assert.equal(events.items[0].tenantId,'tenant-a');
  const auditDenied=await fetch(`${x.base}/api/v1/audit`,{headers:headers('token-a')});assert.equal(auditDenied.status,404);
}finally{await x.close();}});

test('audit collection is visible only with audit capability',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legaltech-audit-api-'));const store=new PlatformStore(path.join(dir,'db.sqlite'),seed);
  const platform=new Platform({store,objectStorage:new LocalObjectStorage(path.join(dir,'obj')),aiGateway:new DeterministicAIGateway(),proclaim:new MockProclaimAdapter()});
  const authProvider=new StaticAuthProvider([{token:'audit-token',actorId:'audit-user',tenantId:'tenant-a',capabilities:['audit:read']}]);
  const server=createApiServer({platform,authProvider});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{store.audit({tenantId:'tenant-a',traceId:'trc_audit_test',action:'TEST_ACTION',outcome:'SUCCESS'});const r=await fetch(`${base}/api/v1/audit`,{headers:headers('audit-token')});assert.equal(r.status,200);const b=await r.json();assert.equal(b.items[0].action,'TEST_ACTION');}
  finally{await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('synthetic UI is served only from explicit static paths with restrictive headers',async()=>{const x=await fx();try{
  const uiDir=path.resolve(TEST_DIR,'..','ui');
  await new Promise(r=>x.server.close(r));
  const authProvider=new StaticAuthProvider([{token:'token-a',actorId:'user-a',tenantId:'tenant-a',capabilities:['matter:read']}]);
  const server=createApiServer({platform:x.platform,authProvider,uiRoot:uiDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{const page=await fetch(`${base}/`);assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.match(page.headers.get('content-security-policy'),/default-src 'self'/);assert.match(await page.text(),/Matter Progression Operating System/i);const traversal=await fetch(`${base}/..%2Fpackage.json`);assert.equal(traversal.status,401);}
  finally{await new Promise(r=>server.close(r));x.store.close();fs.rmSync(x.dir,{recursive:true,force:true});}
}finally{if(x.server.listening)await x.close();}});


test('operator UI exposes explicit Exception Review and synthetic scenario controls',async()=>{const x=await fx();try{
  const uiDir=path.resolve(TEST_DIR,'..','ui');
  await new Promise(r=>x.server.close(r));
  const authProvider=new StaticAuthProvider([{token:'token-a',actorId:'user-a',tenantId:'tenant-a',capabilities:['matter:read']}]);
  const server=createApiServer({platform:x.platform,authProvider,uiRoot:uiDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{const page=await fetch(`${base}/`);const html=await page.text();assert.match(html,/Exception Review/);assert.match(html,/Conflicting references/);assert.match(html,/AI safety block/);assert.match(html,/Unsafe attachment/);const js=await (await fetch(`${base}/app.js`)).text();assert.match(js,/Proposed controlled action/);assert.match(js,/Matter context/);assert.match(js,/Technical trace & audit/);}
  finally{await new Promise(r=>server.close(r));x.store.close();fs.rmSync(x.dir,{recursive:true,force:true});}
}finally{if(x.server.listening)await x.close();}});

test('operations cockpit exposes priority work and matter progression state',async()=>{const x=await fx();try{
  const uiDir=path.resolve(TEST_DIR,'..','ui');
  await new Promise(r=>x.server.close(r));
  const authProvider=new StaticAuthProvider([{token:'token-a',actorId:'user-a',tenantId:'tenant-a',capabilities:['matter:read']}]);
  const server=createApiServer({platform:x.platform,authProvider,uiRoot:uiDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{const js=await (await fetch(`${base}/app.js`)).text();assert.match(js,/OPERATIONS COCKPIT/);assert.match(js,/Priority work queue/);assert.match(js,/Matter operations/);assert.match(js,/exceptionPriority/);assert.match(js,/Operational state/);}
  finally{await new Promise(r=>server.close(r));x.store.close();fs.rmSync(x.dir,{recursive:true,force:true});}
}finally{if(x.server.listening)await x.close();}});

test('high-tech command centre exposes telemetry, pipeline and keyboard command surface',async()=>{const x=await fx();try{
  const uiDir=path.resolve(TEST_DIR,'..','ui');
  await new Promise(r=>x.server.close(r));
  const authProvider=new StaticAuthProvider([{token:'token-a',actorId:'user-a',tenantId:'tenant-a',capabilities:['matter:read']}]);
  const server=createApiServer({platform:x.platform,authProvider,uiRoot:uiDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{const html=await (await fetch(`${base}/`)).text();const js=await (await fetch(`${base}/app.js`)).text();const css=await (await fetch(`${base}/app.css`)).text();assert.match(html,/Command Layer/);assert.match(html,/Command palette/);assert.match(html,/LATENCY/);assert.match(js,/pipelineView/);assert.match(js,/pingHealth/);assert.match(html,/Keyboard-first navigation/);assert.match(css,/ambient-grid/);assert.match(css,/palette-backdrop/);}
  finally{await new Promise(r=>server.close(r));x.store.close();fs.rmSync(x.dir,{recursive:true,force:true});}
}finally{if(x.server.listening)await x.close();}});


test('operator capability layer exposes search, filters, saved views, notifications and safe bulk triage',async()=>{const x=await fx();try{
  const uiDir=path.resolve(TEST_DIR,'..','ui');
  await new Promise(r=>x.server.close(r));
  const authProvider=new StaticAuthProvider([{token:'token-a',actorId:'user-a',tenantId:'tenant-a',capabilities:['matter:read']}]);
  const server=createApiServer({platform:x.platform,authProvider,uiRoot:uiDir});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try{const html=await (await fetch(`${base}/`)).text();const js=await (await fetch(`${base}/app.js`)).text();const css=await (await fetch(`${base}/app.css`)).text();assert.match(html,/Search matters, events, refs, traces/);assert.match(html,/notificationBtn/);assert.match(js,/filteredEvents/);assert.match(js,/savedViews/);assert.match(js,/bulkRejectSelected/);assert.match(js,/Bulk approval is intentionally prohibited/);assert.match(js,/intelligenceForMatter/);assert.match(css,/notification-drawer/);assert.match(css,/filter-bar/);}
  finally{await new Promise(r=>server.close(r));x.store.close();fs.rmSync(x.dir,{recursive:true,force:true});}
}finally{if(x.server.listening)await x.close();}});

test('v35 Aurora visual system is served as a distinct enterprise command surface',()=>{
  const html=fs.readFileSync(new URL('../ui/index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../ui/app.css',import.meta.url),'utf8');
  assert.match(html,/AURORA \/ CONTROL FABRIC/);assert.match(html,/V35/);assert.match(html,/SECURE WORKSPACE/);assert.match(css,/\.aurora-a/);assert.match(css,/\.scanline/);assert.match(css,/\.context-rail/);assert.match(css,/\.review-grid/);assert.match(css,/backdrop-filter/);
})
