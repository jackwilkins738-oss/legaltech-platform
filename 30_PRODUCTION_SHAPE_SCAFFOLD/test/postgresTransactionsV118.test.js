import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresTenantTransactions,runPostgresTransaction} from '../src/postgresTransactions.js';
const context={tenantId:'11800000-0000-4000-8000-000000000001',actorId:'11800000-0000-4000-8000-000000000011'};
function driver({query=async()=>({rows:[]}),role='runtime'}={}) {
  const calls=[],releases=[];
  const client={query:async(sql,values)=>{calls.push({sql,values});if(sql.includes('current_user AS effective_role'))return {rows:[{effective_role:role,login_role:role,tenant_context:null,actor_context:null}]};if(sql.startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))return {rows:[{tenant_context:null,actor_context:null}]};return query(sql,values)},release:destroy=>releases.push(destroy)};
  return {client,calls,releases,pool:{connect:async()=>client}};
}
const boundary=(x,options={})=>new PostgresTenantTransactions({pool:x.pool,expectedRole:'runtime',timeoutMs:100,...options});

test('V120 repeatable-read is selected in BEGIN before any snapshot-producing query',async()=>{
  const x=driver();await runPostgresTransaction({pool:x.pool,expectedRole:'runtime',readOnly:true,isolation:'REPEATABLE READ'},async tx=>{await tx.query('SELECT 1')});
  assert.equal(x.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');assert.deepEqual(x.releases,[false]);
});
test('V120 unsupported or injected isolation clauses cannot check out a connection',async()=>{
  const x=driver();for(const isolation of ['SERIALIZABLE','REPEATABLE READ; RESET ALL',{},null])await assert.rejects(runPostgresTransaction({pool:x.pool,expectedRole:'runtime',isolation},async()=>{}),/CONFIGURATION_INVALID/);
  assert.equal(x.calls.length,0);
});

test('V118 tenant context uses transaction-local bound parameters on one checked-out connection',async()=>{
  const x=driver();const tx=boundary(x);let retained;
  assert.equal(await tx.run(context,async client=>{retained=client;await client.query('SELECT $1::text',['synthetic']);return 7}),7);
  assert.equal(x.calls[0].sql,'BEGIN');assert.ok(x.calls.some(c=>c.sql==='COMMIT'));assert.ok(x.calls.at(-1).sql.includes('AS tenant_context'));
  assert.deepEqual(x.calls.find(c=>c.sql.includes("set_config('app.tenant_id'"))?.values,[context.tenantId,context.actorId]);
  assert.deepEqual(x.releases,[false]);
  const count=x.calls.length;await assert.rejects(retained.query('SELECT 1'),/UNAVAILABLE/);assert.equal(x.calls.length,count);
});
test('V118 malformed scopes are rejected before any pool acquisition',async()=>{
  let acquired=0;const tx=new PostgresTenantTransactions({pool:{connect:()=>{acquired++}},expectedRole:'runtime'});
  for(const invalid of [{}, {...context,tenantId:"x'; RESET ALL;"}, {...context,actorId:'client-supplied-label'}])await assert.rejects(tx.run(invalid,async()=>{}),/CONTEXT_INVALID/);
  assert.equal(acquired,0);
});
test('V118 runtime role mismatch discards connection before domain work',async()=>{
  const x=driver({role:'owner'});let work=0;await assert.rejects(boundary(x).run(context,async()=>{work++}),/UNAVAILABLE/);
  assert.equal(work,0);assert.deepEqual(x.releases,[true]);assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);
});
test('V118 SQL and callback failures never commit or return an open transaction to the pool',async()=>{
  for(const mode of ['SQL','CALLBACK']) {
    const x=driver({query:async sql=>{if(sql==='SELECT bad')throw new Error('SENSITIVE_DB_CONNECTION_DETAIL');return {rows:[]}}});
    await assert.rejects(boundary(x).run(context,async tx=>{if(mode==='SQL')await tx.query('SELECT bad');else throw new Error('SENSITIVE_PROVIDER_DETAIL')}),error=>error.message==='POSTGRES_TRANSACTION_UNAVAILABLE');
    assert.deepEqual(x.releases,[true]);assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);
  }
});
test('V118 timed-out callbacks abort their signal and cannot send late tenant SQL',async()=>{
  const x=driver();let retained,resolveWork,started;const start=new Promise(resolve=>{started=resolve});
  const pending=boundary(x).run(context,async tx=>{retained=tx;started();await new Promise(resolve=>{resolveWork=resolve});await tx.query('SELECT late')});
  await start;await assert.rejects(pending,/UNAVAILABLE/);assert.equal(retained.signal.aborted,true);assert.deepEqual(x.releases,[true]);
  resolveWork();await new Promise(resolve=>setImmediate(resolve));assert.equal(x.calls.some(c=>c.sql==='SELECT late'||c.sql==='COMMIT'),false);
});
test('V118 external abort releases once and rejects late query results',async()=>{
  let resolveQuery,started;const start=new Promise(resolve=>{started=resolve});
  const x=driver({query:async sql=>{if(sql==='SELECT held'){started();return new Promise(resolve=>{resolveQuery=resolve})}return {rows:[]}}});
  const controller=new AbortController();const pending=boundary(x).run({...context,signal:controller.signal},tx=>tx.query('SELECT held'));
  await start;controller.abort();await assert.rejects(pending,/UNAVAILABLE/);resolveQuery({rows:[]});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(x.releases,[true]);assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);
});
test('V118 pool acquisition after timeout is discarded without opening a transaction',async()=>{
  const x=driver();let resolveAcquire;x.pool.connect=()=>new Promise(resolve=>{resolveAcquire=resolve});
  const pending=boundary(x).run(context,async()=>{});await assert.rejects(pending,/UNAVAILABLE/);resolveAcquire(x.client);
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(x.releases,[true]);assert.equal(x.calls.length,0);
});
test('V118 unawaited queries prevent commit and destroy the backend',async()=>{
  let resolveQuery;const x=driver({query:async sql=>sql==='SELECT held'?new Promise(resolve=>{resolveQuery=resolve}):{rows:[]}});
  await assert.rejects(boundary(x).run(context,async tx=>{tx.query('SELECT held')}),/UNAVAILABLE/);
  assert.deepEqual(x.releases,[true]);assert.equal(x.calls.some(c=>c.sql==='COMMIT'),false);resolveQuery({rows:[]});
});
test('V118 ambiguous COMMIT failure is redacted and destroys the backend',async()=>{
  const x=driver({query:async sql=>{if(sql==='COMMIT')throw new Error('NETWORK_AFTER_COMMIT');return {rows:[]}}});
  await assert.rejects(boundary(x).run(context,async()=>true),/OUTCOME_UNKNOWN/);assert.deepEqual(x.releases,[true]);
});
test('V118 read-only mode and already-aborted scopes preserve safe transaction semantics',async()=>{
  const x=driver();await boundary(x).run({...context,readOnly:true},async()=>{});assert.equal(x.calls[0].sql,'BEGIN READ ONLY');
  const controller=new AbortController();controller.abort();await assert.rejects(runPostgresTransaction({pool:{connect:()=>{throw new Error('must not connect')}},expectedRole:'runtime',signal:controller.signal},async()=>{}),/UNAVAILABLE/);
});
test('V118 stale pooled session context is discarded before another tenant receives the connection',async()=>{
  const x=driver(),original=x.client.query;let work=0;
  x.client.query=async(...args)=>{const result=await original(...args);if(args[0].includes('current_user AS effective_role'))result.rows[0].tenant_context=context.tenantId;return result};
  await assert.rejects(boundary(x).run(context,async()=>{work++}),/UNAVAILABLE/);assert.equal(work,0);assert.deepEqual(x.releases,[true]);
});
test('V118 uncleared context after COMMIT is an uncertain result and the backend is discarded',async()=>{
  const x=driver(),original=x.client.query;
  x.client.query=async(...args)=>{const result=await original(...args);if(args[0].startsWith("SELECT NULLIF(current_setting('app.tenant_id'"))result.rows[0].tenant_context=context.tenantId;return result};
  await assert.rejects(boundary(x).run(context,async()=>true),/OUTCOME_UNKNOWN/);assert.deepEqual(x.releases,[true]);
});

for(const key of ['tenantId','actorId']){
  for(const stage of ['checkout','role-check']){
    test(`V160 direct transaction pins ${key} before ${stage}`,async()=>{
      const supplied={...context},x=driver(),replacement='99999999-9999-4999-8999-999999999999';
      if(stage==='checkout')x.pool.connect=async()=>{supplied[key]=replacement;await Promise.resolve();return x.client;};
      else {const query=x.client.query;x.client.query=async(...args)=>{const result=await query(...args);if(args[0].includes('current_user AS effective_role'))supplied[key]=replacement;return result;};}
      await runPostgresTransaction({pool:x.pool,expectedRole:'runtime',context:supplied},async tx=>tx.query('SELECT 1'));
      assert.deepEqual(x.calls.find(c=>c.sql.includes("set_config('app.tenant_id'"))?.values,[context.tenantId,context.actorId]);
      assert.deepEqual(x.releases,[false]);
    });
  }
  for(const kind of ['accessor','inherited','hidden','coercible']){
    test(`V160 both transaction APIs reject ${kind} ${key} before checkout`,async()=>{
      let touched=0;const supplied={...context};
      if(kind==='accessor')Object.defineProperty(supplied,key,{get(){touched++;return context[key];}});
      if(kind==='inherited'){delete supplied[key];Object.setPrototypeOf(supplied,{[key]:context[key]});}
      if(kind==='hidden')Object.defineProperty(supplied,key,{value:context[key],enumerable:false});
      if(kind==='coercible')supplied[key]={toString(){touched++;return context[key];}};
      const pool={connect:async()=>{touched++;throw Error('unexpected checkout');}};
      await assert.rejects(runPostgresTransaction({pool,expectedRole:'runtime',context:supplied},async()=>{}),/CONTEXT_INVALID/);
      await assert.rejects(new PostgresTenantTransactions({pool,expectedRole:'runtime'}).run(supplied,async()=>{}),/CONTEXT_INVALID/);
      assert.equal(touched,0);
    });
  }
}
test('V160 role coercion cannot run code or check out a connection',async()=>{
  let touched=0;const expectedRole={toString(){touched++;return 'runtime';}},pool={connect:async()=>{touched++;}};
  assert.throws(()=>new PostgresTenantTransactions({pool,expectedRole}),/CONFIGURATION_INVALID/);
  await assert.rejects(runPostgresTransaction({pool,expectedRole},async()=>{}),/CONFIGURATION_INVALID/);
  assert.equal(touched,0);
});
test('V160 UUID normalization occurs before checkout without changing caller fields',async()=>{
  const x=driver(),supplied={tenantId:'ABCDEFAB-0000-4000-8000-000000000001',actorId:context.actorId};
  await runPostgresTransaction({pool:x.pool,expectedRole:'runtime',context:supplied},async()=>{});
  assert.equal(supplied.tenantId,'ABCDEFAB-0000-4000-8000-000000000001');
  assert.deepEqual(x.calls.find(c=>c.sql.includes("set_config('app.tenant_id'"))?.values,[supplied.tenantId.toLowerCase(),context.actorId]);
});
