import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createFencedHttpDocumentResponder} from '../src/fencedHttpDocumentResponder.js';
const tenantId='11700000-0000-4000-8000-000000000001',actorId='11700000-0000-4000-8000-000000000011',eventId='11700000-0000-4000-8000-000000000021';
const requestId='11700000-0000-4000-8000-000000000041',matterId='11700000-0000-4000-8000-000000000031';
const context=()=>({tenantId,actorId,eventId});
const document=()=>({eventId,resultJobId:requestId,resultHash:'b'.repeat(64),artifactHash:'c'.repeat(64),contentType:'application/pdf',size:5,bytes:Buffer.from('%PDF-')});
const mapping=()=>({tenantId,actorId,eventId,requestId,matterId,documentRefHash:'a'.repeat(64)});
function response(disconnect=false){const e=new EventEmitter();Object.assign(e,{headersSent:false,writableEnded:false,destroyed:false,
  writeHead(){e.headersSent=true;},end(){if(disconnect){e.destroyed=true;e.emit('close');}else{e.writableEnded=true;e.emit('finish');}},
  destroy(){e.destroyed=true;e.emit('close');}});return e;}
test('V182 successful HTTP finish stays inside transaction-held transfer callback',async()=>{
  const events=[];
  const deliver=createFencedHttpDocumentResponder({resolveBinding:async()=>mapping(),transferFence:async(_,work)=>{events.push('locked');await work();events.push('released');}});
  const res=response();const original=res.end;res.end=function(bytes){events.push('sent');assert.equal(bytes.toString(),'%PDF-');original(bytes);events.push('finished');};
  await deliver(context(),document(),res);
  assert.deepEqual(events,['locked','sent','finished','released']);
});
test('V182 HTTP disconnect rejects without successful transaction handoff',async()=>{
  let committed=false,entered=false;
  const deliver=createFencedHttpDocumentResponder({resolveBinding:async()=>mapping(),transferFence:async(_,work)=>{entered=true;await work();committed=true;}});
  await assert.rejects(deliver(context(),document(),response(true)),/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(entered,true);assert.equal(committed,false);
});
test('V182 revoked grant denies before headers or document bytes',async()=>{
  const res=response();let called=false;
  const deliver=createFencedHttpDocumentResponder({resolveBinding:async()=>mapping(),transferFence:async()=>{throw Error('revoked');}});
  const original=res.writeHead;res.writeHead=(...args)=>{called=true;original(...args);};
  await assert.rejects(deliver(context(),document(),res),/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(called,false);
});
