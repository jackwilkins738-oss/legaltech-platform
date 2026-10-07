import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const migrationDir=path.join(here,'../db/migrations');
const all=fs.readdirSync(migrationDir).sort().map(f=>fs.readFileSync(path.join(migrationDir,f),'utf8')).join('\n');
const tenantTables=['actors','matters','external_mappings','inbound_events','exceptions','idempotency_records','audit_events','jobs','security_zones','actor_security_zones'];

test('all tenant-scoped tables define tenant_id NOT NULL',()=>{
  for (const table of tenantTables) {
    const create=new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`,'i').exec(all);
    assert.ok(create,`missing table ${table}`);
    assert.match(create[1],/tenant_id uuid NOT NULL/i,`${table} tenant_id must be NOT NULL`);
  }
});

test('all tenant tables enable and force RLS',()=>{
  for (const table of tenantTables) {
    assert.match(all,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`,'i'));
    assert.match(all,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`,'i'));
  }
});

test('every tenant table has tenant isolation policy',()=>{
  for (const table of tenantTables) {
    const policyNames={
      actors:'tenant_isolation_actors', matters:'tenant_isolation_matters', external_mappings:'tenant_isolation_external_mappings',
      inbound_events:'tenant_isolation_inbound_events', exceptions:'tenant_isolation_exceptions', idempotency_records:'tenant_isolation_idempotency',
      audit_events:'tenant_isolation_audit', jobs:'tenant_isolation_jobs', security_zones:'tenant_isolation_security_zones',
      actor_security_zones:'tenant_isolation_actor_security_zones'
    };
    assert.match(all,new RegExp(`CREATE POLICY ${policyNames[table]} ON ${table}`,'i'));
  }
});

test('idempotency is unique within tenant/scope',()=>{
  assert.match(all,/UNIQUE \(tenant_id, scope, idempotency_key\)/i);
});
