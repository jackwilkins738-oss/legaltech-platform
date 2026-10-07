import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApiServer} from '../src/httpApi.js';
import {StaticAuthProvider} from '../src/auth.js';
import {appError} from '../src/errors.js';

async function fixture(t,{failure=null}={}) {
  const calls=[];
  const audits=[];
  const platform={
    store:{audit(entry){audits.push(entry);}},
    ingest(value){calls.push(value);return {eventId:'evt_fixture'};},
    listMatters(){if(failure)throw failure;return [];},
    getMatter(tenant,id){calls.push({tenant,id});return null;},
    getEvent(){calls.push('getEvent');return null;},
    resolveException(){calls.push('resolve');return {};},
    requestInboundRecovery(){calls.push('retry');return {};},
    requestWritebackReconciliation(){calls.push('reconcile');return {};},
  };
  const authProvider=new StaticAuthProvider([{token:'good-token',tenantId:'tenant-a',actorId:'actor-a',capabilities:['matter:read','inbound:read','inbound:create','exception:resolve','integration:manage','dev:workers']}]);
  const graph={tenantId:'tenant-a',createMailboxSubscription(){calls.push('subscription');if(failure)throw failure;return {};}};
  const integrations={graph,proclaim:{tenantId:'tenant-a'},registry:{get(){return {};}}};
  const server=createApiServer({platform,authProvider,devWorkers:true,integrations});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {calls,audits,server,request({url='/api/v1/inbound-events',method='POST',body='{}',headers=null,chunked=false,splitAt=700000}={}) {
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
    return new Promise((resolve,reject)=>{
      const defaults=['Authorization','Bearer good-token','Idempotency-Key','boundary-key-001','Content-Type','application/json'];
      const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,method,headers:['Host','localhost',...(headers??[...defaults,...(chunked?[]:['Content-Length',String(bytes.length)])])]},res=>{
        const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));res.on('error',reject);
      });
      req.setTimeout(3000,()=>req.destroy(new Error('request timed out')));req.on('error',reject);
      if(chunked) {req.write(bytes.subarray(0,splitAt));setImmediate(()=>req.end(bytes.subarray(splitAt)));}else req.end(bytes);
    });
  }};
}

for(const chunked of [false,true]) test(`oversize ${chunked?'chunked':'declared'} body returns a usable 413 without mutation`,async t=>{
  const x=await fixture(t);const r=await x.request({body:Buffer.alloc(1024*1024+1,32),chunked});
  assert.equal(r.status,413);assert.equal(r.body.code,'BODY_TOO_LARGE');assert.equal(x.calls.length,0);
  assert.equal((await x.request({url:'/api/v1/health',method:'GET',body:''})).status,200);
});
for(const invalid of [[0xc0,0xaf],[0xed,0xa0,0x80],[0xff],[0xf0,0x9f]]) test(`invalid UTF-8 ${invalid.join('-')} is rejected before ingest`,async t=>{
  const x=await fixture(t);const r=await x.request({body:Buffer.concat([Buffer.from('{"subject":"'),Buffer.from(invalid),Buffer.from('"}')])});
  assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_JSON');assert.equal(x.calls.length,0);
});
for(const url of ['/api/v1/matters/%ZZ','/api/v1/inbound-events/%E0%A4','/api/v1/exceptions/%FF/resolve','/api/v1/inbound-events/%ZZ/retry-processing','/api/v1/inbound-events/%ZZ/reconcile-writeback','/api/v1/integrations/graph/subscriptions/%ZZ/renew','/api/v1/integrations/graph/subscriptions/%ZZ/lifecycle','/api/v1/integrations/graph/deliveries/%ZZ/fail','/api/v1/integrations/graph/deliveries/%ZZ/retry']) test(`malformed route encoding ${url} returns 400 before lookup`,async t=>{
  const x=await fixture(t);const r=await x.request({url,body:url.endsWith('/lifecycle')?'{"status":"ACTIVE"}':'{}',method:url.includes('/matters/')||url==='/api/v1/inbound-events/%E0%A4'?'GET':'POST'});
  assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_REQUEST');assert.equal(x.calls.length,0);
});
for(const header of ['Authorization','Idempotency-Key']) for(const same of [false,true]) test(`duplicate ${header}, ${same?'same':'different'} values, fails closed`,async t=>{
  const x=await fixture(t);const values=header==='Authorization'?['Bearer good-token',same?'Bearer good-token':'Bearer other-token']:['boundary-key-001',same?'boundary-key-001':'boundary-key-002'];
  const headers=['Authorization','Bearer good-token','Idempotency-Key','boundary-key-001','Content-Type','application/json','Content-Length','2'];
  headers.splice(header==='Authorization'?0:2,2,header,values[0],header.toLowerCase(),values[1]);
  const r=await x.request({headers});assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_REQUEST');assert.equal(x.calls.length,0);
});
for(const failure of [Object.assign(new Error('synthetic-private-error'),{status:400,code:'PRIVATE_ADAPTER_CODE'}),Object.assign(new Error('synthetic-private-error'),{code:'PRIVATE_ADAPTER_CODE'}),Object.assign(new Error('synthetic-private-error'),{status:700,code:'PRIVATE_ADAPTER_CODE'})]) test(`untrusted error metadata ${failure.status??'unset'} is redacted and bounded`,async t=>{
  const x=await fixture(t,{failure});const r=await x.request({url:'/api/v1/matters',method:'GET'});
  assert.equal(r.status,500);assert.equal(r.body.code,'INTERNAL_ERROR');assert.equal(r.body.message,'internal error');
  assert.equal((await x.request({url:'/api/v1/health',method:'GET',body:''})).status,200);
});
test('trusted app errors preserve a safe client conflict',async t=>{
  const x=await fixture(t,{failure:appError('request conflicts',{status:409,code:'IDEMPOTENCY_CONFLICT'})});
  const r=await x.request({url:'/api/v1/matters',method:'GET'});assert.equal(r.status,409);assert.equal(r.body.code,'IDEMPOTENCY_CONFLICT');
});
test('trusted server errors also redact their code and message',async t=>{
  const x=await fixture(t,{failure:appError('synthetic-private-error',{status:503,code:'PRIVATE_ADAPTER_CODE'})});
  const r=await x.request({url:'/api/v1/matters',method:'GET'});assert.equal(r.status,503);assert.equal(r.body.code,'INTERNAL_ERROR');assert.equal(r.body.message,'internal error');
});
test('valid multibyte UTF-8 split across chunks preserves the input',async t=>{
  const x=await fixture(t);const subject='£ Evidence 😀';const body=JSON.stringify({subject});const r=await x.request({body,chunked:true,splitAt:Buffer.from(body).indexOf(0xc2)+1});
  assert.equal(r.status,202);assert.equal(x.calls[0].input.subject,subject);
});
test('exact body size limit remains accepted',async t=>{
  const x=await fixture(t);const body=JSON.stringify({subject:'valid',body:'x'.repeat(1024*1024-29)});
  assert.equal(Buffer.byteLength(body),1024*1024);assert.equal((await x.request({body})).status,202);assert.equal(x.calls.length,1);
});
test('encoded route IDs remain supported for valid UTF-8',async t=>{
  const x=await fixture(t);const r=await x.request({url:'/api/v1/matters/matter%20%C2%A3',method:'GET'});
  assert.equal(r.status,404);assert.deepEqual(x.calls,[{tenant:'tenant-a',id:'matter £'}]);
});
test('aborted partial request never invokes ingest and server stays available',async t=>{
  const x=await fixture(t);
  await new Promise(resolve=>{
    const req=http.request({host:'127.0.0.1',port:x.server.address().port,path:'/api/v1/inbound-events',method:'POST',headers:{Authorization:'Bearer good-token','Content-Length':'1000','Idempotency-Key':'boundary-abort-1'}});
    req.on('error',()=>resolve());req.write('{"subject":');req.on('socket',socket=>socket.on('connect',()=>setTimeout(()=>req.destroy(),15)));
  });
  assert.equal((await x.request({url:'/api/v1/health',method:'GET',body:''})).status,200);assert.equal(x.calls.length,0);
});

test('unexpected integration error metadata is also redacted in audit failure reasons',async t=>{
  const x=await fixture(t,{failure:Object.assign(new Error('synthetic-private-error'),{status:400,code:'PRIVATE_ADAPTER_CODE'})});
  const r=await x.request({url:'/api/v1/integrations/graph/subscriptions',body:JSON.stringify({mailboxId:'synthetic@example.invalid'})});
  assert.equal(r.status,500);assert.deepEqual(x.audits.map(a=>[a.outcome,a.reason]),[['ATTEMPT',undefined],['FAILED','INTERNAL_ERROR']]);
  assert.equal(JSON.stringify(x.audits).includes('PRIVATE_ADAPTER_CODE'),false);
});
for(const failure of [null,undefined,'synthetic-private-error',1000]) test(`non-Error thrown value ${String(failure)} returns safe envelope`,async t=>{
  // Trigger the failure through the real authentication callback boundary.
  const server=createApiServer({platform:{},authProvider:{authenticate(){throw failure;}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/matters`);
  assert.equal(r.status,500);assert.equal((await r.json()).code,'INTERNAL_ERROR');
});
test('trusted error metadata cannot be changed into an unsafe HTTP status or private code',async t=>{
  const error=appError('request conflicts',{status:409,code:'IDEMPOTENCY_CONFLICT'});
  error.status=1000;error.code='PRIVATE_ADAPTER_CODE';error.message='synthetic-private-error';
  const x=await fixture(t,{failure:error});const r=await x.request({url:'/api/v1/matters',method:'GET'});
  assert.equal(r.status,409);assert.equal(r.body.code,'IDEMPOTENCY_CONFLICT');assert.equal(r.body.message,'request conflicts');
});

for(const options of [{status:700,code:'BAD_REQUEST'},{status:-1,code:'BAD_REQUEST'},{status:400,code:'private-invalid-code'}]) test(`invalid trusted error metadata ${JSON.stringify(options)} fails closed`,async t=>{
  const x=await fixture(t,{failure:appError('synthetic-private-error',options)});
  const r=await x.request({url:'/api/v1/matters',method:'GET'});assert.equal(r.status,500);assert.equal(r.body.code,'INTERNAL_ERROR');assert.equal(r.body.message,'internal error');
});
test('untrusted exception getters are never consulted for public classification',async t=>{
  const error=new Error('synthetic-private-error');for(const key of ['status','code']) Object.defineProperty(error,key,{get(){throw new Error('unsafe metadata getter');}});
  const x=await fixture(t,{failure:error});const r=await x.request({url:'/api/v1/matters',method:'GET'});assert.equal(r.status,500);assert.equal(r.body.code,'INTERNAL_ERROR');
});
test('invalid absolute-form request URL is a safe client error',async t=>{
  const x=await fixture(t);const r=await x.request({url:'//[',method:'GET'});assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_REQUEST');assert.equal(x.calls.length,0);
});
