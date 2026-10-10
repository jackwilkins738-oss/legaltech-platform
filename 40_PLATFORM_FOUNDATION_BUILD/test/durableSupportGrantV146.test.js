import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableSupportGrantReader} from '../src/durableSupportGrantReader.js';
const session={tenantId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333'};
const request={requestId:'44444444-4444-4444-8444-444444444444',matterId:'55555555-5555-4555-8555-555555555555',scope:'MATTER_READ'};
const decision={...request,tenantId:session.tenantId,actorId:session.actorId,documentRefHash:null,active:true};
test('V146 accepts exact live session and durable decision',async()=>{
  let checks=0;
  const reader=new DurableSupportGrantReader({liveSession:{assertCurrent:async()=>{checks++;return true;}},readCurrent:async()=>decision});
  assert.equal(await reader.assertCurrent(session,request),true);
  assert.equal(checks,2);
});
test('V146 denies unavailable or revoked durable grant',async()=>{
  for(const value of [null,{...decision,active:false},{...decision,tenantId:session.actorId},{...decision,requestId:session.tenantId}]){
    const reader=new DurableSupportGrantReader({liveSession:{assertCurrent:async()=>true},readCurrent:async()=>value});
    await assert.rejects(reader.assertCurrent(session,request),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
  }
});
test('V146 denies live session revocation after delayed database decision',async()=>{
  let checks=0;
  const reader=new DurableSupportGrantReader({liveSession:{assertCurrent:async()=>{if(++checks===2)throw Error('revoked');return true;}},readCurrent:async()=>decision});
  await assert.rejects(reader.assertCurrent(session,request),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
});
test('V146 denies database outage',async()=>{
  const reader=new DurableSupportGrantReader({liveSession:{assertCurrent:async()=>true},readCurrent:async()=>{throw Error('database down');}});
  await assert.rejects(reader.assertCurrent(session,request),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
});
