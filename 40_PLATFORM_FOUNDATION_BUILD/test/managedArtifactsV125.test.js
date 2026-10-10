// Mandatory security concept: V125 managed processing adoption and canary.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {ManagedWorkerArtifacts} from '../src/managedWorkerArtifacts.js';
const tenantId='12500000-0000-4000-8000-000000000001',id='12500000-0000-4000-8000-000000000002',other='12500000-0000-4000-8000-000000000099';
const source=Buffer.from('synthetic approved artifact'),hash=crypto.createHash('sha256').update(source).digest('hex');
const request={tenantId,payloadId:id,payloadHash:hash};
function fixture(options={}){
  const calls=[],state={closed:0,manifest:{tenantId,id,kind:'PAYLOAD',hash,objectKey:`${tenantId}/payload/object`,versionId:'immutable-v1',size:source.length,state:'PROCESSING_ALLOWED',evidenceHash:'a'.repeat(64),region:'test-region',revision:1}};
  const manifest={resolveVersion:async()=>({...state.manifest}),probe:async()=>({ok:true}),...options.manifest};
  const storage={readVersion:async m=>({tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,body:(async function*(){try{yield source.subarray(0,4);yield source.subarray(4);}finally{state.closed++;}})()}),probe:async()=>({ok:true}),...options.storage};
  const configuration={manifest,storage,authorizeVersion:async c=>{calls.push(c.phase);return true;},verifyEvidence:async()=>true,...options.configuration};
  return {provider:new ManagedWorkerArtifacts(configuration),state,calls,configuration,manifest,storage};
}
test('V125 managed loader binds immutable provider versions and returns verified owned bytes',async()=>{const f=fixture(),r=await f.provider.loadPayload(request);assert.deepEqual(r.bytes,source);assert.notEqual(r.bytes,source);assert.equal(r.id,id);assert.deepEqual(f.calls,['RESOLVE','READ_VERSION','RETURN_VERSION']);assert.equal(f.state.closed,1);assert.ok(Object.isFrozen(r));});
test('V125 managed policy loader requires the exact published version',async()=>{const f=fixture();Object.assign(f.state.manifest,{kind:'POLICY',state:'PUBLISHED'});assert.deepEqual((await f.provider.loadPolicy({tenantId,policyVersionId:id,policyVersionHash:hash})).bytes,source);});
test('V125 malformed scope or digest never resolves a provider version',async()=>{let calls=0;const f=fixture({manifest:{resolveVersion:async()=>{calls++;}}});for(const change of [{tenantId:'bad'},{payloadId:'https://evil.invalid'},{payloadHash:'bad'},{signal:{}}])await assert.rejects(f.provider.loadPayload({...request,...change}),/PROVIDER_UNAVAILABLE/);assert.equal(calls,0);});
test('V125 current authorization is strict at resolve, version read and byte return',async()=>{
  for(const phase of ['RESOLVE','READ_VERSION','RETURN_VERSION']){const f=fixture({configuration:{authorizeVersion:async c=>c.phase!==phase}});await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);}
  const f=fixture({configuration:{authorizeVersion:async()=>1}});await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);
});
test('V125 manifest tenant, id, kind, digest, state and evidence are mandatory',async()=>{
  for(const change of [{tenantId:other},{id:other},{kind:'POLICY'},{hash:'b'.repeat(64)},{state:'QUARANTINED'},{evidenceHash:'bad'},{revision:0},{size:0},{size:16*1024*1024},{region:'https://evil.invalid'},{extra:'private'}]){const f=fixture();Object.assign(f.state.manifest,change);await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);}
});
test('V125 traversal, URLs, other-tenant keys and invalid provider versions cannot reach SDK reads',async()=>{
  for(const change of [{objectKey:'https://evil.invalid'},{objectKey:`${other}/object`},{objectKey:`${tenantId}/../object`},{objectKey:`${tenantId}//object`},{objectKey:`${tenantId}/./object`},{versionId:'https://evil.invalid/v1'},{versionId:''},{versionId:'latest'},{versionId:'null'}]){let reads=0;const f=fixture({storage:{readVersion:async()=>{reads++;}}});Object.assign(f.state.manifest,change);await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);assert.equal(reads,0);}
});
test('V125 evidence verification is required both before and after streaming',async()=>{for(const denyAt of [1,2]){let n=0;const f=fixture({configuration:{verifyEvidence:async()=>++n!==denyAt}});await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);}});
test('V125 a changed manifest revision, approval or immutable binding discards streamed bytes',async()=>{
  for(const change of [{revision:2},{state:'REVOKED'},{versionId:'v2'},{evidenceHash:'b'.repeat(64)}]){let n=0;const f=fixture({manifest:{resolveVersion:async()=>{n++;return {...f.state.manifest,...(n===2?change:{})};}}});await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);assert.equal(f.state.closed,1);}
});
test('V125 response metadata must match the selected version and mismatches close its iterator',async()=>{
  for(const change of [{tenantId:other},{objectKey:'other/object'},{versionId:'v2'},{hash:'b'.repeat(64)},{contentLength:source.length+1}]){let closed=0;const f=fixture();
    const provider=new ManagedWorkerArtifacts({...f.configuration,storage:{probe:async()=>({ok:true}),readVersion:async m=>({tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,...change,body:{[Symbol.asyncIterator]:()=>({next:async()=>({done:true}),return:async()=>{closed++;return {done:true};}})}})}});
    await assert.rejects(provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);assert.equal(closed,1);
  }
});
test('V125 extra/missing/accessor manifest fields are refused without invoking getters',async()=>{let read=0;const f=fixture();const m={...f.state.manifest};Object.defineProperty(m,'objectKey',{get(){read++;return 'private';},enumerable:true});const g=fixture({manifest:{resolveVersion:async()=>m}});await assert.rejects(g.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);assert.equal(read,0);});
test('V125 oversized, short, empty, nonbyte or tampered streams never return an artifact',async()=>{
  for(const chunks of [[Buffer.alloc(source.length+1)],[source.subarray(0,3)],[Buffer.alloc(0)],['private'],[Buffer.alloc(source.length)]]){const f=fixture({storage:{readVersion:async m=>({tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,body:(async function*(){yield* chunks;})()})}});await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);}
});
test('V125 excessive chunk counts and configured size limits fail closed',async()=>{
  const f=fixture({configuration:{maxPayloadBytes:1}});await assert.rejects(f.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);
  const g=fixture({storage:{readVersion:async m=>({tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,body:(async function*(){for(let i=0;i<4097;i++)yield Buffer.from([1]);})()})}});g.state.manifest.size=5000;await assert.rejects(g.provider.loadPayload(request),/PROVIDER_UNAVAILABLE/);
});
test('V125 abort after SDK read closes resources before returning and never follows a URL',async()=>{
  const c=new AbortController();let closed=0;const f=fixture({storage:{readVersion:async m=>{c.abort();return {tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,body:{[Symbol.asyncIterator]:()=>({next:async()=>({done:true}),return:async()=>{closed++;return {done:true};}})}}}}});await assert.rejects(f.provider.loadPayload({...request,signal:c.signal}),/PROVIDER_UNAVAILABLE/);assert.equal(closed,1);
});
test('V125 failed iterator cleanup is sanitized and not mistaken for completed reading',async()=>{
  const f=fixture({storage:{readVersion:async m=>({tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,body:{[Symbol.asyncIterator]:()=>({next:async()=>({done:true}),return:async()=>{throw new Error('SECRET_SDK');}})}})}});await assert.rejects(f.provider.loadPayload(request),e=>e.message==='WORKER_ARTIFACT_PROVIDER_UNAVAILABLE');
});
test('V125 managed probes use bound actual providers and report only safe machine health',async()=>{const f=fixture();f.manifest.probe=async()=>{throw new Error('SECRET');};assert.equal((await f.provider.probe()).ok,true);const g=fixture({storage:{probe:async()=>{throw new Error('SECRET');}}});assert.deepEqual(await g.provider.probe(),{ok:false,code:'WORKER_ARTIFACT_PROVIDER_UNVERIFIED'});});
test('V125 managed providers require evidence, current permission, version reads and bounded limits',()=>{const f=fixture();for(const change of [{verifyEvidence:undefined},{authorizeVersion:undefined},{manifest:{}},{storage:{}},{maxPolicyBytes:1048577},{maxPayloadBytes:0}])assert.throws(()=>new ManagedWorkerArtifacts({...f.configuration,...change}),/CONFIGURATION_INVALID/);});
test('V125 SDK cleanup is awaited exactly once before returning a failed read',async()=>{
  let finish,closed=0,settled=false;const f=fixture({storage:{readVersion:async m=>({tenantId:m.tenantId,objectKey:m.objectKey,versionId:m.versionId,hash:m.hash,contentLength:m.size,body:{[Symbol.asyncIterator]:()=>({next:async()=>({value:'invalid',done:false}),return:async()=>{closed++;await new Promise(r=>{finish=r;});return {done:true};}})}})}});
  const task=f.provider.loadPayload(request).catch(e=>{settled=true;return e;});for(let i=0;i<100&&!finish;i++)await new Promise(r=>setTimeout(r,1));assert.equal(settled,false);assert.equal(closed,1);finish();assert.equal((await task).message,'WORKER_ARTIFACT_PROVIDER_UNAVAILABLE');assert.equal(closed,1);
});
