import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresSupportGrantLookup,SUPPORT_GRANT_LOOKUP_SQL} from '../src/postgresSupportGrantLookup.js';
const input={tenantId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',requestId:'44444444-4444-4444-8444-444444444444',matterId:'55555555-5555-4555-8555-555555555555',scope:'MATTER_READ',documentRefHash:null};
const row={id:input.requestId,tenant_id:input.tenantId,requester_id:input.actorId,matter_id:input.matterId,scope:input.scope,document_ref_hash:null};
test('V149 query requires exact approval, DB time, and no revocation',()=>{
  assert.match(SUPPORT_GRANT_LOOKUP_SQL,/support_access_approvals/);
  assert.match(SUPPORT_GRANT_LOOKUP_SQL,/support_access_revocations/);
  assert.match(SUPPORT_GRANT_LOOKUP_SQL,/statement_timestamp\(\)/);
});
test('V149 returns exact authorized grant decision',async()=>{
  const lookup=createPostgresSupportGrantLookup({transact:async(context,work)=>{
    assert.equal(context.tenantId,input.tenantId);
    assert.equal(context.readOnly,true);
    return work({query:async(sql,args)=>{assert.equal(sql,SUPPORT_GRANT_LOOKUP_SQL);assert.deepEqual(args.slice(0,5),[input.tenantId,input.actorId,input.requestId,input.matterId,input.scope]);return {rows:[row]};}});
  }});
  assert.deepEqual(await lookup(input),{...input,active:true});
});
test('V149 denies missing, duplicated, cross-tenant and failed database responses',async()=>{
  for(const rows of [[],[row,row],[{...row,tenant_id:input.actorId}]]){
    const lookup=createPostgresSupportGrantLookup({transact:async(_,work)=>work({query:async()=>({rows})})});
    await assert.rejects(lookup(input),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
  }
  const down=createPostgresSupportGrantLookup({transact:async()=>{throw Error('offline');}});
  await assert.rejects(down(input),/DURABLE_SUPPORT_GRANT_UNAVAILABLE/);
});
