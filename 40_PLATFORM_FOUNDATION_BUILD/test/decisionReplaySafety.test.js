import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Platform} from '../src/platform.js';
import {PlatformStore} from '../src/store.js';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import {writebackScope} from '../src/writeback.js';
const code=c=>e=>e.code===c;
const tuple=(tenant,key)=>JSON.stringify(['approval-v48',tenant,'approve',key]);
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decision-replay-')),x={dir};
  x.open=()=>{x.store=new PlatformStore(path.join(dir,'db.sqlite'),{matters:[{id:'ma',tenantId:'ta',externalId:'PA',externalRefs:['CLM-10001']},{id:'ma2',tenantId:'ta',externalId:'PA2',externalRefs:['CLM-10002']},{id:'mb',tenantId:'tb',externalId:'PB',externalRefs:['CLM-20001']},{id:'mc',tenantId:'ta:approve:x',externalId:'PC',externalRefs:['CLM-30001']}]});x.platform=new Platform({store:x.store,objectStorage:new LocalObjectStorage(path.join(dir,'objects')),aiGateway:new DeterministicAIGateway(),proclaim:new MockProclaimAdapter()});};
  x.open();t.after(()=>{x.store.close();fs.rmSync(dir,{recursive:true,force:true});});
  x.restart=()=>{x.store.close();x.open();};
  x.prepare=async({tenantId='ta',review=false,attachments=[]}={})=>{const a=x.platform.ingest({tenantId,idempotencyKey:x.store.uid('ing'),input:{subject:review?'unknown':tenantId==='ta'?'CLM-10001':tenantId==='tb'?'CLM-20001':'CLM-30001',attachments}});const done=await x.platform.processNext({tenantId,eventId:a.eventId});return {...a,tenantId,exceptionId:done.result.exceptionId};};
  x.approve=(a,more={})=>x.platform.approve({tenantId:a.tenantId,eventId:a.eventId,actorId:'reviewer',idempotencyKey:'decision-key',...more});
  x.cacheScope=(tenant='ta',key='decision-key')=>x.store.getIdempotent(tuple(tenant,key))?tuple(tenant,key):`${tenant}:approve:${key}`;
  x.fail=async()=>{const a=x.platform.ingest({tenantId:'ta',idempotencyKey:x.store.uid('ing'),input:{subject:'unknown'}}),ai=x.platform.aiGateway;x.platform.aiGateway={async classifyInbound(){throw Error('synthetic failure');}};for(let i=0;i<3;i++)await x.platform.processNext({tenantId:'ta',eventId:a.eventId});x.platform.aiGateway=ai;return {...a,tenantId:'ta'};};
  x.recover=(a,more={})=>x.platform.requestInboundRecovery({tenantId:a.tenantId,eventId:a.eventId,actorId:'operator',idempotencyKey:'recovery-key',...more});
  return x;
}
test('approval replay rejects a changed actor without modifying the original decision',async t=>{
  const x=fixture(t),a=await x.prepare();x.approve(a);const before=x.store.getEvent('ta',a.eventId);
  assert.throws(()=>x.approve(a,{actorId:'other'}),code('IDEMPOTENCY_CONFLICT'));assert.deepEqual(x.store.getEvent('ta',a.eventId),before);
});
for(const change of [p=>p.jobId='foreign-private-job',p=>p.matterId='ma2',p=>p.secret='foreign-private-text']) test('approval replay validates and reconstructs cached result',async t=>{
  const x=fixture(t),a=await x.prepare(),first=x.approve(a),scope=x.cacheScope(),previous=x.store.getIdempotent(scope);change(previous);x.store.setIdempotent(scope,previous);
  if(previous.secret)assert.deepEqual(x.approve(a),{...first,replayed:true});else assert.throws(()=>x.approve(a),code('NOT_FOUND'));
});
for(const field of ['tenant','type','event','matter','key','trace']) test(`cached approval verifies job ${field}`,async t=>{
  const x=fixture(t),a=await x.prepare(),r=x.approve(a),job=x.store.getJob(r.jobId);
  if(field==='tenant')x.store.db.prepare("UPDATE jobs SET tenant_id='tb' WHERE id=?").run(job.id);
  if(field==='type')x.store.db.prepare("UPDATE jobs SET type='PROCESS_INBOUND' WHERE id=?").run(job.id);
  if(field==='trace')x.store.db.prepare("UPDATE jobs SET trace_id='foreign-private-trace' WHERE id=?").run(job.id);
  if(['event','matter','key'].includes(field)){job.payload[{event:'eventId',matter:'matterId',key:'approvalKey'}[field]]='foreign-private-value';x.store.db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(job.payload),job.id);}
  assert.throws(()=>x.approve(a),code('NOT_FOUND'));
});
for(const field of ['actorId','eventId','externalMatterId','classification','traceId']) test(`approval replay verifies command ${field}`,async t=>{
  const x=fixture(t),a=await x.prepare();x.approve(a);const scope=writebackScope('ta','decision-key'),command=x.store.getIdempotent(scope);command[field]='foreign-private-value';x.store.setIdempotent(scope,command);
  assert.throws(()=>x.approve(a),code('NOT_FOUND'));
});
for(const more of [{actorId:{}},{actorId:' '},{actorId:'x'.repeat(201)},{idempotencyKey:{}},{idempotencyKey:' '},{idempotencyKey:'a\0b'},{idempotencyKey:'x'.repeat(209)},{exceptionId:{}},{matterId:0}]) test(`malformed approval is rejected before a decision: ${JSON.stringify(more)}`,async t=>{
  const x=fixture(t),a=await x.prepare();assert.throws(()=>x.approve(a,more));assert.equal(x.store.getEvent('ta',a.eventId).status,'READY_FOR_APPROVAL');assert.equal(x.store.listEventJobs('ta',a.eventId,'PROCLAIM_WRITEBACK').length,0);
});
test('review-required event cannot bypass its open exception',async t=>{
  const x=fixture(t),a=await x.prepare({review:true});assert.throws(()=>x.approve(a,{matterId:'ma'}),code('INVALID_REVIEW_STATE'));assert.equal(x.store.getException('ta',a.exceptionId).status,'OPEN');
});
test('deleted attachment after processing cannot be approved',async t=>{
  const x=fixture(t),a=await x.prepare({attachments:[{filename:'proof.pdf',bytes:Buffer.from('%PDF proof')}]});const event=x.store.getEvent('ta',a.eventId);fs.unlinkSync(path.join(x.dir,'objects',event.attachments[0].objectRef+'.bin'));
  assert.throws(()=>x.approve(a),code('ATTACHMENT_UNAVAILABLE'));assert.equal(x.store.listEventJobs('ta',a.eventId,'PROCLAIM_WRITEBACK').length,0);assert.equal(x.store.getEvent('ta',a.eventId).status,'READY_FOR_APPROVAL');
});
test('approval key tuples cannot collide across tenant/key delimiters',async t=>{
  const x=fixture(t),a=await x.prepare(),b=await x.prepare({tenantId:'ta:approve:x'});
  const first=x.approve(a,{idempotencyKey:'x:approve:shared-key'}),second=x.approve(b,{idempotencyKey:'shared-key'});assert.notEqual(first.eventId,second.eventId);
});
test('missing approval cache cannot overwrite an existing writeback command',async t=>{
  const x=fixture(t),a=await x.prepare();x.approve(a);x.store.db.prepare('DELETE FROM idempotency WHERE scope=?').run(x.cacheScope());const before=x.store.getIdempotent(writebackScope('ta','decision-key')),b=await x.prepare();
  assert.throws(()=>x.approve(b),code('IDEMPOTENCY_CONFLICT'));assert.deepEqual(x.store.getIdempotent(writebackScope('ta','decision-key')),before);
});
test('legacy approval cache upgrades only after owned resource and actor proof',async t=>{
  const x=fixture(t),a=await x.prepare(),r=x.approve(a),scope=x.cacheScope(),cached=x.store.getIdempotent(scope);delete cached.requestFingerprint;
  x.store.db.prepare('DELETE FROM idempotency WHERE scope=?').run(scope);x.store.setIdempotent('ta:approve:decision-key',cached);
  const event=x.store.getEvent('ta',a.eventId);delete event.approvedExceptionId;x.store.updateEvent(event);
  assert.deepEqual(x.approve(a),{...r,replayed:true});assert.equal(typeof x.store.getIdempotent(tuple('ta','decision-key')).requestFingerprint,'string');
});
test('same approval replays after restart and completed writeback',async t=>{
  const x=fixture(t),a=await x.prepare(),first=x.approve(a);await x.platform.processWritebackNext();x.restart();assert.deepEqual(x.approve(a),{...first,replayed:true});assert.equal(x.store.listEventJobs('ta',a.eventId,'PROCLAIM_WRITEBACK').length,1);
});
test('recovery replay cannot change actor',async t=>{
  const x=fixture(t),a=await x.fail();x.recover(a);assert.throws(()=>x.recover(a,{actorId:'other'}),code('IDEMPOTENCY_CONFLICT'));
});
test('recovery replay discards untrusted extra fields and count',async t=>{
  const x=fixture(t),a=await x.fail(),first=x.recover(a),scope=JSON.stringify(['inbound-recovery','ta','recovery-key']),cached=x.store.getIdempotent(scope);
  cached.recoveryCount=999;cached.secret='foreign-private-text';x.store.setIdempotent(scope,cached);assert.deepEqual(x.recover(a),{...first,replayed:true});
});
for(const more of [{actorId:'x'.repeat(201)},{actorId:'bad\0actor'},{idempotencyKey:'key\nvalue'}]) test('recovery attribution fields are bounded and control-free',async t=>{
  const x=fixture(t),a=await x.fail();assert.throws(()=>x.recover(a,more));assert.equal(x.store.listEventJobs('ta',a.eventId).length,1);
});
test('legacy recovery with no attributable request proof fails closed',async t=>{
  const x=fixture(t),a=await x.fail();x.recover(a);const scope=JSON.stringify(['inbound-recovery','ta','recovery-key']),cached=x.store.getIdempotent(scope);delete cached.requestFingerprint;delete cached.actorId;x.store.setIdempotent(scope,cached);
  assert.throws(()=>x.recover(a),code('IDEMPOTENCY_UNVERIFIABLE'));assert.equal(x.store.listEventJobs('ta',a.eventId).length,2);
});
for(const method of ['enqueue','setIdempotent','updateReviewEvent','audit']) test(`approval ${method} failure rolls back authorization and queue`,async t=>{
  const x=fixture(t),a=await x.prepare(),before=x.store.getEvent('ta',a.eventId),original=x.store[method].bind(x.store);
  x.store[method]=()=>{throw Error('synthetic persistence failure');};assert.throws(()=>x.approve(a));x.store[method]=original;
  assert.deepEqual(x.store.getEvent('ta',a.eventId),before);assert.equal(x.store.listEventJobs('ta',a.eventId,'PROCLAIM_WRITEBACK').length,0);assert.equal(x.store.getIdempotent(writebackScope('ta','decision-key')),null);assert.equal(x.store.getIdempotent(tuple('ta','decision-key')),null);
  const r=x.approve(a);assert.equal(x.approve(a).jobId,r.jobId);assert.equal(x.store.listEventJobs('ta',a.eventId,'PROCLAIM_WRITEBACK').length,1);
});
test('legacy cache upgrade persistence failure leaves its old proof intact',async t=>{
  const x=fixture(t),a=await x.prepare();x.approve(a);const scope=x.cacheScope(),cached=x.store.getIdempotent(scope);delete cached.requestFingerprint;
  x.store.db.prepare('DELETE FROM idempotency WHERE scope=?').run(scope);x.store.setIdempotent('ta:approve:decision-key',cached);
  x.store.setIdempotent=()=>{throw Error('synthetic upgrade failure');};assert.throws(()=>x.approve(a));assert.equal(x.store.getIdempotent(tuple('ta','decision-key')),null);assert.deepEqual(x.store.getIdempotent('ta:approve:decision-key'),cached);
});
test('maximum public review key remains compatible with the internal approval prefix',async t=>{
  const x=fixture(t),a=await x.prepare({review:true}),request={tenantId:'ta',exceptionId:a.exceptionId,resolution:'APPROVE',matterId:'ma',actorId:'reviewer',idempotencyKey:'k'.repeat(200)};
  const first=x.platform.resolveException(request);assert.equal(x.platform.resolveException(request).jobId,first.jobId);assert.equal(x.store.getJob(first.jobId).payload.approvalKey.length,208);
});
test('cached review approval checks command proof as well as the owned job',async t=>{
  const x=fixture(t),a=await x.prepare({review:true}),request={tenantId:'ta',exceptionId:a.exceptionId,resolution:'APPROVE',matterId:'ma',actorId:'reviewer',idempotencyKey:'review-key'};
  x.platform.resolveException(request);const scope=writebackScope('ta','resolve:review-key'),command=x.store.getIdempotent(scope);command.actorId='foreign-private-actor';x.store.setIdempotent(scope,command);
  assert.throws(()=>x.platform.resolveException(request),code('NOT_FOUND'));
});
test('review replay cannot reuse proof from another request key',async t=>{
  const x=fixture(t),a=await x.prepare({review:true}),request={tenantId:'ta',exceptionId:a.exceptionId,resolution:'APPROVE',matterId:'ma',actorId:'reviewer',idempotencyKey:'review-key'};
  x.platform.resolveException(request);const previous=x.store.getIdempotent(JSON.stringify(['exception-resolve','ta','review-key']));x.store.setIdempotent(JSON.stringify(['exception-resolve','ta','another-key']),previous);
  assert.throws(()=>x.platform.resolveException({...request,idempotencyKey:'another-key'}),code('NOT_FOUND'));
});
test('recovery replay verifies actor fingerprint on the owned queued job',async t=>{
  const x=fixture(t),a=await x.fail(),r=x.recover(a),job=x.store.getJob(r.jobId);job.payload.recoveryFingerprint='foreign-private-proof';x.store.db.prepare('UPDATE jobs SET payload_json=? WHERE id=?').run(JSON.stringify(job.payload),job.id);
  assert.throws(()=>x.recover(a),code('NOT_FOUND'));
});
for(const count of ['1',-1,0.5,Number.MAX_SAFE_INTEGER]) test(`invalid prior recovery count ${count} cannot create a cycle`,async t=>{
  const x=fixture(t),a=await x.fail(),event=x.store.getEvent('ta',a.eventId);event.processing={recoveryCount:count};x.store.updateEvent(event);
  assert.throws(()=>x.recover(a),code('INVALID_PROCESSING_STATE'));assert.equal(x.store.listEventJobs('ta',a.eventId).length,1);
});
test('corrupt attachment after processing blocks approval and same key retries after restoration',async t=>{
  const x=fixture(t),bytes=Buffer.from('%PDF proof'),a=await x.prepare({attachments:[{filename:'proof.pdf',bytes}]}),event=x.store.getEvent('ta',a.eventId),file=path.join(x.dir,'objects',event.attachments[0].objectRef+'.bin');
  fs.writeFileSync(file,'tampered');assert.throws(()=>x.approve(a),code('ATTACHMENT_UNAVAILABLE'));assert.equal(x.store.listEventJobs('ta',a.eventId,'PROCLAIM_WRITEBACK').length,0);
  fs.writeFileSync(file,bytes);assert.equal(x.approve(a).status,'APPROVED');assert.equal(x.approve(a).replayed,true);
});
test('review approval binds the currently recorded exception',async t=>{
  const x=fixture(t),a=await x.prepare({review:true}),event=x.store.getEvent('ta',a.eventId);event.processing.exceptionId='different-exception';x.store.updateEvent(event);
  assert.throws(()=>x.approve(a,{matterId:'ma',exceptionId:a.exceptionId}),code('INVALID_REVIEW_STATE'));assert.equal(x.store.getException('ta',a.exceptionId).status,'OPEN');
});
test('HTTP recovery retries bind the authenticated actor and hide fingerprint metadata',async t=>{
  const {StaticAuthProvider}=await import('../src/auth.js'),{createApiServer}=await import('../src/httpApi.js');
  const x=fixture(t),a=await x.fail(),server=createApiServer({platform:x.platform,devWorkers:true,authProvider:new StaticAuthProvider([{token:'actor-one',tenantId:'ta',actorId:'operator-one',capabilities:['dev:workers','inbound:read']},{token:'actor-two',tenantId:'ta',actorId:'operator-two',capabilities:['dev:workers','inbound:read']}])});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const post=token=>fetch(`http://127.0.0.1:${server.address().port}/api/v1/inbound-events/${a.eventId}/retry-processing`,{method:'POST',headers:{authorization:`Bearer ${token}`,'idempotency-key':'http-recovery-key','content-type':'application/json'},body:'{}'});
  const first=await post('actor-one');assert.equal(first.status,202);assert.equal(Object.hasOwn(await first.json(),'requestFingerprint'),false);
  const changed=await post('actor-two');assert.equal(changed.status,409);assert.equal((await changed.json()).code,'IDEMPOTENCY_CONFLICT');assert.equal((await post('actor-one')).status,202);
  assert.equal(x.store.listEventJobs('ta',a.eventId).length,2);assert.equal(x.store.listAudits('ta').filter(v=>v.action==='INBOUND_RECOVERY_REQUESTED').length,1);
});
for(const field of ['actorId','classification','traceId']) test(`writeback checks approved command ${field} before external I/O`,async t=>{
  const x=fixture(t),a=await x.prepare();x.approve(a);const scope=writebackScope('ta','decision-key'),command=x.store.getIdempotent(scope);command[field]='foreign-private-value';x.store.setIdempotent(scope,command);
  const result=await x.platform.processWritebackNext();assert.equal(x.platform.proclaim.history.length,0);assert.equal(result.status,'FAILED');assert.equal(result.error,'WRITEBACK_INTERNAL_ERROR');
});
test('writeback rejects a job trace that is not bound to the approved event',async t=>{
  const x=fixture(t),a=await x.prepare(),r=x.approve(a);x.store.db.prepare("UPDATE jobs SET trace_id='foreign-private-trace' WHERE id=?").run(r.jobId);
  assert.equal((await x.platform.processWritebackNext()).status,'FAILED');assert.equal(x.platform.proclaim.history.length,0);
});
test('legacy approval cannot endorse an exception that was never resolved',async t=>{
  const x=fixture(t),a=await x.prepare({review:true});x.approve(a,{exceptionId:a.exceptionId,matterId:'ma'});const event=x.store.getEvent('ta',a.eventId);delete event.approvedExceptionId;x.store.updateEvent(event);
  const ex=x.store.getException('ta',a.exceptionId);ex.status='OPEN';delete ex.resolution;x.store.updateException(ex);
  const scope=x.cacheScope(),cached=x.store.getIdempotent(scope);delete cached.requestFingerprint;x.store.db.prepare('DELETE FROM idempotency WHERE scope=?').run(scope);x.store.setIdempotent('ta:approve:decision-key',cached);
  assert.throws(()=>x.approve(a),code('NOT_FOUND'));
});

test('approval namespace cannot collide with writeback domain and tenant names',async()=>{
  const {approvalScope}=await import('../src/approvalRequest.js');assert.notEqual(approvalScope('writeback','shared'),writebackScope('approve','shared'));
});
test('approval namespace cannot collide with review domain and tenant names',async()=>{
  const {approvalScope}=await import('../src/approvalRequest.js'),{reviewScope}=await import('../src/reviewRequest.js');assert.notEqual(approvalScope('exception-resolve','shared'),reviewScope('approve','shared'));
});
