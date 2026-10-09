import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphSubscriptionLifecycle} from '../src/graphSubscriptionLifecycle.js';

const TENANT='tenant-a';const DIR='11111111-1111-4111-8111-111111111111';const APP='22222222-2222-4222-8222-222222222222';
function fixture(){
  let now=Date.parse('2026-10-09T06:00:00Z'),seq=1;const secrets=new Map(),calls=[];
  const graph={
    async createSubscription(input){calls.push(['create',structuredClone(input)]);return {id:`00000000-0000-4000-8000-${String(seq++).padStart(12,'0')}`,expirationDateTime:input.expirationDateTime};},
    async renewSubscription(id,expirationDateTime){calls.push(['renew',id,expirationDateTime]);return {id,expirationDateTime};},
    async reauthorizeSubscription(id){calls.push(['reauthorize',id]);},
    async deleteSubscription(id){calls.push(['delete',id]);},
  };
  const lifecycle=new GraphSubscriptionLifecycle({graphClient:graph,notificationUrl:'https://notify.example.invalid/graph',lifecycleNotificationUrl:'https://notify.example.invalid/graph/lifecycle',subscriptionLifetimeSeconds:3600,mutationQuietPeriodSeconds:600,now:()=>now,putSecret:async({value})=>{const ref=`secretref://graph/${secrets.size+1}`;secrets.set(ref,value);return ref;},getSecret:async({secretRef})=>secrets.get(secretRef),deleteSecret:async({secretRef})=>{secrets.delete(secretRef);}});
  return {lifecycle,graph,calls,secrets,advance:ms=>now+=ms,setNow:n=>now=n};
}
const createInput={tenantId:TENANT,directoryTenantId:DIR,resource:'/users/user-id/mailFolders(\'inbox\')/messages',changeTypes:['created','updated'],richData:false};

test('V90 creates server-owned subscription with hidden clientState and exact webhook resolver binding',async()=>{
  const f=fixture(),created=await f.lifecycle.create(createInput);assert.equal(created.status,'ACTIVE');assert.equal(created.generation,1);assert.equal('clientState' in created,false);assert.equal('clientStateSecretRef' in created,false);assert.equal(f.secrets.size,1);
  const remote=f.calls[0][1];assert.equal(remote.notificationUrl,'https://notify.example.invalid/graph');assert.equal(remote.lifecycleNotificationUrl,'https://notify.example.invalid/graph/lifecycle');assert.match(remote.clientState,/^[A-Za-z0-9_-]+$/);assert.equal(remote.clientState.length>=40,true);
  const resolved=await f.lifecycle.resolveForWebhook({subscriptionId:created.subscriptionId});assert.equal(resolved.tenantId,TENANT);assert.equal(resolved.directoryTenantId,DIR);assert.equal(resolved.clientState,remote.clientState);
});

test('V90 duplicate active resource subscription is refused and removed predecessor can be replaced',async()=>{
  const f=fixture(),first=await f.lifecycle.create(createInput);await assert.rejects(()=>f.lifecycle.create(createInput),/GRAPH_SUBSCRIPTION_ALREADY_ACTIVE/);const removed=f.lifecycle.applyLifecycleNotification({subscriptionId:first.subscriptionId,event:'subscriptionRemoved'});assert.equal(removed.status,'REMOVED');
  const replacement=await f.lifecycle.create({...createInput,predecessorSubscriptionId:first.subscriptionId});assert.equal(replacement.predecessorSubscriptionId,first.subscriptionId);assert.notEqual(replacement.subscriptionId,first.subscriptionId);
});

test('V90 missed lifecycle fails webhook resolution until explicit recovery evidence completes',async()=>{
  const f=fixture(),created=await f.lifecycle.create(createInput);const missed=f.lifecycle.applyLifecycleNotification({subscriptionId:created.subscriptionId,event:'missed'});assert.equal(missed.status,'RECOVERY_REQUIRED');await assert.rejects(()=>f.lifecycle.resolveForWebhook({subscriptionId:created.subscriptionId}),/GRAPH_SUBSCRIPTION_UNAVAILABLE/);
  const recovered=f.lifecycle.markRecoveryComplete(created.subscriptionId,{evidenceRef:'delta-recovery-2026-10-09'});assert.equal(recovered.status,'ACTIVE');assert.equal(f.lifecycle.events(TENANT).at(-1).evidenceRefHash.length,64);assert.equal(JSON.stringify(f.lifecycle.events(TENANT)).includes('delta-recovery-2026-10-09'),false);
});

test('V90 reauthorizationRequired must be handled but renew/reauthorize mutation collision is blocked',async()=>{
  const f=fixture(),created=await f.lifecycle.create(createInput);f.lifecycle.applyLifecycleNotification({subscriptionId:created.subscriptionId,event:'reauthorizationRequired'});f.advance(10*60*1000);const reauth=await f.lifecycle.reauthorize(created.subscriptionId);assert.equal(reauth.status,'ACTIVE');await assert.rejects(()=>f.lifecycle.renew(created.subscriptionId),/GRAPH_SUBSCRIPTION_MUTATION_TOO_SOON/);f.advance(10*60*1000);const renewed=await f.lifecycle.renew(created.subscriptionId);assert.equal(renewed.status,'ACTIVE');assert.equal(f.calls.filter(x=>x[0]==='renew').length,1);
});

test('V90 renewing can recover REAUTH_REQUIRED in one mutation after quiet period',async()=>{
  const f=fixture(),created=await f.lifecycle.create(createInput);f.advance(10*60*1000);f.lifecycle.applyLifecycleNotification({subscriptionId:created.subscriptionId,event:'reauthorizationRequired'});const renewed=await f.lifecycle.renew(created.subscriptionId);assert.equal(renewed.status,'ACTIVE');assert.equal(f.calls.some(x=>x[0]==='reauthorize'),false);
});

test('V90 expired subscription fails closed and is not returned as a renewal candidate',async()=>{
  const f=fixture(),created=await f.lifecycle.create(createInput);f.advance(61*60*1000);await assert.rejects(()=>f.lifecycle.resolveForWebhook({subscriptionId:created.subscriptionId}),/GRAPH_SUBSCRIPTION_UNAVAILABLE/);assert.equal(f.lifecycle.snapshot(TENANT)[0].status,'EXPIRED');assert.equal(f.lifecycle.dueForRenewal({withinSeconds:3600}).length,0);
});

test('V90 due-for-renewal scan is bounded and ordered without exposing secrets',async()=>{
  const f=fixture();const first=await f.lifecycle.create(createInput);f.lifecycle.applyLifecycleNotification({subscriptionId:first.subscriptionId,event:'subscriptionRemoved'});const second=await f.lifecycle.create({...createInput,predecessorSubscriptionId:first.subscriptionId});f.advance(46*60*1000);const due=f.lifecycle.dueForRenewal({withinSeconds:900,limit:1});assert.equal(due.length,1);assert.equal(due[0].subscriptionId,second.subscriptionId);assert.equal(JSON.stringify(due).includes('secretref'),false);
});

test('V90 managed secret mismatch or unavailable secret fails webhook resolution closed',async()=>{
  const f=fixture(),created=await f.lifecycle.create(createInput),ref=[...f.secrets.keys()][0];f.secrets.set(ref,'wrong');await assert.rejects(()=>f.lifecycle.resolveForWebhook({subscriptionId:created.subscriptionId}),/GRAPH_SUBSCRIPTION_SECRET_INVALID/);f.secrets.delete(ref);await assert.rejects(()=>f.lifecycle.resolveForWebhook({subscriptionId:created.subscriptionId}),/GRAPH_SUBSCRIPTION_SECRET_INVALID/);
});

test('V90 create failure cleans managed clientState and does not publish a local subscription',async()=>{
  const f=fixture();f.graph.createSubscription=async()=>{throw new Error('transport');};await assert.rejects(()=>f.lifecycle.create(createInput),/GRAPH_SUBSCRIPTION_CREATE_FAILED/);assert.equal(f.secrets.size,0);assert.equal(f.lifecycle.snapshot(TENANT).length,0);
});

test('V90 invalid remote identity/expiry cannot enter registry',async()=>{
  const f=fixture();f.graph.createSubscription=async()=>({id:'not-a-guid',expirationDateTime:'2099-01-01T00:00:00Z'});await assert.rejects(()=>f.lifecycle.create(createInput),/GRAPH_SUBSCRIPTION_REMOTE_INVALID/);assert.equal(f.lifecycle.snapshot(TENANT).length,0);
});

test('V90 delete removes secret reference use and does not expose raw resource/clientState in events',async()=>{
  const f=fixture(),created=await f.lifecycle.create(createInput);f.advance(10*60*1000);const deleted=await f.lifecycle.remove(created.subscriptionId);assert.equal(deleted.status,'DELETED');assert.equal(f.secrets.size,0);await assert.rejects(()=>f.lifecycle.resolveForWebhook({subscriptionId:created.subscriptionId}),/GRAPH_SUBSCRIPTION_UNAVAILABLE/);const text=JSON.stringify(f.lifecycle.events(TENANT));assert.equal(text.includes('/users/'),false);assert.equal(text.includes('clientState'),false);
});

test('V90 rich subscription requires pinned app identity and resolver preserves only trusted binding',async()=>{
  const f=fixture(),created=await f.lifecycle.create({...createInput,richData:true,appId:APP});const resolved=await f.lifecycle.resolveForWebhook({subscriptionId:created.subscriptionId});assert.equal(resolved.richData,true);assert.equal(resolved.appId,APP);await assert.rejects(()=>f.lifecycle.create({...createInput,resource:'/users/other/messages',richData:true,appId:'bad'}),/GRAPH_SUBSCRIPTION_APP_INVALID/);
});
