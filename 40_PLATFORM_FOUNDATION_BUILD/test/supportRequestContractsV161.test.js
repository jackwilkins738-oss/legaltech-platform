import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresSupportGrantMutations} from '../src/postgresSupportGrantMutations.js';
import {DurableSupportGrantReader} from '../src/durableSupportGrantReader.js';
import {createPostgresSupportGrantLookup} from '../src/postgresSupportGrantLookup.js';
const session={tenantId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333'};
const grant={requestId:'44444444-4444-4444-8444-444444444444',matterId:'55555555-5555-4555-8555-555555555555',scope:'DOCUMENT_READ',documentRefHash:'a'.repeat(64)};
const request={session,...grant,ticketRefHash:'b'.repeat(64),purposeHash:'c'.repeat(64),reasonHash:'d'.repeat(64),traceId:'v161'};
for(const [method,keys] of [['request',['session','matterId','scope','documentRefHash','ticketRefHash','purposeHash','traceId']],['approve',['session','requestId','traceId']],['revoke',['session','requestId','reasonHash','traceId']]]){
  for(const key of keys){
    test(`V161 ${method} rejects accessor ${key} without executing it or a provider`,async()=>{
      let calls=0;const input={...request};
      Object.defineProperty(input,key,{get(){calls++;return request[key];}});
      const unexpected=async()=>{calls++;throw Error('unexpected');};
      const service=new PostgresSupportGrantMutations({liveSession:{assertCurrent:unexpected},transact:unexpected});
      await assert.rejects(service[method](input),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);assert.equal(calls,0);
    });
  }
}
for(const [method,key] of [['request','documentRefHash'],['request','ticketRefHash'],['request','purposeHash'],['revoke','reasonHash']]){
  for(const kind of ['object','array']){
    test(`V161 ${method} refuses ${kind} hash coercion for ${key}`,async()=>{
      let calls=0;const value=kind==='array'?['a'.repeat(64)]:{toString(){calls++;return 'a'.repeat(64);}};
      const unexpected=async()=>{calls++;throw Error('unexpected');};
      const service=new PostgresSupportGrantMutations({liveSession:{assertCurrent:unexpected},transact:unexpected});
      await assert.rejects(service[method]({...request,[key]:value}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);assert.equal(calls,0);
    });
  }
}
for(const key of ['requestId','matterId','scope','documentRefHash','signal']){
  test(`V161 durable reader refuses accessor ${key} before live or database checks`,async()=>{
    let calls=0;const input={...grant};Object.defineProperty(input,key,{enumerable:true,get(){calls++;return grant[key];}});
    const unexpected=async()=>{calls++;throw Error('unexpected');};
    const reader=new DurableSupportGrantReader({liveSession:{assertCurrent:unexpected},readCurrent:unexpected});
    await assert.rejects(reader.assertCurrent(session,input),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);assert.equal(calls,0);
  });
}
for(const value of [['a'.repeat(64)],{toString(){throw Error('coercion must not execute');}}]){
  test('V161 both grant read boundaries reject non-string document hash',async()=>{
    let calls=0;const unexpected=async()=>{calls++;throw Error('unexpected');};
    const reader=new DurableSupportGrantReader({liveSession:{assertCurrent:unexpected},readCurrent:unexpected});
    const lookup=createPostgresSupportGrantLookup({transact:unexpected});
    await assert.rejects(reader.assertCurrent(session,{...grant,documentRefHash:value}),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
    await assert.rejects(lookup({tenantId:session.tenantId,actorId:session.actorId,...grant,documentRefHash:value}),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);assert.equal(calls,0);
  });
}
