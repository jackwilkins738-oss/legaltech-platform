import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once,EventEmitter} from 'node:events';
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

test('V184 real TCP client abort before fenced release prevents document response and commit',async t=>{
  let entered,unlock,complete,peerDisconnected;
  const peerClosed=new Promise(resolve=>peerDisconnected=resolve);
  const started=new Promise(resolve=>entered=resolve);
  const held=new Promise(resolve=>unlock=resolve);
  const completed=new Promise(resolve=>complete=resolve);
  let committed=false,opened=0;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async(_,work)=>{
      opened++;entered();
      await held;
      const result=await work();
      committed=true;
      return result;
    }
  });
  const {instance,port}=await server((_,res)=>{
    // Client-side close alone does not establish that the server has observed
    // the disconnect. Release the fence only after the server socket closes.
    res.socket.once('close',peerDisconnected);
    gate(ctx,document(),res).then(()=>complete(null),complete);
  });
  t.after(()=>instance.close());
  const req=http.get({hostname:'127.0.0.1',port,path:'/'},res=>res.resume());
  req.on('error',()=>{});
  await started;
  const closed=new Promise(resolve=>req.once('close',resolve));
  req.destroy();
  await closed;
  await peerClosed;
  unlock();
  const error=await completed;
  assert.match(error?.message??'',/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(opened,1);
  assert.equal(committed,false);
});

test('V185 peer disconnect while binding resolution is pending cannot commit document delivery',async t=>{
  let unlockBinding,bindingEntered,peerDisconnected,complete;
  const bindingStarted=new Promise(resolve=>bindingEntered=resolve);
  const bindingHeld=new Promise(resolve=>unlockBinding=resolve);
  const peerClosed=new Promise(resolve=>peerDisconnected=resolve);
  const completed=new Promise(resolve=>complete=resolve);
  let committed=false,transfers=0;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>{bindingEntered();await bindingHeld;return binding();},
    transferFence:async(_,work)=>{transfers++;await work();committed=true;}
  });
  const {instance,port}=await server((_,res)=>{
    res.socket.once('close',peerDisconnected);
    gate(ctx,document(),res).then(()=>complete(null),complete);
  });
  t.after(()=>instance.close());
  const req=http.get({hostname:'127.0.0.1',port,path:'/'},res=>res.resume());
  req.on('error',()=>{});
  await bindingStarted;
  req.destroy();
  await peerClosed;
  unlockBinding();
  const error=await completed;
  assert.match(error?.message??'',/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(committed,false);
  assert.ok(transfers<=1);
});

test('V185 server-side socket failure during held transfer cannot commit document delivery',async t=>{
  let entered,release,complete,peerDisconnected;
  const started=new Promise(resolve=>entered=resolve);
  const held=new Promise(resolve=>release=resolve);
  const completed=new Promise(resolve=>complete=resolve);
  const peerClosed=new Promise(resolve=>peerDisconnected=resolve);
  let committed=false;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async(_,work)=>{entered();await held;await work();committed=true;}
  });
  const {instance,port}=await server((_,res)=>{
    res.socket.once('close',peerDisconnected);
    gate(ctx,document(),res).then(()=>complete(null),complete);
  });
  t.after(()=>instance.close());
  const req=http.get({hostname:'127.0.0.1',port,path:'/'},res=>res.resume());
  req.on('error',()=>{});
  await started;
  instance.closeAllConnections();
  await peerClosed;
  release();
  const error=await completed;
  assert.match(error?.message??'',/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(committed,false);
});

test('V186 response error during held fence is rejected',async t=>{
  let entered,release,complete,serverResponse;
  const started=new Promise(resolve=>entered=resolve);
  const held=new Promise(resolve=>release=resolve);
  const completed=new Promise(resolve=>complete=resolve);
  let committed=false;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async(_,work)=>{entered();await held;await work();committed=true;}
  });
  const {instance,port}=await server((_,res)=>{
    serverResponse=res;
    gate(ctx,document(),res).then(()=>complete(null),complete);
  });
  t.after(()=>instance.close());
  const request=http.get({hostname:'127.0.0.1',port,path:'/'},res=>res.resume());
  request.on('error',()=>{});
  await started;
  serverResponse.emit('error',Error('transport error'));
  release();
  const error=await completed;
  assert.match(error?.message??'',/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(committed,false);
  assert.equal(serverResponse.headersSent,false);
  request.destroy();
});

test('V187 socket error during held authorization prevents response and commit',async t=>{
  let entered,release,complete,serverSocket,serverResponse;
  const started=new Promise(resolve=>entered=resolve);
  const held=new Promise(resolve=>release=resolve);
  const completed=new Promise(resolve=>complete=resolve);
  let committed=false;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async(_,work)=>{entered();await held;await work();committed=true;}
  });
  const {instance,port}=await server((_,res)=>{
    serverSocket=res.socket;
    serverResponse=res;
    gate(ctx,document(),res).then(()=>complete(null),complete);
  });
  t.after(()=>instance.close());
  const request=http.get({hostname:'127.0.0.1',port,path:'/'},res=>res.resume());
  request.on('error',()=>{});
  await started;
  serverSocket.emit('error',Error('transport fault'));
  release();
  const error=await completed;
  assert.match(error?.message??'',/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(committed,false);
  assert.equal(serverResponse.headersSent,false);
  request.destroy();
});

test('V188 late socket error while response finish is pending rejects without transfer commit',async()=>{
  const socket=new EventEmitter();
  socket.destroyed=false;
  const response=new EventEmitter();
  response.socket=socket;
  response.headersSent=false;
  response.writableEnded=false;
  response.writableFinished=false;
  response.destroyed=false;
  response.writeHead=()=>{response.headersSent=true;};
  response.end=()=>{response.writableEnded=true;};
  response.destroy=()=>{response.destroyed=true;};
  let committed=false;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async(_,work)=>{await work();committed=true;}
  });
  const delivery=gate(ctx,document(),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.headersSent,true);
  socket.emit('error',Error('late transport error'));
  await assert.rejects(delivery,/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(committed,false);
  assert.equal(socket.listenerCount('error'),0);
  assert.equal(response.listenerCount('error'),0);
});

test('V189 synchronous writeHead failure rejects without committing and cleans listeners',async()=>{
  const socket=new EventEmitter();
  socket.destroyed=false;
  const response=new EventEmitter();
  Object.assign(response,{socket,headersSent:false,writableEnded:false,writableFinished:false,destroyed:false});
  response.writeHead=()=>{throw Error('writeHead failed');};
  response.end=()=>{throw Error('end must not be reached');};
  response.destroy=()=>{response.destroyed=true;};
  let committed=false;
  const gate=createFencedHttpDocumentResponder({
    resolveBinding:async()=>binding(),
    transferFence:async(_,work)=>{await work();committed=true;}
  });
  await assert.rejects(gate(ctx,document(),response),/SUPPORT_HTTP_DOCUMENT_UNAVAILABLE/);
  assert.equal(committed,false);
  assert.equal(response.listenerCount('error'),0);
  assert.equal(response.listenerCount('close'),0);
  assert.equal(socket.listenerCount('error'),0);
  assert.equal(socket.listenerCount('close'),0);
});
