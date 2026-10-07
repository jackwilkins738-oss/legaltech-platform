import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PlatformStore} from '../src/store.js';
import {Platform} from '../src/platform.js';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import {StaticAuthProvider} from '../src/auth.js';
import {createApiServer} from '../src/httpApi.js';
import {ingestScope} from '../src/inboundRequest.js';

function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inbound-request-')),db=path.join(dir,'db.sqlite'),x={};
  x.open=()=>{x.store=new PlatformStore(db);x.platform=new Platform({store:x.store,
    objectStorage:new LocalObjectStorage(path.join(dir,'objects')),aiGateway:new DeterministicAIGateway(),proclaim:new MockProclaimAdapter()});};
  x.open();x.close=()=>{x.store.close();fs.rmSync(dir,{recursive:true,force:true});};
  x.ingest=(input,key='request-key',tenantId='tenant-a')=>x.platform.ingest({tenantId,idempotencyKey:key,input});
  x.jobs=()=>Number(x.store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n);
  return x;
}
const input=()=>({sourceSystem:'MANUAL',externalEventId:'source-id',subject:'original subject',body:'original body',attachments:[{filename:'a.pdf',contentType:'application/pdf',bytes:Buffer.from('%PDF first')},{filename:'b.pdf',contentType:'application/pdf',bytes:Buffer.from('%PDF second')}]});
const changes={
  subject:i=>i.subject='different',body:i=>i.body='different',sourceSystem:i=>i.sourceSystem='MANUAL_UPLOAD',
  externalEventId:i=>i.externalEventId='other-id',filename:i=>i.attachments[0].filename='different.pdf',
  contentType:i=>i.attachments[0].contentType='text/plain',bytes:i=>i.attachments[0].bytes=Buffer.from('%PDF other'),
  attachmentOrder:i=>i.attachments.reverse(),attachmentCount:i=>i.attachments.pop(),
};
for(const [field,change] of Object.entries(changes))test(`ingest replay rejects changed ${field} without side effects`,()=>{
  const x=fixture();try{const a=x.ingest(input()),different=input();change(different);
    assert.throws(()=>x.ingest(different),e=>e.status===409&&e.code==='IDEMPOTENCY_CONFLICT');
    assert.equal(x.store.countEvents('tenant-a'),1);assert.equal(x.jobs(),1);assert.equal(x.store.listAudits('tenant-a').length,1);
    assert.equal(x.ingest(input()).eventId,a.eventId);
  }finally{x.close();}
});

test('quarantined attachment bytes also bind replay identity',()=>{
  const x=fixture();try{const original={attachments:[{filename:'a.exe',bytes:Buffer.from('first')}]};x.ingest(original);
    assert.throws(()=>x.ingest({attachments:[{filename:'a.exe',bytes:Buffer.from('second')}]}),e=>e.code==='IDEMPOTENCY_CONFLICT');
    assert.equal(x.store.countEvents('tenant-a'),1);assert.equal(x.jobs(),1);
  }finally{x.close();}
});

test('omitted defaults and equivalent normalized input replay exactly once',()=>{
  const x=fixture();try{const a=x.ingest({}),b=x.ingest({sourceSystem:'MANUAL',externalEventId:null,subject:'',body:'',attachments:[]});
    assert.equal(a.eventId,b.eventId);assert.equal(b.replayed,true);assert.equal(x.jobs(),1);
    assert.equal(x.store.listAudits('tenant-a').length,1);
  }finally{x.close();}
});

test('durable content fingerprint survives restart and processing state change',async()=>{
  const x=fixture();try{const a=x.ingest(input());await x.platform.processNext();x.store.close();x.open();
    assert.equal(x.ingest(input()).eventId,a.eventId);assert.equal(x.ingest(input()).traceId,a.traceId);
    const other=input();other.body='other';assert.throws(()=>x.ingest(other),e=>e.code==='IDEMPOTENCY_CONFLICT');
    assert.equal(x.jobs(),1);
  }finally{x.close();}
});

test('delimiter-qualified tenant/key pairs cannot collide for new requests',()=>{
  const x=fixture();try{const a=x.ingest({subject:'A'},'x:ingest:key','tenant-a');
    const b=x.ingest({subject:'B'},'key','tenant-a:ingest:x');assert.notEqual(a.eventId,b.eventId);
    assert.equal(x.ingest({subject:'A'},'x:ingest:key','tenant-a').eventId,a.eventId);
    assert.equal(x.ingest({subject:'B'},'key','tenant-a:ingest:x').eventId,b.eventId);
  }finally{x.close();}
});

function legacy(x,accepted,key) {
  const event=x.store.getEvent('tenant-a',accepted.eventId);delete event.ingestFingerprint;x.store.updateEvent(event);
  x.store.db.prepare('DELETE FROM idempotency WHERE scope=?').run(ingestScope('tenant-a',key));
  x.store.setIdempotent(`tenant-a:ingest:${key}`,accepted);return event;
}
test('legacy text-only replay is checked and upgraded without creating an event',()=>{
  const x=fixture();try{const key='legacy-test',original={subject:'original'},a=x.ingest(original,key);legacy(x,a,key);
    assert.throws(()=>x.ingest({subject:'different'},key),e=>e.code==='IDEMPOTENCY_CONFLICT');
    assert.equal(x.store.getEvent('tenant-a',a.eventId).ingestFingerprint,undefined);
    assert.equal(x.ingest(original,key).eventId,a.eventId);
    assert.match(x.store.getEvent('tenant-a',a.eventId).ingestFingerprint,/^v41:/);
    assert.equal(x.jobs(),1);assert.equal(x.store.listAudits('tenant-a').length,1);
  }finally{x.close();}
});
test('legacy attachment replay stays unverified instead of guessing missing identity',()=>{
  const x=fixture();try{const key='legacy-test',a=x.ingest(input(),key),event=legacy(x,a,key);
    assert.throws(()=>x.ingest(input(),key),e=>e.status===409&&e.code==='IDEMPOTENCY_UNVERIFIABLE');
    assert.deepEqual(x.store.getEvent('tenant-a',a.eventId),event);assert.equal(x.jobs(),1);
  }finally{x.close();}
});
test('legacy delimiter collision never reveals another tenant event',()=>{
  const x=fixture();try{const key='x:ingest:key',a=x.ingest({subject:'private'},key);legacy(x,a,key);
    assert.throws(()=>x.ingest({subject:'other'},'key','tenant-a:ingest:x'),e=>e.status===404&&e.code==='NOT_FOUND');
    assert.equal(x.store.countEvents('tenant-a:ingest:x'),0);assert.equal(x.jobs(),1);
  }finally{x.close();}
});
test('cached event/job ownership is verified before returning a replay',()=>{
  const x=fixture();try{const a=x.ingest({subject:'A'}),b=x.ingest({subject:'B'},'another-key','tenant-b');
    const scope=ingestScope('tenant-a','request-key');x.store.setIdempotent(scope,b);
    assert.throws(()=>x.ingest({subject:'A'}),e=>e.status===404);
    x.store.setIdempotent(scope,{...a,jobId:b.jobId});assert.throws(()=>x.ingest({subject:'A'}),e=>e.status===404);
    for (const bad of [{}, {...a,jobId:null}]) {x.store.setIdempotent(scope,bad);assert.throws(()=>x.ingest({subject:'A'}),e=>e.status===404);}
    x.store.setIdempotent(scope,{...a,traceId:'untrusted-cache-value'});
    assert.equal(x.ingest({subject:'A'}).traceId,a.traceId);
  }finally{x.close();}
});
test('missing original resource cannot produce accepted replay',()=>{
  const x=fixture();try{const a=x.ingest({});x.store.db.prepare('DELETE FROM inbound_events WHERE id=?').run(a.eventId);
    assert.throws(()=>x.ingest({}),e=>e.status===404);assert.equal(x.jobs(),1);
  }finally{x.close();}
});
test('malformed direct input is rejected before storage or database writes',()=>{
  const x=fixture();try{let puts=0;x.platform.objectStorage.put=()=>{puts++;return {objectRef:'unexpected'};};
    for(const bad of [null,[],{subject:42},{body:[]},{externalEventId:{}},{sourceSystem:''},{attachments:{}},
      {attachments:[{filename:'../a.pdf'}]},{attachments:[{filename:'a.pdf',bytes:'text'}]},
      {attachments:[{filename:'valid.pdf',bytes:Buffer.from('one')},{filename:'invalid\0.pdf'}]}]) {
      assert.throws(()=>x.ingest(bad),e=>e.status===400);
    }
    assert.equal(puts,0);assert.equal(x.store.countEvents('tenant-a'),0);assert.equal(x.jobs(),0);
  }finally{x.close();}
});

async function apiFixture() {
  const x=fixture(),authProvider=new StaticAuthProvider([
    {token:'test-a',actorId:'actor-a',tenantId:'tenant-a',capabilities:['inbound:create']},
    {token:'test-b',actorId:'actor-b',tenantId:'tenant-a:ingest:x',capabilities:['inbound:create']},
  ]);x.server=createApiServer({platform:x.platform,authProvider});
  await new Promise(r=>x.server.listen(0,'127.0.0.1',r));
  x.post=(body,key='http-request-key',token='test-a')=>fetch(`http://127.0.0.1:${x.server.address().port}/api/v1/inbound-events`,{
    method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
  const close=x.close;x.close=async()=>{await new Promise(r=>x.server.close(r));close();};return x;
}

test('HTTP rejects malformed upload metadata/types and base64 before any acceptance',async()=>{
  const x=await apiFixture();try{
    for(const attachment of [null,[],{filename:''},{filename:'a\0.pdf'},{filename:'folder/a.pdf'},
      {filename:'a.pdf',contentType:{}},{filename:'a.pdf',text:{}},{filename:'a.pdf',base64:42},
      {filename:'a.pdf',base64:'%%%'},{filename:'a.pdf',base64:'QQ'},{filename:'a.pdf',base64:'AB=='},
      {filename:'a.pdf',base64:'QQ==\n'},{filename:'a.pdf',base64:'QQ==',text:'A'}]) {
      const response=await x.post({attachments:[attachment]});assert.equal(response.status,400);
      const body=await response.json();assert.equal(body.code,'INVALID_REQUEST');assert.ok(body.trace_id);
    }
    for(const body of [{externalEventId:{}},{attachments:Array.from({length:101},()=>({filename:'a.txt',text:''}))}])assert.equal((await x.post(body)).status,400);
    assert.equal(x.store.countEvents('tenant-a'),0);assert.equal(x.jobs(),0);assert.equal(x.store.listAudits('tenant-a').length,0);
  }finally{await x.close();}
});
test('text/base64 representation and property order normalize to the same request',async()=>{
  const x=await apiFixture();try{const a=await x.post({subject:'hello',attachments:[{filename:'a.txt',text:'A'}]});assert.equal(a.status,202);
    const first=await a.json(),b=await x.post({attachments:[{base64:'QQ==',filename:'a.txt'}],subject:'hello'});assert.equal(b.status,202);
    const replay=await b.json();assert.equal(replay.eventId,first.eventId);assert.equal(replay.replayed,true);
    assert.equal(x.jobs(),1);assert.equal(x.store.listAudits('tenant-a').length,1);
  }finally{await x.close();}
});
test('HTTP changed request returns safe conflict and original key remains usable',async()=>{
  const x=await apiFixture();try{const a=await (await x.post({subject:'original'})).json();
    const response=await x.post({subject:'private changed subject'});assert.equal(response.status,409);
    const body=await response.text();assert.match(body,/IDEMPOTENCY_CONFLICT/);assert.doesNotMatch(body,/private changed subject|original/);
    assert.equal((await (await x.post({subject:'original'})).json()).eventId,a.eventId);assert.equal(x.jobs(),1);
  }finally{await x.close();}
});
test('HTTP session-derived tenant and delimiter-containing keys cannot alias',async()=>{
  const x=await apiFixture();try{const a=await (await x.post({subject:'A'},'x:ingest:long-key')).json();
    // Distinct tenant is supplied by the server-side session, not the body.
    const b=await (await x.post({subject:'B'},'long-key','test-b')).json();assert.notEqual(a.eventId,b.eventId);
    assert.equal(x.store.countEvents('tenant-a'),1);assert.equal(x.store.countEvents('tenant-a:ingest:x'),1);
  }finally{await x.close();}
});


test('legacy fingerprint/cache upgrade rolls back together on persistence failure',()=>{
  const x=fixture();try{const key='legacy-rollback',original={subject:'original'},a=x.ingest(original,key);legacy(x,a,key);
    const save=x.store.setIdempotent.bind(x.store);x.store.setIdempotent=()=>{throw Error('persistence failure');};
    assert.throws(()=>x.ingest(original,key));assert.equal(x.store.getEvent('tenant-a',a.eventId).ingestFingerprint,undefined);
    assert.equal(x.store.getIdempotent(ingestScope('tenant-a',key)),null);x.store.setIdempotent=save;
    assert.equal(x.ingest(original,key).replayed,true);assert.equal(x.jobs(),1);
  }finally{x.close();}
});
