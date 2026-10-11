import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createFencedHttpDocumentResponder} from '../src/fencedHttpDocumentResponder.js';

const tenantId='11700000-0000-4000-8000-000000000001';
const actorId='11700000-0000-4000-8000-000000000011';
const eventId='11700000-0000-4000-8000-000000000021';
const requestId='11700000-0000-4000-8000-000000000041';
const matterId='11700000-0000-4000-8000-000000000031';
const ctx={tenantId,actorId,eventId};
const document=()=>({eventId,resultJobId:requestId,resultHash:'b'.repeat(64),artifactHash:'c'.repeat(64),contentType:'application/pdf',size:5,bytes:Buffer.from('%PDF-')});
const binding=()=>({tenantId,actorId,eventId,requestId,matterId,documentRefHash:'a'.repeat(64)});
async function server(handler){
  const instance=http.createServer(handler);
  instance.listen(0,'127.0.0.1');
  await once(instance,'listening');
  return {instance,port:instance.address().port};
}
test('V183 real TCP response finishes under the transfer fence before commit',async t=>{
  const order=[];
  let finishedDelivery;
  const deliveryCompleted=new Promise(resolve=>{finishedDelivery=resolve;});
  const deliver=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async(_,work)=>{order.push('locked');await work();order.push('commit');}
  });
  const {instance,port}=await server((_,res)=>{deliver(ctx,document(),res).then(()=>finishedDelivery(null),finishedDelivery);});
  t.after(()=>instance.close());
  const received=await new Promise((resolve,reject)=>{
    http.get({hostname:'127.0.0.1',port,path:'/'},res=>{
      const chunks=[];res.on('data',v=>chunks.push(v));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString(),cache:res.headers['cache-control']}));res.on('error',reject);
    }).on('error',reject);
  });
  assert.equal(received.status,200);assert.equal(received.body,'%PDF-');assert.equal(received.cache,'no-store');
  const completion=await deliveryCompleted;
  if(completion)throw completion;
  assert.deepEqual(order,['locked','commit']);
});
test('V183 actual HTTP denied grant returns no document response body',async t=>{
  let delivered=false;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async()=>{throw Error('revoked');}
  });
  const {instance,port}=await server((_,res)=>{gate(ctx,document(),res).catch(()=>{});});
  t.after(()=>instance.close());
  await new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/'},res=>{
      delivered=true;res.resume();res.once('end',resolve);res.once('error',resolve);
    });
    req.once('error',resolve);
    req.setTimeout(1500,()=>{req.destroy();reject(Error('connection not closed'))});
  });
  assert.equal(delivered,false);
});
