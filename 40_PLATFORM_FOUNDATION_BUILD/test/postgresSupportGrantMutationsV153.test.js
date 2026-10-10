import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresSupportGrantMutations,createTenantScopedPostgresSupportGrantMutations} from '../src/postgresSupportGrantMutations.js';
const session={tenantId:'11111111-1111-4111-8111-111111111111',actorId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333'};
const matterId='44444444-4444-4444-8444-444444444444';
const requestId='55555555-5555-4555-8555-555555555555';
const traceId='synthetic-153',reasonHash='a'.repeat(64);
const liveSession={assertCurrent:async()=>true};
test('V153 transaction access is tenant-scoped and fails closed when live identity fails',async()=>{
  let invoked=0;
  const service=new PostgresSupportGrantMutations({transact:async()=>{invoked++;},liveSession:{assertCurrent:async()=>false}});
  await assert.rejects(service.approve({session,requestId,traceId}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
  await assert.rejects(service.revoke({session,requestId,reasonHash,traceId}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
  assert.equal(invoked,0);
});
test('V153 approval locks grant, checks dual control, and atomically appends evidence',async()=>{
  const statements=[];
  const service=new PostgresSupportGrantMutations({liveSession,transact:async(context,work)=>{
    assert.deepEqual(context,{tenantId:session.tenantId,actorId:session.actorId,readOnly:false});
    return work({query:async(sql,args)=>{
      statements.push(sql);
      if(sql.includes('FROM public.support_access_requests'))return {rows:[{matter_id:matterId,requester_id:'66666666-6666-4666-8666-666666666666',document_ref_hash:null}]};
      if(sql.includes('FROM public.support_access_revocations'))return {rows:[]};
      return {rows:[{id:requestId}]};
    }});
  }});
  assert.equal((await service.approve({session,requestId,traceId})).status,'ACTIVE');
  assert.match(statements[0],/pg_advisory_xact_lock/);
  assert.ok(statements.some(x=>x.includes('INSERT INTO public.support_access_events')));
});
test('V153 revocation inserts deny marker and audit within same transaction',async()=>{
  const statements=[];
  const service=new PostgresSupportGrantMutations({liveSession,transact:async(_,work)=>work({query:async sql=>{
    statements.push(sql);
    return {rows:sql.includes('FROM public.support_access_requests')?[{matter_id:matterId,document_ref_hash:null}]:[{id:requestId}]};
  }})});
  assert.equal((await service.revoke({session,requestId,reasonHash,traceId})).status,'REVOKED');
  assert.match(statements[0],/pg_advisory_xact_lock/);
  assert.ok(statements.some(x=>x.includes('INSERT INTO public.support_access_revocations')));
  assert.ok(statements.some(x=>x.includes('INSERT INTO public.support_access_events')));
});
test('V153 no audit confirmation means no successful transition',async()=>{
  const service=new PostgresSupportGrantMutations({liveSession,transact:async(_,work)=>work({query:async sql=>{
    if(sql.includes('FROM public.support_access_requests'))return {rows:[{matter_id:matterId,document_ref_hash:null}]};
    if(sql.includes('INSERT INTO public.support_access_events'))throw Error('audit outage');
    return {rows:[{id:requestId}]};
  }})});
  await assert.rejects(service.revoke({session,requestId,reasonHash,traceId}),/DURABLE_SUPPORT_MUTATION_UNAVAILABLE/);
});

test('V154 operator factory rejects unprivileged and NOLOGIN role identities',()=>{
  assert.throws(()=>createTenantScopedPostgresSupportGrantMutations({pool:{connect:async()=>{}},expectedRole:'postgres',liveSession}),/DURABLE_SUPPORT_MUTATION_CONFIGURATION_INVALID/);
  assert.throws(()=>createTenantScopedPostgresSupportGrantMutations({pool:{connect:async()=>{}},expectedRole:'legaltech_support_operator',liveSession}),/DURABLE_SUPPORT_MUTATION_CONFIGURATION_INVALID/);
  assert.throws(()=>createTenantScopedPostgresSupportGrantMutations({pool:null,expectedRole:'legaltech_support_operator_ci',liveSession}),/POSTGRES_TRANSACTION_CONFIGURATION_INVALID/);
});
