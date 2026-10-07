import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LocalObjectStorage} from '../src/objectStorage.js';
import {PlatformStore} from '../src/store.js';
import {Platform} from '../src/platform.js';
import {DeterministicAIGateway} from '../src/aiGateway.js';
import {MockProclaimAdapter} from '../src/adapters.js';
import {inspectFile} from '../src/fileSafety.js';
import {ingestScope} from '../src/inboundRequest.js';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'attachment-safety-'));
  const objects=path.join(dir,'objects'),storage=new LocalObjectStorage(objects);
  const store=new PlatformStore(path.join(dir,'db.sqlite'),{matters:[{id:'mat_a',tenantId:'tenant-a',externalId:'P-A',externalRefs:['CLM-70001']}]});
  const platform=new Platform({store,objectStorage:storage,aiGateway:new DeterministicAIGateway(),proclaim:new MockProclaimAdapter()});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const bytes=Buffer.from('%PDF synthetic attachment');
  return {dir,objects,storage,store,platform,bytes,
    put:()=>storage.put({tenantId:'tenant-a',bytes}),
    filename:ref=>path.join(objects,ref+'.bin'),
    ingest:(key='attachment-key',filename='evidence.pdf')=>platform.ingest({tenantId:'tenant-a',idempotencyKey:key,input:{subject:'CLM-70001',attachments:[{filename,bytes}]}}),
    jobs:()=>Number(store.db.prepare('SELECT COUNT(*) n FROM jobs').get().n),
  };
}
const integrity=e=>e.code==='OBJECT_STORAGE_UNAVAILABLE';
for(const replacement of [Buffer.from('tampered private contents'),Buffer.alloc(0),Buffer.from('%PDF synthetic attachment!')]) {
  test(`corrupt content is never returned (${replacement.length} bytes)`,t=>{
    const x=fixture(t),a=x.put(),file=x.filename(a.objectRef);fs.writeFileSync(file,replacement);
    assert.throws(()=>x.storage.get({tenantId:'tenant-a',objectRef:a.objectRef}),integrity);assert.deepEqual(fs.readFileSync(file),replacement);
  });
  test(`deduplicated put refuses existing corruption (${replacement.length} bytes)`,t=>{
    const x=fixture(t),a=x.put(),file=x.filename(a.objectRef);fs.writeFileSync(file,replacement);
    assert.throws(x.put,integrity);assert.deepEqual(fs.readFileSync(file),replacement);
  });
}
for(const variant of [ref=>ref+'/extra',ref=>ref+'/',ref=>({toString:()=>ref}),ref=>[ref],ref=>ref.replace('/','//'),ref=>ref.toUpperCase(),ref=>ref+'\n',ref=>ref+'\r\n']) test('object reference must be a canonical owned string',t=>{
  const x=fixture(t),a=x.put();assert.equal(x.storage.get({tenantId:'tenant-a',objectRef:variant(a.objectRef)}),null);
});
for(const tenantId of [null,42,{toString:()=> 'tenant-a'}]) test(`storage rejects non-string tenant ${typeof tenantId} before touching files`,t=>{
  const x=fixture(t);assert.throws(()=>x.storage.put({tenantId,bytes:x.bytes}),integrity);
  assert.equal(fs.readdirSync(x.objects).length,0);
});
test('tenant directory link cannot redirect object writes',t=>{
  const x=fixture(t),outside=path.join(x.dir,'other');fs.mkdirSync(outside);
  try{fs.symlinkSync(outside,path.join(x.objects,'tenant-a'),process.platform==='win32'?'junction':'dir');}
  catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('link creation unavailable');return;}throw error;}
  assert.throws(x.put,integrity);assert.deepEqual(fs.readdirSync(outside),[]);
});
for(const operation of ['get','put']) test(`linked object cannot be used by ${operation}`,t=>{
  const x=fixture(t),a=x.put(),file=x.filename(a.objectRef),outside=path.join(x.dir,'other.bin');fs.renameSync(file,outside);
  try{fs.symlinkSync(outside,file,'file');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('link creation unavailable');return;}throw error;}
  assert.throws(()=>operation==='get'?x.storage.get({tenantId:'tenant-a',objectRef:a.objectRef}):x.put(),integrity);
  assert.deepEqual(fs.readFileSync(outside),x.bytes);
});
for(const filename of ['payload.exe.','payload.ExE ','script.ps1...','task.cmd .','payload.exe:preview.pdf']) test(`blocked filename alias ${filename} never gets parser-safe status`,t=>{
  const x=fixture(t),a=x.ingest('alias-key',filename),event=x.store.getEvent('tenant-a',a.eventId);
  assert.equal(event.attachments[0].safety.verdict,'QUARANTINE');assert.equal(event.attachments[0].objectRef,null);assert.deepEqual(fs.readdirSync(x.objects),[]);
});
for(const failure of ['missing','corrupt','wrong-tenant','malformed-ref']) test(`inbound ${failure} attachment cannot become approvable`,async t=>{
  const x=fixture(t),a=x.ingest(),event=x.store.getEvent('tenant-a',a.eventId),ref=event.attachments[0].objectRef;
  if(failure==='missing')fs.unlinkSync(x.filename(ref));
  if(failure==='corrupt')fs.writeFileSync(x.filename(ref),'tampered');
  if(failure==='wrong-tenant'){event.attachments[0].objectRef=ref.replace('tenant-a/','tenant-b/');x.store.updateEvent(event);}
  if(failure==='malformed-ref'){event.attachments[0].objectRef=ref+'/extra';x.store.updateEvent(event);}
  let classifications=0;x.platform.aiGateway={classifyInbound(){classifications++;throw Error('must not classify unavailable attachment');}};
  const result=await x.platform.processNext();assert.equal(result.status,'FAILED');assert.equal(result.error,'INBOUND_PROCESSING_FAILED');
  assert.equal(classifications,0);assert.equal(x.store.getEvent('tenant-a',a.eventId).status,'QUEUED');assert.equal(x.store.listExceptions('tenant-a').length,0);
  assert.equal(x.store.listAudits('tenant-a').filter(v=>v.action==='INBOUND_PROCESSED').length,0);
});
for(const failure of ['missing','corrupt']) test(`attachment ${failure} during classification blocks completion`,async t=>{
  const x=fixture(t),a=x.ingest(),ref=x.store.getEvent('tenant-a',a.eventId).attachments[0].objectRef,ai=x.platform.aiGateway;
  x.platform.aiGateway={async classifyInbound(args){if(failure==='missing')fs.unlinkSync(x.filename(ref));else fs.writeFileSync(x.filename(ref),'tampered');return ai.classifyInbound(args);}};
  const result=await x.platform.processNext();assert.equal(result.status,'FAILED');assert.equal(x.store.getEvent('tenant-a',a.eventId).status,'QUEUED');
  assert.equal(x.store.listAudits('tenant-a').filter(v=>v.action==='INBOUND_PROCESSED').length,0);
});
test('corrupt deduplicated attachment cannot create event, job, audit or replay cache',t=>{
  const x=fixture(t),a=x.put();fs.writeFileSync(x.filename(a.objectRef),'tampered');assert.throws(()=>x.ingest(),integrity);
  assert.equal(x.store.countEvents('tenant-a'),0);assert.equal(x.jobs(),0);assert.equal(x.store.listAudits('tenant-a').length,0);assert.equal(x.store.getIdempotent(ingestScope('tenant-a','attachment-key')),null);
});
test('operator restoration permits processing retry without duplicate acceptance',async t=>{
  const x=fixture(t),a=x.ingest(),ref=x.store.getEvent('tenant-a',a.eventId).attachments[0].objectRef,file=x.filename(ref);
  fs.unlinkSync(file);assert.equal((await x.platform.processNext()).status,'FAILED');fs.writeFileSync(file,x.bytes);
  const result=await x.platform.processNext();assert.equal(result.status,'DONE');assert.equal(x.store.getEvent('tenant-a',a.eventId).status,'READY_FOR_APPROVAL');assert.equal(x.jobs(),1);
  assert.equal(x.store.listAudits('tenant-a').filter(v=>v.action==='INBOUND_PROCESSED').length,1);
});
test('valid content deduplicates and survives storage restart',t=>{
  const x=fixture(t),a=x.put(),b=x.put();assert.equal(a.objectRef,b.objectRef);
  const restarted=new LocalObjectStorage(x.objects);assert.deepEqual(restarted.get({tenantId:'tenant-a',objectRef:a.objectRef}),x.bytes);
  assert.equal(fs.readdirSync(path.join(x.objects,'tenant-a')).length,2);
});
test('same bytes in different tenants stay separate',t=>{
  const x=fixture(t),a=x.put(),b=x.storage.put({tenantId:'tenant-b',bytes:x.bytes});assert.notEqual(a.objectRef,b.objectRef);
  assert.equal(x.storage.get({tenantId:'tenant-b',objectRef:a.objectRef}),null);assert.deepEqual(x.storage.get({tenantId:'tenant-b',objectRef:b.objectRef}),x.bytes);
});
test('safe-looking content still rejects executable magic',()=>{
  for(const bytes of [Buffer.from('MZ executable'),Buffer.from([0x7f,0x45,0x4c,0x46])])assert.equal(inspectFile({filename:'evidence.pdf',bytes}).verdict,'QUARANTINE');
});
test('quarantined attachment routes to file-safety review without storage lookup',async t=>{
  const x=fixture(t),a=x.ingest('quarantined-key','payload.exe');x.storage.get=()=>{throw Error('quarantined bytes must not be read');};
  const done=await x.platform.processNext();assert.equal(done.status,'DONE');assert.equal(x.store.getEvent('tenant-a',a.eventId).status,'REVIEW_REQUIRED');assert.equal(x.store.listExceptions('tenant-a')[0].type,'FILE_SAFETY');
});

test('oversized direct storage put cannot write an unbounded object',t=>{
  const x=fixture(t);assert.throws(()=>x.storage.put({tenantId:'tenant-a',bytes:Buffer.alloc(15*1024*1024+1)}),integrity);
  assert.deepEqual(fs.readdirSync(x.objects),[]);
});
test('oversized corrupt stored object is rejected before reading its contents',t=>{
  const x=fixture(t),a=x.put(),file=x.filename(a.objectRef);fs.truncateSync(file,16*1024*1024);
  const read=fs.readFileSync;let reads=0;
  fs.readFileSync=function(target,...args){if(target===file)reads++;return read.call(this,target,...args);};
  try{assert.throws(()=>x.storage.get({tenantId:'tenant-a',objectRef:a.objectRef}),integrity);assert.equal(reads,0);}finally{fs.readFileSync=read;}
});
test('metadata links cannot redirect writes to another file',t=>{
  const x=fixture(t),a=x.put(),meta=path.join(x.objects,a.objectRef+'.json'),outside=path.join(x.dir,'private.json');
  fs.renameSync(meta,outside);const before=fs.readFileSync(outside);
  try{fs.symlinkSync(outside,meta,'file');}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip('link creation unavailable');return;}throw error;}
  assert.throws(x.put,integrity);assert.deepEqual(fs.readFileSync(outside),before);
});
test('missing tenant/object is unavailable without creating directories',t=>{
  const x=fixture(t);assert.equal(x.storage.get({tenantId:'tenant-a',objectRef:'tenant-a/'+ 'a'.repeat(64)}),null);
  assert.deepEqual(fs.readdirSync(x.objects),[]);
});
test('metadata serialization failure creates no object artifact',t=>{
  const x=fixture(t),metadata={};metadata.self=metadata;
  assert.throws(()=>x.storage.put({tenantId:'tenant-a',bytes:x.bytes,metadata}));assert.deepEqual(fs.readdirSync(x.objects),[]);
});
test('empty attachment bytes are available evidence rather than a missing object',async t=>{
  const x=fixture(t),a=x.platform.ingest({tenantId:'tenant-a',idempotencyKey:'empty-attachment-key',input:{subject:'CLM-70001',attachments:[{filename:'empty.txt',bytes:Buffer.alloc(0)}]}});
  assert.equal((await x.platform.processNext()).status,'DONE');assert.equal(x.store.getEvent('tenant-a',a.eventId).status,'READY_FOR_APPROVAL');
});
test('ordinary names and safe suffix variants keep their recorded filename',async t=>{
  const x=fixture(t),a=x.ingest('normal-alias-key','evidence.pdf.');assert.equal((await x.platform.processNext()).status,'DONE');
  const event=x.store.getEvent('tenant-a',a.eventId);assert.equal(event.attachments[0].filename,'evidence.pdf.');assert.equal(event.status,'READY_FOR_APPROVAL');
});
test('historical unsafe parser-safe label cannot bypass the updated check',async t=>{
  const x=fixture(t),a=x.ingest(),event=x.store.getEvent('tenant-a',a.eventId);event.attachments[0].filename='payload.exe.';x.store.updateEvent(event);
  assert.equal((await x.platform.processNext()).status,'FAILED');assert.equal(x.store.getEvent('tenant-a',a.eventId).status,'QUEUED');
});
test('exact storage size limit remains usable and hash verified',t=>{
  const x=fixture(t),bytes=Buffer.alloc(15*1024*1024,65),a=x.storage.put({tenantId:'tenant-a',bytes});
  assert.equal(a.size,bytes.length);assert.deepEqual(x.storage.get({tenantId:'tenant-a',objectRef:a.objectRef}),bytes);
});

test('tenant namespace rejects a terminal newline rather than creating an alias',t=>{
  const x=fixture(t);assert.throws(()=>x.storage.put({tenantId:'tenant-a\n',bytes:x.bytes}),integrity);assert.deepEqual(fs.readdirSync(x.objects),[]);
});
