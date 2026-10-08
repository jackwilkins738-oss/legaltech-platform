import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const migrationDir=path.join(here,'../db/migrations');
const all=fs.readdirSync(migrationDir).sort().map(f=>fs.readFileSync(path.join(migrationDir,f),'utf8')).join('\n');
const tenantTables=['actors','matters','external_mappings','inbound_events','exceptions','idempotency_records','audit_events','jobs','security_zones','actor_security_zones','matter_actor_access','matter_break_glass_grants','document_security','document_actor_access'];

test('all tenant-scoped tables define tenant_id NOT NULL',()=>{
  for (const table of tenantTables) {
    const create=new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table} \\(([\\s\\S]*?)\\n\\);`,'i').exec(all);
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

test('every tenant table has an RLS policy after hardening',()=>{
  const policyPatterns={
    actors:/CREATE POLICY tenant_isolation_actors ON actors/i,
    matters:/CREATE POLICY tenant_and_effective_access_matters ON matters/i,
    external_mappings:/CREATE POLICY tenant_and_matter_isolation_external_mappings ON external_mappings/i,
    inbound_events:/CREATE POLICY tenant_isolation_inbound_events ON inbound_events/i,
    exceptions:/CREATE POLICY tenant_and_matter_isolation_exceptions ON exceptions/i,
    idempotency_records:/CREATE POLICY tenant_isolation_idempotency ON idempotency_records/i,
    audit_events:/CREATE POLICY tenant_and_matter_isolation_audit ON audit_events/i,
    jobs:/CREATE POLICY tenant_isolation_jobs ON jobs/i,
    security_zones:/CREATE POLICY tenant_isolation_security_zones ON security_zones/i,
    actor_security_zones:/CREATE POLICY actor_security_zones_self_read ON actor_security_zones/i,
    matter_actor_access:/CREATE POLICY matter_actor_access_self_read ON matter_actor_access/i,
    matter_break_glass_grants:/CREATE POLICY break_glass_self_read ON matter_break_glass_grants/i,
    document_security:/CREATE POLICY document_security_effective_read ON document_security/i,
    document_actor_access:/CREATE POLICY document_actor_access_self_read ON document_actor_access/i,
  };
  for (const table of tenantTables) assert.match(all,policyPatterns[table],`${table} lacks hardened policy`);
});

test('idempotency is unique within tenant/scope',()=>{
  assert.match(all,/UNIQUE \(tenant_id, scope, idempotency_key\)/i);
});

test('tenant-owned foreign keys are composite and cannot cross tenants',()=>{
  for (const pattern of [
    /FOREIGN KEY \(tenant_id, matter_id\) REFERENCES matters\(tenant_id, id\)/i,
    /FOREIGN KEY \(tenant_id, source_event_id\) REFERENCES inbound_events\(tenant_id, id\)/i,
    /FOREIGN KEY \(tenant_id, assigned_actor_id\) REFERENCES actors\(tenant_id, id\)/i,
    /FOREIGN KEY \(tenant_id, security_zone_id\) REFERENCES security_zones\(tenant_id, id\)/i,
    /FOREIGN KEY \(tenant_id, actor_id\) REFERENCES actors\(tenant_id, id\)/i,
    /FOREIGN KEY \(tenant_id, document_ref\) REFERENCES document_security\(tenant_id, document_ref\)/i,
  ]) assert.match(all,pattern);
});

test('restricted matters require membership and security-zone evidence at RLS boundary',()=>{
  assert.match(all,/CREATE OR REPLACE FUNCTION app_current_actor_id\(\)/i);
  assert.match(all,/CREATE TABLE matter_actor_access/i);
  assert.match(all,/CREATE POLICY tenant_and_effective_access_matters ON matters/i);
  assert.match(all,/matters\.visibility = 'STANDARD'[\s\S]*matter_actor_access ma[\s\S]*ma\.actor_id = app_current_actor_id\(\)/i);
  assert.match(all,/actor_security_zones az[\s\S]*az\.actor_id = app_current_actor_id\(\)[\s\S]*az\.security_zone_id = matters\.security_zone_id/i);
});

test('break-glass is explicit short lived step-up evidence, never capability-only',()=>{
  assert.match(all,/CREATE TABLE matter_break_glass_grants/i);
  assert.match(all,/step_up_verified boolean NOT NULL CHECK \(step_up_verified = true\)/i);
  assert.match(all,/expires_at <= issued_at \+ interval '15 minutes'/i);
  assert.match(all,/revoked_at IS NULL[\s\S]*expires_at > now\(\)/i);
});

test('documents can be more restricted than their parent matter',()=>{
  assert.match(all,/CREATE TABLE document_security/i);
  assert.match(all,/mode text NOT NULL DEFAULT 'INHERIT' CHECK \(mode IN \('INHERIT','RESTRICTED','PRIVILEGED','SECURITY_ZONE'\)\)/i);
  assert.match(all,/CREATE TABLE document_actor_access/i);
  assert.match(all,/CREATE POLICY document_security_effective_read ON document_security/i);
});

test('runtime membership and break-glass tables are read-only under RLS policies',()=>{
  assert.doesNotMatch(all,/CREATE POLICY [^\n]+ ON matter_actor_access\s+FOR (?:INSERT|UPDATE|DELETE|ALL)/i);
  assert.doesNotMatch(all,/CREATE POLICY [^\n]+ ON matter_break_glass_grants\s+FOR (?:INSERT|UPDATE|DELETE|ALL)/i);
  assert.doesNotMatch(all,/CREATE POLICY [^\n]+ ON actor_security_zones\s+FOR (?:INSERT|UPDATE|DELETE|ALL)/i);
});

test('audit ledger is insert/select oriented and database append-only',()=>{
  assert.match(all,/CREATE POLICY tenant_insert_audit ON audit_events\s+FOR INSERT/i);
  assert.match(all,/CREATE TRIGGER audit_events_append_only\s+BEFORE UPDATE OR DELETE ON audit_events/i);
  assert.match(all,/RAISE EXCEPTION 'audit_events are append-only'/i);
});
