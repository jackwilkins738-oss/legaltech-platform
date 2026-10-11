import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupportDocumentConsumeGate} from '../src/supportDocumentAuthorization.js';
const uuid='11700000-0000-4000-8000-000000000021';
const value=()=>({eventId:uuid,resultJobId:uuid,resultHash:'a'.repeat(64),artifactHash:'b'.repeat(64),contentType:'application/pdf',size:5,bytes:Buffer.from('%PDF-'),signal:new AbortController().signal});
test('V172 consumption checks authority before and after consumer',async()=>{
  const phases=[];
  const consume=createSupportDocumentConsumeGate({authorizeRelease:async x=>{phases.push(x.phase);return true;},consume:async()=>{phases.push('CONSUMED');}});
  await consume(value());
  assert.deepEqual(phases,['RELEASE','CONSUMED','COMPLETE']);
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
