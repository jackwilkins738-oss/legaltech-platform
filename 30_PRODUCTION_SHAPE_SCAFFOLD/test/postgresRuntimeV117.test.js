import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPostgresRuntimeProbe} from '../src/postgresRuntime.js';

// Unit tests for adapter orchestration, NOT evidence that PostgreSQL policies execute.
function connection(query=async()=>({rows:[]})) {
  const queries=[],releases=[];
  const client={query:async(sql,params)=>{queries.push({sql,params});return query(sql,params)},release:error=>releases.push(error)};
  return {client,queries,releases,pool:{connect:async()=>client}};
}
const probe=x=>createPostgresRuntimeProbe({pool:x.pool,expectedRole:'legaltech_runtime',schema:'public'});
test('V117 database runtime probe uses direct runtime pool read-only transaction and bound identifiers',async()=>{
  const x=connection();assert.deepEqual(await probe(x)(),{ok:true,code:'DATABASE_RUNTIME_VERIFIED'});
  assert.equal(x.queries[0].sql,'BEGIN READ ONLY');assert.equal(x.queries.at(-1).sql,'ROLLBACK');
  assert.deepEqual(x.queries.find(q=>q.params)?.params,['legaltech_runtime','public']);
  assert.equal(x.releases.length,1);assert.equal(x.releases[0],undefined);
});
test('V117 catalog SQL failures are redacted and discard a potentially aborted connection',async()=>{
  const x=connection(async sql=>{if(sql.startsWith('-- V117'))throw new Error('SENSITIVE_DB_PROVIDER_ERROR')});
  assert.deepEqual(await probe(x)(),{ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'});
  assert.equal(x.releases.length,1);assert.ok(x.releases[0] instanceof Error);
  assert.equal(x.queries.some(q=>q.sql==='ROLLBACK'),false);
});
test('V117 database connection outage cannot claim runtime verification',async()=>{
  const x={pool:{connect:async()=>{throw new Error('SENSITIVE_CONNECTION_STRING')}}};
  assert.deepEqual(await probe(x)(),{ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'});
});
test('V117 probe abort destroys a stalled database connection and rejects a late success',async()=>{
  let resolveSql,started;const start=new Promise(resolve=>{started=resolve});
  const x=connection(async sql=>{if(sql.startsWith('-- V117')){started();await new Promise(resolve=>{resolveSql=resolve})}});
  const controller=new AbortController(),pending=probe(x)({signal:controller.signal});await start;
  controller.abort();assert.equal(x.releases.length,1);assert.ok(x.releases[0] instanceof Error);
  resolveSql();assert.deepEqual(await pending,{ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'});assert.equal(x.releases.length,1);assert.notEqual(x.queries.at(-1).sql,'ROLLBACK');
});
test('V117 late pool acquisition after timeout is destroyed before executing SQL',async()=>{
  const x=connection(),controller=new AbortController();let resolveConnect;
  x.pool.connect=()=>new Promise(resolve=>{resolveConnect=resolve});
  const pending=probe(x)({signal:controller.signal});controller.abort();resolveConnect(x.client);
  assert.deepEqual(await pending,{ok:false,code:'DATABASE_RUNTIME_UNVERIFIED'});assert.equal(x.queries.length,0);assert.equal(x.releases.length,1);assert.ok(x.releases[0] instanceof Error);
});
test('V117 already aborted probes never acquire a database connection',async()=>{
  let acquired=0;const controller=new AbortController();controller.abort();
  const p=createPostgresRuntimeProbe({pool:{connect:()=>{acquired++}},expectedRole:'legaltech_runtime'});
  assert.equal((await p({signal:controller.signal})).ok,false);assert.equal(acquired,0);
});
test('V117 runtime probe rejects malformed connection bindings',()=>{
  for(const options of [{},{pool:{connect(){}},expectedRole:'bad;role'},{pool:{connect(){}},expectedRole:'runtime',schema:'public; DROP SCHEMA public'}]) {
    assert.throws(()=>createPostgresRuntimeProbe(options),/CONFIGURATION_INVALID/);
  }
});
test('V117 SQL contract covers membership owners column grants forced RLS and audit trigger state',()=>{
  const sql=fs.readFileSync(new URL('../db/verification/runtime_security.sql',import.meta.url),'utf8');
  for(const code of ['RUNTIME_DIRECT_LOGIN_REQUIRED','RUNTIME_PRIVILEGED_ROLE_FORBIDDEN','RUNTIME_DATABASE_OWNERSHIP_FORBIDDEN','RUNTIME_SCHEMA_MUTATION_FORBIDDEN','RUNTIME_TABLE_OWNERSHIP_FORBIDDEN','RUNTIME_RLS_REQUIRED','RUNTIME_TRUNCATE_FORBIDDEN','RUNTIME_GRANT_MUTATION_FORBIDDEN','RUNTIME_AUDIT_TRIGGER_REQUIRED','RUNTIME_SECURITY_DEFINER_FORBIDDEN','RUNTIME_ALTERNATE_RELATION_FORBIDDEN'])assert.ok(sql.includes(code),code);
  assert.match(sql,/pg_has_role\(current_user,r\.oid,'MEMBER'\)/);assert.match(sql,/has_any_column_privilege/);
  assert.match(sql,/row_security_active/);assert.match(sql,/relforcerowsecurity/);assert.match(sql,/tgenabled IN \('O','A'\)/);
});
