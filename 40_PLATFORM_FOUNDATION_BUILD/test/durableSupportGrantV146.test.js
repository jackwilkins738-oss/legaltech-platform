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

test('V147 rejects non-true live session proof before or after grant read',async()=>{
  for(const value of [false,null,undefined,{},1]){
    let called=0;
    const before=new DurableSupportGrantReader({
      liveSession:{assertCurrent:async()=>value},
      readCurrent:async()=>{called++;return decision;}
    });
    await assert.rejects(before.assertCurrent(session,request),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
    assert.equal(called,0);
    let checks=0;
    const after=new DurableSupportGrantReader({
      liveSession:{assertCurrent:async()=>++checks===1?true:value},
      readCurrent:async()=>decision
    });
    await assert.rejects(after.assertCurrent(session,request),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
    assert.equal(checks,2);
  }
});

test('V148 timed-out database lookup retains capacity until provider settles',async()=>{
  let settle,requests=0;
  const reader=new DurableSupportGrantReader({timeoutMs:50,maxConcurrent:1,
    liveSession:{assertCurrent:async()=>true},
    readCurrent:async()=>{requests++;if(requests===1)return new Promise(resolve=>{settle=resolve;});return decision;}
  });
  await assert.rejects(reader.assertCurrent(session,request),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
  await assert.rejects(reader.assertCurrent(session,request),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
  assert.equal(requests,1);
  settle(decision);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await reader.assertCurrent(session,request),true);
});

test('V148 rejects invalid lookup limits',()=>{
  for(const options of [{timeoutMs:49},{timeoutMs:10001},{maxConcurrent:0},{maxConcurrent:17}]){
    assert.throws(()=>new DurableSupportGrantReader({
      readCurrent:async()=>decision,liveSession:{assertCurrent:async()=>true},...options
    }),/DURABLE_SUPPORT_GRANT_CONFIGURATION_INVALID/);
  }
});
