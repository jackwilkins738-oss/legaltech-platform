// Security regression concept: V116 security defect regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {DocumentDeliveryService} from '../src/documentDelivery.js';
import {JitSupportAccessRegistry} from '../src/supportAccess.js';
import {ControlledExportRegistry} from '../src/exportSafety.js';
import {JwksClient} from '../src/productionIdentity.js';
import {EgressPolicy,isPublicAddress} from '../src/egressPolicy.js';
import {createApiServer} from '../src/httpApi.js';
import {StaticAuthProvider} from '../src/auth.js';
import {PlatformStore} from '../src/store.js';
import {Platform} from '../src/platform.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';

const session={tenantId:'tenant-a',actorId:'user-a',sessionId:'ses-a',capabilities:[],roles:[]};
const body=Buffer.from('synthetic'),sha=crypto.createHash('sha256').update(body).digest('hex');
const evidence={document:{tenantId:'tenant-a',matterId:'m1',documentRef:'d1',mode:'INHERIT'},matter:{tenantId:'tenant-a',id:'m1',visibility:'STANDARD'},objectRef:`tenant-a/${sha}`,sha256:sha,size:body.length,contentType:'application/pdf'};
const issue=service=>service.issueGrant({session,documentRef:'d1',traceId:'issue',ttlMs:1000});
const consume=(service,g)=>service.consumeGrant({session,documentRef:'d1',traceId:'read',grantId:g.grantId,token:g.token});
function support({auditEvent=()=>{}}={}){
  const now=Date.now(),registry=new JitSupportAccessRegistry({now:()=>now,auditEvent});
  const actor=(actorId,capabilities)=>({...session,actorId,capabilities,authContext:{method:'OIDC',mfaVerified:true,authTime:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()}});
  const asker=actor('user-a',['support:access:request']),approver=actor('user-b',['support:access:approve']);
  const request=scope=>registry.request({session:asker,scope,matterId:'m1',documentRef:scope==='DOCUMENT_READ'?'d1':null,ticketRef:'TICKET',purpose:'Synthetic support request',traceId:'request'});
  const approve=g=>registry.approve({session:approver,requestId:g.requestId,traceId:'approve'});
  return {registry,asker,approver,request,approve,actor};
}

test('V116 support scopes are exact across all read actions',()=>{
  for(const scope of ['MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ']){
    const x=support(),g=x.request(scope);x.approve(g);
    for(const [required,read] of [
      ['MATTER_READ',()=>x.registry.assertMatterRead(x.asker,{matterId:'m1',traceId:'read'})],
      ['DOCUMENT_READ',()=>x.registry.assertDocumentRead(x.asker,{matterId:'m1',documentRef:'d1',traceId:'read'})],
      ['DIAGNOSTIC_READ',()=>x.registry.assertDiagnosticRead(x.asker,{matterId:'m1',traceId:'read'})]
    ]){if(scope===required)assert.doesNotThrow(read);else assert.throws(read,/SUPPORT_ACCESS_UNAVAILABLE/);}
  }
});
test('V116 failed support request audit creates no request or successful event',()=>{
  const x=support({auditEvent:()=>{throw new Error('AUDIT_DOWN')}});
  assert.throws(()=>x.request('MATTER_READ'),/SUPPORT_ACCESS_AUDIT_UNAVAILABLE/);
  assert.deepEqual(x.registry.events('tenant-a'),[]);
});
test('V116 failed support approval audit leaves grant pending and unusable; retry succeeds',()=>{
  let failed=false;const x=support({auditEvent:()=>{if(failed)throw new Error('AUDIT_DOWN')}}),g=x.request('MATTER_READ');
  failed=true;assert.throws(()=>x.approve(g),/SUPPORT_ACCESS_AUDIT_UNAVAILABLE/);
  assert.equal(x.registry.status({tenantId:'tenant-a',requestId:g.requestId}).status,'PENDING');
  assert.throws(()=>x.registry.assertMatterRead(x.asker,{matterId:'m1',traceId:'read'}),/SUPPORT_ACCESS_UNAVAILABLE/);
  assert.equal(x.registry.events('tenant-a').length,1);
  failed=false;x.approve(g);assert.doesNotThrow(()=>x.registry.assertMatterRead(x.asker,{matterId:'m1',traceId:'read'}));
});
test('V116 failed revocation audit still removes access and never emits a false success',()=>{
  let failed=false;const x=support({auditEvent:()=>{if(failed)throw new Error('AUDIT_DOWN')}}),g=x.request('MATTER_READ');x.approve(g);failed=true;
  assert.throws(()=>x.registry.revoke({session:x.actor('security',['support:access:revoke']),requestId:g.requestId,traceId:'revoke',reason:'Synthetic removal'}),/SUPPORT_ACCESS_AUDIT_UNAVAILABLE/);
  assert.equal(x.registry.status({tenantId:'tenant-a',requestId:g.requestId}).status,'REVOKED');
  assert.equal(x.registry.events('tenant-a').length,2);
  assert.throws(()=>x.registry.assertMatterRead(x.asker,{matterId:'m1',traceId:'read'}),/SUPPORT_ACCESS_UNAVAILABLE/);
});
test('V116 asynchronous audit callbacks cannot silently grant support authority',()=>{
  const x=support({auditEvent:async()=>{}});assert.throws(()=>x.request('MATTER_READ'),/SYNC_AUDIT_REQUIRED/);
});

test('V116 expanded compressed and IPv4-mapped private addresses fail equally',async()=>{
  for(const ip of ['::','0:0:0:0:0:0:0:0','::1','0:0:0:0:0:0:0:1','::ffff:127.0.0.1','0:0:0:0:0:ffff:7f00:1','::ffff:10.0.0.1','fe80::1','fe80:0:0:0:0:0:0:1','fc00::1','ff02::1','64:ff9b::7f00:1','2001:db8::1','2001::1','2002:7f00:1::']){
    assert.equal(isPublicAddress(ip),false,ip);
    const p=new EgressPolicy({resolve:async()=>['8.8.8.8',ip],allowlist:{GRAPH:[{origin:'https://graph.example.invalid'}]}});
    await assert.rejects(()=>p.authorize({purpose:'GRAPH',url:'https://graph.example.invalid/data'}),/NON_PUBLIC_DESTINATION/);
  }
  assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
  assert.equal(isPublicAddress('2606:4700:4700:0:0:0:0:1111'),true);
  assert.equal(isPublicAddress('::ffff:8.8.8.8'),true);
});
test('V116 explicit private-service pins still work and reject address changes',async()=>{
  const p=ip=>new EgressPolicy({resolve:async()=>[ip],allowlist:{INTERNAL:[{origin:'https://service.example.invalid',allowedAddresses:['0:0:0:0:0:0:0:1']}]}});
  assert.equal((await p('0:0:0:0:0:0:0:1').authorize({purpose:'INTERNAL',url:'https://service.example.invalid/data'})).address,'0:0:0:0:0:0:0:1');
  await assert.rejects(()=>p('::1').authorize({purpose:'INTERNAL',url:'https://service.example.invalid/data'}),/PIN_MISMATCH/);
});

test('V116 concurrent document redemption returns bytes at most once',async()=>{
  let reads=0;const service=new DocumentDeliveryService({resolveDocument:async()=>evidence,objectStorage:{get:()=>{reads++;return body}}});
  const g=await issue(service),results=await Promise.allSettled([consume(service,g),consume(service,g)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(reads,1);
});
test('V116 document expiry during resolution prevents storage read',async()=>{
  let now=100000,redeeming=false,reads=0;
  const service=new DocumentDeliveryService({now:()=>now,resolveDocument:async()=>{if(redeeming)now+=1000;return evidence},objectStorage:{get:()=>{reads++;return body}}});
  const g=await issue(service);redeeming=true;await assert.rejects(()=>consume(service,g),/GRANT_INVALID/);assert.equal(reads,0);
});
test('V116 interlock activation during document resolution blocks both issue and redemption',async()=>{
  let blocked=false,activate=false,reads=0;
  const service=new DocumentDeliveryService({securityInterlock:{assertAllowed(){if(blocked)throw new Error('SECURITY_INTERLOCK_ACTIVE')}},resolveDocument:async()=>{if(activate)blocked=true;return evidence},objectStorage:{get:()=>{reads++;return body}}});
  const g=await issue(service);activate=true;await assert.rejects(()=>consume(service,g),/INTERLOCK_ACTIVE/);assert.equal(reads,0);
  blocked=false;await assert.rejects(()=>issue(service),/INTERLOCK_ACTIVE/);
});

function exports(){
  let allowed=true,throws=false;const r=new ControlledExportRegistry({authorizeResource:()=>{if(throws)throw new Error('DOWN');return allowed},validateStorageRef:()=>true});
  const row=r.requestExport({tenantId:'tenant-a',actorId:'user-a',traceId:'request',resourceSet:[{resourceClass:'DOCUMENT',resourceRef:'d1',matterId:'m1'}],format:'ZIP',idempotencyKey:'export-a'});
  r.markReady({tenantId:'tenant-a',actorId:'worker',exportId:row.id,traceId:'ready',manifestHash:row.manifestHash,packageSha256:sha,packageBytes:body.length,storageRef:'managed:synthetic'});
  const grant=()=>r.issueDownloadGrant({tenantId:'tenant-a',actorId:'user-a',exportId:row.id,traceId:'grant',ttlMs:60000});
  const redeem=g=>r.consumeDownloadGrant({tenantId:'tenant-a',actorId:'user-a',grantId:g.grantId,traceId:'read',token:g.token});
  return {r,row,grant,redeem,deny:()=>allowed=false,outage:()=>throws=true};
}
test('V116 withdrawn export resource permission blocks new grants and existing downloads',()=>{
  const x=exports(),g=x.grant();x.deny();assert.throws(x.grant,/RESOURCE_FORBIDDEN/);assert.throws(()=>x.redeem(g),/RESOURCE_FORBIDDEN/);
  assert.equal(x.r.listEvents('tenant-a').some(e=>e.eventType==='EXPORT_DOWNLOADED'),false);
  assert.equal(Object.hasOwn(x.r.getExport('tenant-a',x.row.id),'resourceSet'),false);
});
test('V116 export authorisation outage fails closed at use time',()=>{
  const x=exports(),g=x.grant();x.outage();assert.throws(x.grant,/AUTHORIZATION_UNAVAILABLE/);assert.throws(()=>x.redeem(g),/AUTHORIZATION_UNAVAILABLE/);
});

const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'known',use:'sig',alg:'RS256'};
test('V116 JWKS coalesces concurrent refreshes and globally bounds random unknown IDs',async()=>{
  let calls=0,now=0;const client=new JwksClient({jwksUri:'https://identity.example.invalid/keys',clock:()=>now,fetchImpl:async()=>{calls++;await Promise.resolve();return new Response(JSON.stringify({keys:[key]}))}});
  await Promise.all(Array.from({length:20},()=>client.getKey('known')));assert.equal(calls,1);
  await Promise.allSettled(Array.from({length:20},(_,i)=>client.getKey(`unknown-${i}`)));assert.equal(calls,1);
  now=30000;await Promise.allSettled(Array.from({length:20},(_,i)=>client.getKey(`unknown-${i}`)));assert.equal(calls,2);
});
test('V116 legitimate JWKS rotation works after bounded refresh cooldown',async()=>{
  let now=0,keys=[key];const client=new JwksClient({jwksUri:'https://identity.example.invalid/keys',clock:()=>now,fetchImpl:async()=>new Response(JSON.stringify({keys}))});
  await client.getKey('known');keys=[{...key,kid:'rotated'}];now=30000;assert.ok(await client.getKey('rotated'));
});
test('V116 stalled JWKS headers time out and abort without extra cooldown fetches',async()=>{
  let signal,calls=0;const client=new JwksClient({jwksUri:'https://identity.example.invalid/keys',timeoutMs:100,fetchImpl:async(_url,options)=>{calls++;signal=options.signal;return new Promise(()=>{})}});
  await assert.rejects(()=>client.getKey('known'),e=>e.code==='OIDC_KEY_UNAVAILABLE');assert.equal(signal.aborted,true);
  await assert.rejects(()=>client.getKey('unknown'));assert.equal(calls,1);
});
test('V116 stalled JWKS body is cancelled within the same deadline',async()=>{
  let cancelled=false;const client=new JwksClient({jwksUri:'https://identity.example.invalid/keys',timeoutMs:100,fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true}}))});
  await assert.rejects(()=>client.getKey('known'),e=>e.code==='OIDC_KEY_UNAVAILABLE');assert.equal(cancelled,true);
});

async function api(t,{members=[]}={}){
  const seed={matters:[{tenantId:'tenant-a',id:'private-a',externalId:'SYNTHETIC-A',externalRefs:['CLM-001'],visibility:'PRIVATE'},{tenantId:'tenant-a',id:'private-b',externalId:'SYNTHETIC-B',externalRefs:['CLM-002'],visibility:'PRIVATE'}]};
  const store=new PlatformStore(':memory:',seed);t.after(()=>store.close());
  const platform=new Platform({store,objectStorage:{},aiGateway:new DeterministicAIGateway(),proclaim:new MockProclaimAdapter()});
  const ingested=platform.ingest({tenantId:'tenant-a',idempotencyKey:'synthetic-inbound',input:{sourceSystem:'MANUAL',subject:'CLM-001 CLM-002',body:'Synthetic conflicting references'}});
  await platform.processNext({tenantId:'tenant-a'});
  const authProvider=new StaticAuthProvider([{...session,token:'review-token',capabilities:['inbound:read','exception:read','exception:resolve','matter:read','audit:read'],matterMembershipIds:members}]);
  const server=createApiServer({platform,authProvider});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,headers={authorization:'Bearer review-token'};
  return {store,platform,ingested,fetch:(route,options={})=>fetch(base+route,{...options,headers:{...headers,...options.headers}})};
}
for(const members of [[],['private-a']])test(`V116 private candidate disclosure denied for ${members.length} memberships`,async t=>{
  const x=await api(t,{members});
  for(const route of ['/api/v1/inbound-events','/api/v1/exceptions']){const r=await x.fetch(route);assert.equal(r.status,200);const payload=await r.json();assert.deepEqual(payload.items,[]);assert.equal(JSON.stringify(payload).includes('private-'),false);}
  const detail=await x.fetch('/api/v1/inbound-events/'+x.ingested.eventId);assert.equal(detail.status,404);
  const ex=x.platform.listExceptions('tenant-a')[0];
  const resolve=await x.fetch(`/api/v1/exceptions/${ex.id}/resolve`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'resolve-v116'},body:JSON.stringify({resolution:'REJECT',notes:'Synthetic rejection'})});assert.equal(resolve.status,404);
});
test('V116 authorised candidate review works and permission withdrawal takes effect',async t=>{
  const x=await api(t,{members:['private-a','private-b']});
  for(const route of ['/api/v1/inbound-events','/api/v1/exceptions']){const r=await x.fetch(route);assert.equal(r.status,200);assert.equal((await r.json()).items.length,1);}
  // Changing current matter security makes the same session insufficient.
  const changed=x.store.getMatter('tenant-a','private-b');changed.securityZoneId='new-zone';x.store.db.prepare('UPDATE matters SET data_json=? WHERE tenant_id=? AND id=?').run(JSON.stringify(changed),'tenant-a','private-b');
  const r=await x.fetch('/api/v1/inbound-events/'+x.ingested.eventId);assert.equal(r.status,404);
});
