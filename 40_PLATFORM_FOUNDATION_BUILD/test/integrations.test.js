import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {IntegrationRegistry} from '../src/integrationRegistry.js';
import {MockGraphHarness} from '../src/graphHarness.js';
import {ProclaimValidationHarness} from '../src/proclaimValidation.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import {VerifiedOidcClaimsMapper} from '../src/auth.js';
import {PlatformStore} from '../src/store.js';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';
import {Platform} from '../src/platform.js';
import {StaticAuthProvider} from '../src/auth.js';
import {createApiServer} from '../src/httpApi.js';

test('verified OIDC mapper refuses unverified claims and derives tenant server-side',()=>{
  const mapper=new VerifiedOidcClaimsMapper();
  assert.throws(()=>mapper.mapVerifiedClaims({sub:'u1',tenant_id:'tenant-a'}),/verified oidc claims/i);
  const session=mapper.mapVerifiedClaims({__verified:true,sub:'u1',tenant_id:'tenant-a',roles:['operator'],capabilities:['matter:read'],sid:'s1'});
  assert.equal(session.tenantId,'tenant-a');assert.equal(session.actorId,'u1');assert.deepEqual(session.roles,['operator']);
});

test('Graph harness models subscription renewal and delta checkpoint without live secrets',()=>{
  const registry=new IntegrationRegistry();const graph=new MockGraphHarness({registry,tenantId:'tenant-a'});const conn=graph.configure({mailboxes:['ops@example.invalid']});
  assert.equal(conn.mode,'MOCK');assert.ok(!JSON.stringify(conn).match(/Bearer|client_secret/i));
  const sub=graph.createMailboxSubscription('ops@example.invalid');assert.equal(sub.status,'ACTIVE');
  const renewed=graph.renewSubscription(sub.id);assert.ok(renewed.renewedAt);
  graph.setDelta('ops@example.invalid','delta_1');const snap=graph.snapshot();assert.equal(snap.subscriptions.length,1);assert.equal(snap.deltaCheckpoints.length,1);
});

test('Graph reliability harness deduplicates notifications and exposes retry/dead-letter state',()=>{
  const registry=new IntegrationRegistry();const graph=new MockGraphHarness({registry,tenantId:'tenant-a',maxDeliveryAttempts:2});graph.configure({mailboxes:['ops@example.invalid']});
  const sub=graph.createMailboxSubscription('ops@example.invalid');
  const first=graph.receiveNotification({subscriptionId:sub.id,notificationId:'n-1',resourceId:'message-1'});assert.equal(first.status,'ACCEPTED');assert.equal(first.duplicate,false);
  const duplicate=graph.receiveNotification({subscriptionId:sub.id,notificationId:'n-1',resourceId:'message-1'});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.duplicateCount,1);
  const retry=graph.failDelivery(first.id,'boom');assert.equal(retry.status,'RETRY_SCHEDULED');
  graph.retryDelivery(first.id);const dead=graph.failDelivery(first.id,'boom again');assert.equal(dead.status,'DEAD_LETTER');assert.equal(graph.healthCheck().state,'DEGRADED');
  const recovered=graph.retryDelivery(first.id);assert.equal(recovered.status,'ACCEPTED');
});

test('Proclaim validation keeps live environment checks blocked',async()=>{
  const registry=new IntegrationRegistry();const harness=new ProclaimValidationHarness({registry,adapter:new MockProclaimAdapter(),tenantId:'tenant-a'});harness.configure();
  const r=await harness.runValidation({externalMatterId:'P-1'});assert.equal(r.status,'AMBER');assert.equal(r.fail,0);assert.equal(r.blocked,2);assert.ok(r.checks.some(x=>x.name==='LIVE_API_VERSION'&&x.status==='BLOCKED'));
});

test('integration API is tenant-capability scoped and supports synthetic lifecycle controls',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legaltech-int-'));const store=new PlatformStore(path.join(dir,'db.sqlite'),{matters:[]});const adapter=new MockProclaimAdapter();
  const platform=new Platform({store,objectStorage:new LocalObjectStorage(path.join(dir,'obj')),aiGateway:new DeterministicAIGateway(),proclaim:adapter});
  const registry=new IntegrationRegistry();const graph=new MockGraphHarness({registry,tenantId:'tenant-a'});graph.configure({mailboxes:['ops@example.invalid']});const proclaim=new ProclaimValidationHarness({registry,adapter,tenantId:'tenant-a'});proclaim.configure();
  const integrations={registry,graph,proclaim,summary:(tenantId)=>({items:registry.list(tenantId),graph:graph.healthCheck()})};
  const authProvider=new StaticAuthProvider([{token:'admin',actorId:'a',tenantId:'tenant-a',capabilities:['integration:read','integration:manage']},{token:'limited',actorId:'l',tenantId:'tenant-a',capabilities:[]}]);
  const server=createApiServer({platform,authProvider,integrations});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;const h=t=>({authorization:`Bearer ${t}`,'content-type':'application/json'});
  try{
    assert.equal((await fetch(`${base}/api/v1/integrations`,{headers:h('limited')})).status,404);
    const list=await (await fetch(`${base}/api/v1/integrations`,{headers:h('admin')})).json();assert.equal(list.items.length,2);
    const created=await fetch(`${base}/api/v1/integrations/graph/subscriptions`,{method:'POST',headers:h('admin'),body:JSON.stringify({mailboxId:'ops@example.invalid'})});assert.equal(created.status,201);const createdBody=await created.json();
    const webhook=await fetch(`${base}/api/v1/integrations/graph/webhooks/simulate`,{method:'POST',headers:h('admin'),body:JSON.stringify({subscriptionId:createdBody.subscription.id,notificationId:'api-n1'})});assert.equal(webhook.status,202);
    const valid=await (await fetch(`${base}/api/v1/integrations/proclaim/validate`,{method:'POST',headers:h('admin'),body:'{}'})).json();assert.equal(valid.result.status,'AMBER');
  } finally {await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('v39 integration reliability control plane is present in the Aurora UI',()=>{
  const html=fs.readFileSync(new URL('../ui/index.html',import.meta.url),'utf8');const js=fs.readFileSync(new URL('../ui/app.js',import.meta.url),'utf8');
  assert.match(html,/V54/);assert.match(html,/Integrations/);assert.match(html,/RELIABILITY HARNESS/);assert.match(js,/Integration readiness/);assert.match(js,/Synthetic Graph subscription/);assert.match(js,/Proclaim validation/);assert.match(js,/HARD BOUNDARY/);assert.match(js,/Webhook reliability/);assert.match(js,/Simulate webhook/);
});
