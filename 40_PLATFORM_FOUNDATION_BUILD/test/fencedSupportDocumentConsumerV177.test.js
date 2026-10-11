import test from 'node:test';
import assert from 'node:assert/strict';
import {createFencedSupportDocumentConsumer} from '../src/fencedSupportDocumentConsumer.js';
const tenantId='11700000-0000-4000-8000-000000000001',actorId='11700000-0000-4000-8000-000000000011';
const eventId='11700000-0000-4000-8000-000000000021',requestId='11700000-0000-4000-8000-000000000041';
const matterId='11700000-0000-4000-8000-000000000031',documentRefHash='a'.repeat(64);
const context=()=>({tenantId,actorId,eventId,signal:new AbortController().signal});
const payload=()=>({eventId,resultJobId:requestId,resultHash:'b'.repeat(64),artifactHash:'c'.repeat(64),contentType:'application/pdf',size:5,bytes:Buffer.from('%PDF-')});
const mapping=()=>({tenantId,actorId,eventId,requestId,matterId,documentRefHash});
test('V177 invokes trusted delivery strictly within held transaction fence',async()=>{
  const events=[];
  const delivery=createFencedSupportDocumentConsumer({
    resolveBinding:async()=>{events.push('binding');return mapping();},
    transferFence:async(grant,work)=>{
      events.push('begin fence');
      assert.deepEqual({...grant,signal:undefined},{tenantId,actorId,requestId,matterId,scope:'DOCUMENT_READ',documentRefHash,signal:undefined});
      const result=await work();events.push('end fence');return result;
    },
    consume:async()=>{events.push('bytes');return 'complete';}
  });
  assert.equal(await delivery(context(),payload()),'complete');
  assert.deepEqual(events,['binding','begin fence','binding','bytes','end fence']);
});
test('V177 document rebind under the held fence rejects before consuming bytes',async()=>{
  let bindings=0,sent=0;
  const delivery=createFencedSupportDocumentConsumer({
    resolveBinding:async()=>{bindings++;return {...mapping(),requestId:bindings===2?'11700000-0000-4000-8000-000000000042':requestId};},
    transferFence:async(_,work)=>work(),
    consume:async()=>{sent++;}
  });
  await assert.rejects(delivery(context(),payload()),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
  assert.equal(sent,0);
});
test('V177 rejected fenced grant never invokes consumer',async()=>{
  let sent=0;
  const delivery=createFencedSupportDocumentConsumer({
    resolveBinding:async()=>mapping(),
    transferFence:async()=>{throw Error('revoked');},
    consume:async()=>{sent++;}
  });
  await assert.rejects(delivery(context(),payload()),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
  assert.equal(sent,0);
});
test('V177 mismatched event and untrusted getter fail without resolving binding',async()=>{
  let calls=0;
  const delivery=createFencedSupportDocumentConsumer({
    resolveBinding:async()=>{calls++;return mapping();},
    transferFence:async(_,work)=>work(),
    consume:async()=>{}
  });
  await assert.rejects(delivery(context(),{...payload(),eventId:'11700000-0000-4000-8000-000000000022'}),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
  const malicious=context();
  Object.defineProperty(malicious,'actorId',{enumerable:true,get(){throw Error('never evaluate');}});
  await assert.rejects(delivery(malicious,payload()),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
  assert.equal(calls,0);
});
