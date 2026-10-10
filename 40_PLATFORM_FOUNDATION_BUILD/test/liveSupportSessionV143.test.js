import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSupportSessionBoundary} from '../src/liveSupportSessionBoundary.js';

const session={tenantId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333'};
const active={...session,active:true,stepUpValid:true};

test('V143 accepts current live session proof',async()=>{
  const boundary=new LiveSupportSessionBoundary({check:async()=>active});
  assert.equal(await boundary.assertCurrent(session),true);
});

test('V143 denies unavailable live session authority',async()=>{
  const boundary=new LiveSupportSessionBoundary({check:async()=>{throw Error('unavailable');}});
  await assert.rejects(boundary.assertCurrent(session),/LIVE_SUPPORT_SESSION_UNAVAILABLE/);
});

test('V143 denies expired and mismatched proofs',async()=>{
  for(const bad of [{...active,active:false},{...active,stepUpValid:false},{...active,actorId:session.tenantId}]){
    const boundary=new LiveSupportSessionBoundary({check:async()=>bad});
    await assert.rejects(boundary.assertCurrent(session),/LIVE_SUPPORT_SESSION_UNAVAILABLE/);
  }
});

test('V144 deadline denies stalled provider and aborts provider signal',async()=>{
  let providerSignal;
  const boundary=new LiveSupportSessionBoundary({timeoutMs:50,check:({signal})=>{
    providerSignal=signal;
    return new Promise(()=>{});
  }});
  await assert.rejects(boundary.assertCurrent(session),/LIVE_SUPPORT_SESSION_UNAVAILABLE/);
  assert.equal(providerSignal.aborted,true);
});

test('V144 caller abort denies unresolved provider immediately',async()=>{
  const controller=new AbortController();
  const boundary=new LiveSupportSessionBoundary({timeoutMs:1000,check:()=>new Promise(()=>{})});
  const pending=boundary.assertCurrent(session,{signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,/LIVE_SUPPORT_SESSION_UNAVAILABLE/);
});

test('V144 rejects invalid deadline configuration',()=>{
  for(const timeoutMs of [0,49,10001,NaN,1.5]){
    assert.throws(()=>new LiveSupportSessionBoundary({check:async()=>active,timeoutMs}),/LIVE_SUPPORT_SESSION_CONFIGURATION_INVALID/);
  }
});
