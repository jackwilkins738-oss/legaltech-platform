import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveSupportSessionBoundary} from '../src/liveSupportSessionBoundary.js';
import {DurableSupportGrantReader} from '../src/durableSupportGrantReader.js';
import {createPostgresSupportGrantLookup} from '../src/postgresSupportGrantLookup.js';
import {PostgresSupportGrantMutations} from '../src/postgresSupportGrantMutations.js';
const original=Object.freeze({tenantId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333'});
const replacement='99999999-9999-4999-8999-999999999999';
const grant=Object.freeze({requestId:'44444444-4444-4444-8444-444444444444',matterId:'55555555-5555-4555-8555-555555555555',scope:'MATTER_READ',documentRefHash:null});
const decision={tenantId:original.tenantId,actorId:original.actorId,...grant,active:true};
for(const key of Object.keys(original)){
  test(`V157 live session pins ${key} while provider is pending`,async()=>{
    const session={...original};
    const boundary=new LiveSupportSessionBoundary({check:async input=>{
      assert.equal(Object.isFrozen(input),true);
      session[key]=replacement;
      await Promise.resolve();
      return {...original,active:true,stepUpValid:true};
    }});
    assert.equal(await boundary.assertCurrent(session),true);
  });
  test(`V157 live session rejects replacement ${key} proof`,async()=>{
    const session={...original};
    const boundary=new LiveSupportSessionBoundary({check:async()=>{
      session[key]=replacement;
      return {...session,active:true,stepUpValid:true};
    }});
    await assert.rejects(boundary.assertCurrent(session),/LIVE_SUPPORT_SESSION_UNAVAILABLE/);
  });
  test(`V157 durable reader keeps original ${key} across both live checks`,async()=>{
    const session={...original};let checks=0;
    const reader=new DurableSupportGrantReader({liveSession:{assertCurrent:async pinned=>{
      assert.deepEqual(pinned,original);assert.equal(Object.isFrozen(pinned),true);
      session[key]=replacement;checks++;return true;
    }},readCurrent:async input=>{
      assert.equal(input.tenantId,original.tenantId);assert.equal(input.actorId,original.actorId);
      return decision;
    }});
    assert.equal(await reader.assertCurrent(session,grant),true);assert.equal(checks,2);
  });
  for(const operation of ['request','approve','revoke']){
    test(`V157 ${operation} pins ${key} in SQL, audit and final session check`,async()=>{
      const session={...original};let checks=0;let statements=0;
      const service=new PostgresSupportGrantMutations({liveSession:{assertCurrent:async pinned=>{
        assert.deepEqual(pinned,original);assert.equal(Object.isFrozen(pinned),true);
        session[key]=replacement;checks++;return true;
      }},transact:async(context,work)=>{
        assert.deepEqual(context,{tenantId:original.tenantId,actorId:original.actorId,readOnly:false});
        return work({query:async(sql,args)=>{
          statements++;assert.equal(JSON.stringify(args).includes(replacement),false);
          if(sql.includes('FROM public.support_access_requests'))return {rows:[{matter_id:grant.matterId,requester_id:grant.requestId,document_ref_hash:null}]};
          if(sql.includes('FROM public.support_access_revocations'))return {rows:[]};
          return {rows:[{id:args[0],request_id:grant.requestId}]};
        }});
      }});
      await service[operation]({session,...grant,ticketRefHash:'a'.repeat(64),purposeHash:'b'.repeat(64),reasonHash:'c'.repeat(64),traceId:'v157'});
      assert.equal(checks,2);assert.ok(statements>=2);
    });
  }
}
for(const kind of ['accessor','inherited','hidden']){
  test(`V157 all session entry points reject ${kind} identity without provider contact`,async()=>{
    let calls=0;const unexpected=async()=>{calls++;throw Error('unexpected provider');};
    const session={...original};
    if(kind==='accessor')Object.defineProperty(session,'actorId',{get(){calls++;return original.actorId;},enumerable:true});
    if(kind==='hidden')Object.defineProperty(session,'actorId',{value:original.actorId,enumerable:false});
    if(kind==='inherited'){delete session.actorId;Object.setPrototypeOf(session,{actorId:original.actorId});}
    const liveSession={assertCurrent:unexpected};
    const mutations=new PostgresSupportGrantMutations({liveSession,transact:unexpected});
    await assert.rejects(new LiveSupportSessionBoundary({check:unexpected}).assertCurrent(session));
    await assert.rejects(new DurableSupportGrantReader({liveSession,readCurrent:unexpected}).assertCurrent(session,grant));
    for(const operation of ['request','approve','revoke'])await assert.rejects(mutations[operation]({session,...grant,traceId:'v157'}));
    assert.equal(calls,0);
  });
}
for(const key of ['tenantId','actorId','requestId','matterId','scope','documentRefHash']){
  test(`V157 PostgreSQL lookup pins ${key} across transaction await`,async()=>{
    const input={tenantId:original.tenantId,actorId:original.actorId,...grant};
    const lookup=createPostgresSupportGrantLookup({transact:async(context,work)=>{
      input[key]=replacement;
      await Promise.resolve();
      return work({query:async(_,args)=>{
        assert.deepEqual(args,[original.tenantId,original.actorId,grant.requestId,grant.matterId,grant.scope,null]);
        return {rows:[{id:grant.requestId,tenant_id:original.tenantId,requester_id:original.actorId,matter_id:grant.matterId,scope:grant.scope,document_ref_hash:null}]};
      }});
    }});
    assert.deepEqual(await lookup(input),decision);
  });
}
test('V157 PostgreSQL lookup does not evaluate authorization accessors',async()=>{
  let calls=0;const input={tenantId:original.tenantId,actorId:original.actorId,...grant};
  Object.defineProperty(input,'requestId',{get(){calls++;return grant.requestId;}});
  const lookup=createPostgresSupportGrantLookup({transact:async()=>{calls++;}});
  await assert.rejects(lookup(input),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);assert.equal(calls,0);
});
