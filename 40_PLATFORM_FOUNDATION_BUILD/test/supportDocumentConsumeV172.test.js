import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportDocumentConsumeGate} from '../src/supportDocumentAuthorization.js';
const uuid='11700000-0000-4000-8000-000000000021';
const value=()=>({eventId:uuid,resultJobId:uuid,resultHash:'a'.repeat(64),artifactHash:'b'.repeat(64),contentType:'application/pdf',size:5,bytes:Buffer.from('%PDF-'),signal:new AbortController().signal});
test('V172 consumption checks authority before and after consumer',async()=>{
  const phases=[];
  const consume=createSupportDocumentConsumeGate({authorizeRelease:async x=>{phases.push(x.phase);return true;},consume:async()=>{phases.push('CONSUMED');}});
  await consume(value());
  assert.deepEqual(phases,['RELEASE','CONSUMED','RELEASE']);
});
test('V172 pre-transfer denied grant never calls consumer',async()=>{
  let sends=0;
  const consume=createSupportDocumentConsumeGate({authorizeRelease:async()=>false,consume:async()=>{sends++;}});
  await assert.rejects(consume(value()),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  assert.equal(sends,0);
});
test('V172 revocation during consuming returns denial rather than success',async()=>{
  let valid=true,checks=0;
  const consume=createSupportDocumentConsumeGate({authorizeRelease:async()=>{checks++;return valid;},consume:async()=>{valid=false;}});
  await assert.rejects(consume(value()),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  assert.equal(checks,2);
});
test('V172 malicious accessors are never executed or transferred',async()=>{
  const payload=value();
  Object.defineProperty(payload,'bytes',{enumerable:true,get(){throw Error('should not execute getter');}});
  let sent=false;
  const consume=createSupportDocumentConsumeGate({authorizeRelease:async()=>true,consume:async()=>{sent=true;}});
  await assert.rejects(consume(payload),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  assert.equal(sent,false);
});

test('V173 both transfer checks must use a supported RELEASE phase',async()=>{
  let sends=0,checks=0;
  const consume=createSupportDocumentConsumeGate({
    authorizeRelease:async x=>{checks++;if(x.phase!=='RELEASE')throw Error('UNSUPPORTED_PHASE');return true;},
    consume:async()=>{sends++;}
  });
  await consume(value());
  assert.equal(checks,2);
  assert.equal(sends,1);
});
test('V173 aborted transfer cannot report success after consumer completion',async()=>{
  const controller=new AbortController();
  const payload={...value(),signal:controller.signal};
  let checks=0;
  const consume=createSupportDocumentConsumeGate({
    authorizeRelease:async()=>{checks++;return true;},
    consume:async()=>{controller.abort();}
  });
  await assert.rejects(consume(payload),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  assert.equal(checks,1);
});

test('V174 malformed byte count fails before authorization and consumption',async()=>{
  let checks=0,sends=0;
  const gate=createSupportDocumentConsumeGate({authorizeRelease:async()=>{checks++;return true;},consume:async()=>{sends++;}});
  await assert.rejects(gate({...value(),size:6}),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  await assert.rejects(gate({...value(),bytes:'%PDF-'}),/SUPPORT_DOCUMENT_AUTHORIZATION_UNAVAILABLE/);
  assert.equal(checks,0);
  assert.equal(sends,0);
});
test('V174 successful consumer gets original pinned bytes under both release checks',async()=>{
  const payload=value();const seen=[];let sends=0;
  const gate=createSupportDocumentConsumeGate({authorizeRelease:async v=>{seen.push(v.bytes);return true;},consume:async v=>{sends++;assert.equal(v.bytes,payload.bytes);}});
  await gate(payload);
  assert.equal(sends,1);
  assert.equal(seen.length,2);
  assert.ok(seen.every(x=>x===payload.bytes));
});
