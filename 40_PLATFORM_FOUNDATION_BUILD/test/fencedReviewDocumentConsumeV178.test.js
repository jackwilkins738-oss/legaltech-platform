import test from 'node:test';
import assert from 'node:assert/strict';
import {createFencedReviewDocumentConsume} from '../src/fencedReviewDocumentConsume.js';
const tenantId='11700000-0000-4000-8000-000000000001',actorId='11700000-0000-4000-8000-000000000011';
const eventId='11700000-0000-4000-8000-000000000021',requestId='11700000-0000-4000-8000-000000000041',matterId='11700000-0000-4000-8000-000000000031';
const context=()=>({tenantId,actorId,eventId,signal:new AbortController().signal});
const document=()=>({eventId,resultJobId:requestId,resultHash:'b'.repeat(64),artifactHash:'c'.repeat(64),contentType:'application/pdf',size:5,bytes:Buffer.from('%PDF-'),signal:new AbortController().signal});
const mapping=()=>({tenantId,actorId,eventId,requestId,matterId,documentRefHash:'a'.repeat(64)});
test('V178 actual review consumption executes while fenced transaction is held',async()=>{
  const order=[];
  const adapter=createFencedReviewDocumentConsume({
    resolveBinding:async()=>{order.push('map');return mapping();},
    transferFence:async(_,fn)=>{order.push('acquire');const result=await fn();order.push('release');return result;}
  });
  const result=await adapter(context(),document(),async()=>{order.push('bytes');return 'sent';});
  assert.equal(result,'sent');
  assert.deepEqual(order,['map','acquire','map','bytes','release']);
});
test('V178 denial at fenced transfer stops actual review bytes',async()=>{
  let called=0;
  const adapter=createFencedReviewDocumentConsume({
    resolveBinding:async()=>mapping(),
    transferFence:async()=>{throw Error('revoked');}
  });
  await assert.rejects(adapter(context(),document(),async()=>{called++;}),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
  assert.equal(called,0);
});
test('V178 invalid callback fails before binding or transfer',async()=>{
  let seen=0;
  const adapter=createFencedReviewDocumentConsume({
    resolveBinding:async()=>{seen++;return mapping();},
    transferFence:async()=>{seen++;}
  });
  await assert.rejects(adapter(context(),document(),null),/SUPPORT_REVIEW_DOCUMENT_FENCE_UNAVAILABLE/);
  assert.equal(seen,0);
});

test('V179 revocation during held transfer rejects and never reports delivery success',async()=>{
  const events=[];let authorized=true;
  const adapter=createFencedReviewDocumentConsume({
    resolveBinding:async()=>mapping(),
    transferFence:async(_,work)=>{
      events.push('locked');
      const result=await work();
      events.push('consumer returned');
      if(!authorized)throw Error('revoked during transfer');
      events.push('committed');return result;
    }
  });
  await assert.rejects(adapter(context(),document(),async()=>{
    events.push('consume');
    authorized=false;
    return 'sent';
  }),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
  assert.deepEqual(events,['locked','consume','consumer returned']);
});
test('V179 resolver error during held fence never invokes actual document consumer',async()=>{
  let resolved=0,sent=0,locked=false;
  const adapter=createFencedReviewDocumentConsume({
    resolveBinding:async()=>{resolved++;if(resolved===2)throw Error('binding lost');return mapping();},
    transferFence:async(_,work)=>{locked=true;return work();}
  });
  await assert.rejects(adapter(context(),document(),async()=>{sent++;}),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
  assert.equal(resolved,2);
  assert.equal(locked,true);
  assert.equal(sent,0);
});
test('V179 consumer failure does not escape fail-closed transfer contract',async()=>{
  const adapter=createFencedReviewDocumentConsume({
    resolveBinding:async()=>mapping(),
    transferFence:async(_,work)=>work()
  });
  await assert.rejects(adapter(context(),document(),async()=>{throw Error('downstream transport failed');}),/SUPPORT_DOCUMENT_TRANSFER_UNAVAILABLE/);
});
