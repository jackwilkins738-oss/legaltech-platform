import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresSupportTransferFence} from '../src/postgresSupportTransferFence.js';
const tenantId='11700000-0000-4000-8000-000000000001';
const actorId='11700000-0000-4000-8000-000000000011';
const requestId='11700000-0000-4000-8000-000000000041';
const matterId='11700000-0000-4000-8000-000000000031';
const documentRefHash='a'.repeat(64);
const input=()=>({tenantId,actorId,requestId,matterId,documentRefHash,scope:'DOCUMENT_READ',signal:new AbortController().signal});
const row=()=>({id:requestId,tenant_id:tenantId,requester_id:actorId,matter_id:matterId,scope:'DOCUMENT_READ',document_ref_hash:documentRefHash});
function fixture({found=true}={}){
  const statements=[];
  const transact=async (scope,work)=>work({query:async(sql,args)=>{
    statements.push({sql,args});
    if(sql.includes('pg_advisory_xact_lock'))return {rows:[{}]};
    return {rows:found?[row()]:[]};
  }});
  return {statements,transact};
}
test('V175 acquires identical request advisory lock before fetching durable grant or revealing bytes',async()=>{
  const {statements,transact}=fixture();let sent=0;
  const gate=createPostgresSupportTransferFence({transact});
  const response=await gate(input(),async()=>{sent++;return 'delivered';});
  assert.equal(response,'delivered');assert.equal(sent,1);
  assert.match(statements[0].sql,/pg_advisory_xact_lock/);
  assert.deepEqual(statements[0].args,[JSON.stringify([tenantId,requestId])]);
  assert.match(statements[1].sql,/support_access_revocations/);
});
test('V175 absent or revoked grant denies before consumer is invoked',async()=>{
  const {transact}=fixture({found:false});let sent=0;
  await assert.rejects(createPostgresSupportTransferFence({transact})(input(),async()=>{sent++;}),/SUPPORT_TRANSFER_FENCE_UNAVAILABLE/);
  assert.equal(sent,0);
});
test('V175 rejects mismatched document scope and accessor attack before touching database',async()=>{
  let calls=0;const gate=createPostgresSupportTransferFence({transact:async()=>{calls++;}});
  await assert.rejects(gate({...input(),scope:'MATTER_READ'},async()=>{}),/SUPPORT_TRANSFER_FENCE_UNAVAILABLE/);
  const forged=input();Object.defineProperty(forged,'tenantId',{enumerable:true,get(){throw Error('untrusted getter');}});
  await assert.rejects(gate(forged,async()=>{}),/SUPPORT_TRANSFER_FENCE_UNAVAILABLE/);
  assert.equal(calls,0);
});
test('V175 consumer failure never produces apparent successful authorization',async()=>{
  const {transact}=fixture();
  await assert.rejects(createPostgresSupportTransferFence({transact})(input(),async()=>{throw Error('transfer failure');}),/SUPPORT_TRANSFER_FENCE_UNAVAILABLE/);
});
