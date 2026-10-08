import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inspectDocumentEnvelope,HostileDocumentPipeline,DOCUMENT_CLEAN_ISOLATED} from '../src/documentSecurity.js';
import {inspectFile} from '../src/fileSafety.js';
import {Platform} from '../src/platform.js';import {PlatformStore} from '../src/store.js';import {LocalObjectStorage} from '../src/objectStorage.js';import {MockProclaimAdapter} from '../src/adapters.js';

const pdf=Buffer.from('%PDF-1.7\nsynthetic legal evidence');
function zipEntry({name='word/document.xml',compressed=20,uncompressed=100,flags=0,method=8,external=0}={}){
  const n=Buffer.from(name),local=Buffer.alloc(30+n.length);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(flags,6);local.writeUInt16LE(method,8);local.writeUInt32LE(compressed,18);local.writeUInt32LE(uncompressed,22);local.writeUInt16LE(n.length,26);n.copy(local,30);
  const central=Buffer.alloc(46+n.length);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(flags,8);central.writeUInt16LE(method,10);central.writeUInt32LE(compressed,20);central.writeUInt32LE(uncompressed,24);central.writeUInt16LE(n.length,28);central.writeUInt32LE(external>>>0,38);n.copy(central,46);
  const eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(1,8);eocd.writeUInt16LE(1,10);eocd.writeUInt32LE(central.length,12);eocd.writeUInt32LE(local.length,16);
  return Buffer.concat([local,central,eocd]);
}
function cleanPipeline({scanResult='CLEAN',parseResult='OK',isolation='ISOLATED',onScan=()=>{},onParse=()=>{}}={}){
  return new HostileDocumentPipeline({
    scanner:{async scan(d){onScan(d);return {result:scanResult,objectRef:d.objectRef,sha256:d.sha256,size:d.size,scannerRef:'scanner://managed/a',engine:'synthetic-av',engineVersion:'1.0.0',definitionsVersion:'2026-10-08',scannedAt:'2026-10-08T05:00:00.000Z'};}},
    parser:{async parse(d){onParse(d);return {result:parseResult,isolation,objectRef:d.objectRef,sha256:d.sha256,size:d.size,parserRef:'parser://isolated/a',parserVersion:'1.0.0',parsedAt:'2026-10-08T05:00:01.000Z',scanFingerprint:d.scanFingerprint,outputRef:'extract://tenant-a/evidence-1',outputSha256:'a'.repeat(64),outputBytes:128,truncated:false};}},
  });
}
function descriptor(bytes=pdf){const envelope=inspectDocumentEnvelope({filename:'evidence.pdf',contentType:'application/pdf',bytes});return {tenantId:'tenant-a',objectRef:`tenant-a/${envelope.sha256}`,sha256:envelope.sha256,size:envelope.size,contentType:envelope.contentType,envelope};}

test('explicit PDF MIME with non-PDF bytes is quarantined before any parser boundary',()=>{
  assert.equal(inspectFile({filename:'evidence.pdf',contentType:'application/pdf',bytes:Buffer.from('not a pdf')}).reason,'mime_signature_mismatch');
});
test('macro-enabled Office extensions are quarantined even before archive parsing',()=>{
  assert.equal(inspectDocumentEnvelope({filename:'claim.docm',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:zipEntry()}).reason,'active_content');
});
test('OOXML archive path traversal is quarantined',()=>{
  const r=inspectDocumentEnvelope({filename:'claim.docx',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:zipEntry({name:'../payload.exe'})});assert.equal(r.reason,'archive_path_traversal');
});
test('OOXML embedded macro payload is quarantined even with a macro-free extension',()=>{
  const r=inspectDocumentEnvelope({filename:'claim.docx',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:zipEntry({name:'word/vbaProject.bin'})});assert.equal(r.reason,'active_content');
});
test('archive decompression-bomb metadata is rejected without decompressing attacker bytes',()=>{
  const r=inspectDocumentEnvelope({filename:'claim.docx',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:zipEntry({compressed:1,uncompressed:5*1024*1024})});assert.equal(r.reason,'archive_decompression_limit');
});
test('nested archives are quarantined rather than recursively expanded in the privileged process',()=>{
  const r=inspectDocumentEnvelope({filename:'bundle.zip',contentType:'application/zip',bytes:zipEntry({name:'nested.zip'})});assert.equal(r.reason,'nested_archive');
});
test('valid PDF reaches only the managed-scan boundary, never a claim of parser safety',()=>{
  const r=inspectDocumentEnvelope({filename:'evidence.pdf',contentType:'application/pdf',bytes:pdf});assert.equal(r.verdict,'SCAN_REQUIRED');assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.equal(r.detectedType,'PDF');
});
test('scanner and parser adapters receive immutable descriptors without raw bytes',async()=>{
  let scans=0,parses=0;const pipeline=cleanPipeline({onScan(d){scans++;assert.equal(Object.isFrozen(d),true);assert.equal('bytes' in d,false);},onParse(d){parses++;assert.equal(Object.isFrozen(d),true);assert.equal('bytes' in d,false);}});const d=descriptor();const e=await pipeline.assess(d);assert.equal(e.verdict,DOCUMENT_CLEAN_ISOLATED);assert.equal(pipeline.verifyEvidence(d,e),true);assert.equal(scans,1);assert.equal(parses,1);
});
test('infected scan result prevents parser invocation',async()=>{
  let parses=0;const pipeline=cleanPipeline({scanResult:'INFECTED',onParse(){parses++;}}),e=await pipeline.assess(descriptor());assert.equal(e.verdict,'QUARANTINE');assert.equal(e.reason,'malware_detected');assert.equal(parses,0);
});
test('scanner evidence bound to another object is rejected and parser is not called',async()=>{
  let parses=0;const pipeline=new HostileDocumentPipeline({scanner:{async scan(d){return {result:'CLEAN',objectRef:d.objectRef,sha256:'b'.repeat(64),size:d.size,scannerRef:'scanner://managed/a',engine:'av',engineVersion:'1',definitionsVersion:'1',scannedAt:'2026-10-08T05:00:00.000Z'};}},parser:{async parse(){parses++;throw Error('must not parse');}}});const e=await pipeline.assess(descriptor());assert.equal(e.reason,'malware_scan_evidence_invalid');assert.equal(parses,0);
});
test('parser evidence must prove isolation and exact scan binding',async()=>{
  const pipeline=cleanPipeline({isolation:'SHARED'}),e=await pipeline.assess(descriptor());assert.equal(e.reason,'parser_evidence_invalid');assert.equal(pipeline.verifyEvidence(descriptor(),e),false);
});

function fixture(t,{pipeline=cleanPipeline(),scanResult='CLEAN'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legaltech-v60-')),root=path.join(dir,'objects'),store=new PlatformStore(path.join(dir,'db.sqlite'),{matters:[{id:'mat_1',tenantId:'tenant-a',externalId:'P-1',externalRefs:['CLM-70001']}]});
  const objectStorage=new LocalObjectStorage(root);let aiCalls=0;const aiGateway={async classifyInbound(){aiCalls++;return {status:'OK',classification:'MEDICAL_CORRESPONDENCE',confidence:0.8,model:'deterministic-classifier-v1',reason:'synthetic_rules_only'};}};
  const documentSecurity=scanResult==='CLEAN'?pipeline:cleanPipeline({scanResult});const proclaim=new MockProclaimAdapter();const platform=new Platform({store,objectStorage,aiGateway,proclaim,documentSecurity,requireDocumentSecurityEvidence:true});
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {store,platform,proclaim,aiCalls:()=>aiCalls,ingest:()=>platform.ingest({tenantId:'tenant-a',idempotencyKey:'v60-ingest',input:{subject:'CLM-70001 medical evidence',attachments:[{filename:'records.pdf',contentType:'application/pdf',bytes:pdf}]}})};
}
test('production document mode fails closed before AI until clean isolated evidence is recorded',async t=>{
  const x=fixture(t),a=x.ingest();const before=await x.platform.processNext();assert.equal(before.status,'FAILED');assert.equal(x.aiCalls(),0);const secured=await x.platform.secureAttachments({tenantId:'tenant-a',eventId:a.eventId});assert.equal(secured.blocked,0);const after=await x.platform.processNext();assert.equal(after.status,'DONE');assert.equal(after.result.status,'READY_FOR_APPROVAL');assert.equal(x.aiCalls(),1);
});
test('infected attachment is routed to a non-approvable FILE_SAFETY review without AI or Proclaim write',async t=>{
  const x=fixture(t,{scanResult:'INFECTED'}),a=x.ingest(),secured=await x.platform.secureAttachments({tenantId:'tenant-a',eventId:a.eventId});assert.equal(secured.status,'REVIEW_REQUIRED');assert.equal(secured.blocked,1);assert.equal(x.aiCalls(),0);const ex=x.store.listExceptions('tenant-a')[0];assert.equal(ex.type,'FILE_SAFETY');assert.throws(()=>x.platform.approve({tenantId:'tenant-a',eventId:a.eventId,matterId:'mat_1',exceptionId:ex.id,actorId:'reviewer',idempotencyKey:'unsafe-approve'}),e=>e.code==='DOCUMENT_SECURITY_UNAVAILABLE');assert.equal(x.store.listEventJobs('tenant-a',a.eventId,'PROCLAIM_WRITEBACK').length,0);
});
test('content-security evidence cannot be copied to another attachment object',async t=>{
  const x=fixture(t),a=x.ingest();await x.platform.secureAttachments({tenantId:'tenant-a',eventId:a.eventId});const event=x.store.getEvent('tenant-a',a.eventId),evidence=structuredClone(event.attachments[0].contentSecurity);evidence.objectRef=`tenant-a/${'c'.repeat(64)}`;event.attachments[0].contentSecurity=evidence;x.store.updateEvent(event);assert.equal((await x.platform.processNext()).status,'FAILED');assert.equal(x.aiCalls(),0);
});
