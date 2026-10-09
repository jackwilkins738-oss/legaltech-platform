import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const migrationDir=path.join(here,'../db/migrations');
const all=fs.readdirSync(migrationDir).sort().map(f=>fs.readFileSync(path.join(migrationDir,f),'utf8')).join('\n');
const tenantTables=['actors','matters','external_mappings','inbound_events','exceptions','idempotency_records','audit_events','jobs','security_zones','actor_security_zones','matter_actor_access','matter_break_glass_grants','document_security','document_actor_access','security_alerts','recovery_evidence','work_items','work_dependencies','work_events','workflow_definitions','workflow_instances','workflow_events','feature_flags','notification_intents','notification_delivery_events','to_studies','to_observations','to_estimates','work_delegations','delegation_events','flow_snapshots','response_policies','escalation_intents','escalation_events'];

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
    security_alerts:/CREATE POLICY tenant_security_alert_read ON security_alerts/i,
    recovery_evidence:/CREATE POLICY tenant_recovery_evidence_read ON recovery_evidence/i,
    work_items:/CREATE POLICY tenant_and_matter_work_items ON work_items/i,
    work_dependencies:/CREATE POLICY tenant_work_dependencies ON work_dependencies/i,
    work_events:/CREATE POLICY tenant_work_events_read ON work_events/i,
    workflow_definitions:/CREATE POLICY tenant_workflow_definitions ON workflow_definitions/i,
    workflow_instances:/CREATE POLICY tenant_workflow_instances ON workflow_instances/i,
    workflow_events:/CREATE POLICY tenant_workflow_events_read ON workflow_events/i,
    feature_flags:/CREATE POLICY tenant_feature_flags ON feature_flags/i,
    notification_intents:/CREATE POLICY tenant_notification_intents ON notification_intents/i,
    notification_delivery_events:/CREATE POLICY tenant_notification_delivery_events_read ON notification_delivery_events/i,
    to_studies:/CREATE POLICY tenant_to_studies ON to_studies/i,
    to_observations:/CREATE POLICY tenant_to_observations ON to_observations/i,
    to_estimates:/CREATE POLICY tenant_to_estimates ON to_estimates/i,
    work_delegations:/CREATE POLICY tenant_work_delegations ON work_delegations/i,
    delegation_events:/CREATE POLICY tenant_delegation_events_read ON delegation_events/i,
    flow_snapshots:/CREATE POLICY tenant_flow_snapshots_read ON flow_snapshots/i,
    response_policies:/CREATE POLICY tenant_response_policies ON response_policies/i,
    escalation_intents:/CREATE POLICY tenant_escalation_intents ON escalation_intents/i,
    escalation_events:/CREATE POLICY tenant_escalation_events_read ON escalation_events/i,
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


test('audit ledger is server hash-chained and security alerts are append-only',()=>{
  assert.match(all,/CREATE TRIGGER audit_events_hash_chain\s+BEFORE INSERT ON audit_events/i);
  assert.match(all,/NEW\.previous_hash := COALESCE\(prior, repeat\('0',64\)\)/i);
  assert.match(all,/digest\(material,'sha256'\)/i);
  assert.match(all,/CREATE TABLE IF NOT EXISTS security_alerts/i);
  assert.match(all,/CREATE TRIGGER security_alerts_append_only\s+BEFORE UPDATE OR DELETE ON security_alerts/i);
});


test('V63 recovery migration is tenant-bound append-only and dual-control aware',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'008_recovery_resilience.sql'),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS recovery_evidence/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.match(sql,/actor_id <> approver_id/);
  assert.match(sql,/recovery evidence is append-only/);
  assert.match(sql,/chain_recovery_evidence/);
  assert.match(sql,/manifest_hash.*\^\[a-f0-9\]\{64\}/s);
});


test('V64 work orchestration is tenant-bound matter-aware and auditable',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'009_work_orchestration.sql'),'utf8');
  assert.match(sql,/CREATE TABLE work_items/);
  assert.match(sql,/CREATE TABLE work_dependencies/);
  assert.match(sql,/CREATE TABLE work_events/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,matter_id\) REFERENCES matters\(tenant_id,id\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,work_id\) REFERENCES work_items\(tenant_id,id\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,depends_on_work_id\) REFERENCES work_items\(tenant_id,id\)/);
  assert.match(sql,/owner_kind text NOT NULL CHECK \(owner_kind IN \('USER','ROLE','TEAM','POOL'\)\)/);
  assert.match(sql,/work_events are append-only/);
  assert.match(sql,/CREATE POLICY tenant_and_matter_work_items/);
});


test('V65 workflow runtime pins definitions and keeps external notification delivery out of process',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'010_workflow_runtime.sql'),'utf8');
  assert.match(sql,/UNIQUE \(tenant_id,workflow_key,version\)/);
  assert.match(sql,/definition_hash text NOT NULL CHECK/);
  assert.match(sql,/published workflow definition is immutable/);
  assert.match(sql,/workflow_events are append-only/);
  assert.match(sql,/channel text NOT NULL CHECK \(channel IN \('IN_APP','TEAMS'\)\)/);
  assert.doesNotMatch(sql,/access_token|client_secret|sendMail|chatMessage/i);
});


test('V66 TO evidence is anonymised tenant-bound append-only and annualisation-ready',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'011_to_evidence.sql'),'utf8');
  assert.match(sql,/participant_alias text NOT NULL CHECK \(participant_alias ~ '\^P-/);
  assert.match(sql,/matter_alias text CHECK \(matter_alias IS NULL OR matter_alias ~ '\^MAT-/);
  assert.match(sql,/timing_basis text NOT NULL CHECK \(timing_basis IN \('MEASURED','ESTIMATED'\)\)/);
  assert.match(sql,/wait_type text NOT NULL CHECK \(wait_type IN \('NONE','INTERNAL','EXTERNAL'\)\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,study_id\) REFERENCES to_studies\(tenant_id,id\)/);
  assert.match(sql,/TO observations are append-only/);
  assert.match(sql,/TO estimates are append-only/);
  assert.match(sql,/locked TO study is immutable/);
  assert.match(sql,/FREQUENCY_PER_PERSON_DAY/);
  assert.match(sql,/WORKFLOW_LOG/);
  assert.match(sql,/ROSTER/);
});


test('V67 delegation and flow intelligence are tenant-bound and append-only where evidential',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'012_work_flow_intelligence.sql'),'utf8');
  assert.match(sql,/principal_kind text NOT NULL CHECK \(principal_kind IN \('USER','ROLE','TEAM','POOL'\)\)/);
  assert.match(sql,/delegate_kind text NOT NULL CHECK \(delegate_kind IN \('USER','ROLE','TEAM','POOL'\)\)/);
  assert.match(sql,/ends_at <= starts_at \+ interval '90 days'/);
  assert.match(sql,/work delegation transition invalid/);
  assert.match(sql,/delegation events are append-only/);
  assert.match(sql,/flow snapshots are append-only/);
  assert.match(sql,/CREATE POLICY tenant_flow_snapshots_read/);
  assert.doesNotMatch(sql,/case_manager|legal_admin|team_leader/i);
});


test('V68 response policies create auditable escalation intents without automatic reassignment',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'013_work_response_escalation.sql'),'utf8');
  assert.match(sql,/action text NOT NULL CHECK \(action IN \('NOTIFY_OWNER','CREATE_ESCALATION'\)\)/);
  assert.match(sql,/UNIQUE \(tenant_id,dedupe_key\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,source_work_id\) REFERENCES work_items\(tenant_id,id\)/);
  assert.match(sql,/response policy transition invalid/);
  assert.match(sql,/escalation intent transition invalid/);
  assert.match(sql,/escalation events are append-only/);
  assert.doesNotMatch(sql,/AUTO_REASSIGN|UPDATE work_items SET owner/i);
});


test('V71 organisation directory is tenant-bound time-aware and evidential',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'014_organization_directory.sql'),'utf8');
  assert.match(sql,/group_kind text NOT NULL CHECK \(group_kind IN \('TEAM','POOL'\)\)/);
  assert.match(sql,/UNIQUE \(tenant_id,group_kind,group_ref\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,group_kind,group_ref\) REFERENCES org_groups\(tenant_id,group_kind,group_ref\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,actor_id\) REFERENCES actors\(tenant_id,id\)/);
  assert.match(sql,/organisation membership overlap/);
  assert.match(sql,/organisation membership transition invalid/);
  assert.match(sql,/organisation directory events are append-only/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql,/legal_admin|case_manager|team_leader|solicitor/i);
});



test('V73 notification delivery evidence is tenant-bound append-only and content-free',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'015_notification_delivery.sql'),'utf8');
  assert.match(sql,/CREATE TABLE notification_delivery_events/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,notification_intent_id\) REFERENCES notification_intents\(tenant_id,id\)/);
  assert.match(sql,/delivery_ref_hash text CHECK \(delivery_ref_hash IS NULL OR delivery_ref_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sql,/notification delivery events are append-only/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql,/message_body|document_text|client_name|access_token|refresh_token|client_secret|credential_value/i);
});

test('V74 work queue read model has bounded owner state type and matter indexes',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'016_work_queue_read_model.sql'),'utf8');
  assert.match(sql,/idx_work_queue_user[\s\S]*tenant_id,owner_kind,owner_actor_id,state,priority DESC,due_at,created_at,id/i);
  assert.match(sql,/idx_work_queue_group[\s\S]*tenant_id,owner_kind,owner_ref,state,priority DESC,due_at,created_at,id/i);
  assert.match(sql,/idx_work_queue_type_state[\s\S]*tenant_id,state,work_type,priority DESC,due_at,created_at,id/i);
  assert.match(sql,/idx_work_queue_matter_order[\s\S]*tenant_id,matter_id,state,priority DESC,due_at,created_at,id/i);
  assert.doesNotMatch(sql,/legal_admin|case_manager|team_leader|solicitor/i);
});


test('V79 data lifecycle is tenant-bound hold-aware dual-control and non-executing',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'017_data_lifecycle.sql'),'utf8');
  assert.match(sql,/CREATE TABLE data_lifecycle_policies/);
  assert.match(sql,/retention_days integer NOT NULL CHECK \(retention_days BETWEEN 1 AND 36500\)/);
  assert.match(sql,/CREATE TABLE legal_holds/);
  assert.match(sql,/scope_kind text NOT NULL CHECK \(scope_kind IN \('RESOURCE','MATTER'\)\)/);
  assert.match(sql,/CREATE TABLE disposition_intents/);
  assert.match(sql,/approved_by IS NULL OR approved_by <> requested_by/);
  assert.match(sql,/data lifecycle events are append-only/);
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql,/DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN/i);
});

test('V81 controlled export storage is tenant-bound, immutable and single-use',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'018_controlled_export.sql'),'utf8');
  for(const table of ['controlled_exports','controlled_export_resources','controlled_export_download_grants','controlled_export_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(sql,/resource_count BETWEEN 1 AND 5000/);
  assert.match(sql,/package_bytes BETWEEN 1 AND 262144000/);
  assert.match(sql,/expires_at <= issued_at \+ interval '15 minutes'/);
  assert.match(sql,/UNIQUE \(tenant_id,token_hash\)/);
  assert.match(sql,/controlled export resources are immutable/);
  assert.match(sql,/controlled export events are append-only/);
  assert.match(sql,/OLD\.status='ACTIVE' AND NEW\.status IN \('CONSUMED','REVOKED'\)/);
  assert.doesNotMatch(sql,/public_url|destination_url|email_address/i);
});

test('V82 security interlocks are tenant-bound evidential and dual-control released',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'019_security_interlocks.sql'),'utf8');
  assert.match(sql,/UNIQUE INDEX uq_security_interlock_active ON security_interlocks\(tenant_id,control\) WHERE status='ACTIVE'/);
  assert.match(sql,/released_by <> activated_by/);
  assert.match(sql,/OLD\.status='ACTIVE' AND NEW\.status='RELEASED'/);
  assert.match(sql,/security interlocks are evidential/);
  assert.match(sql,/security interlock events are append-only/);
  for(const table of ['security_interlocks','security_interlock_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});


test('V83 production change approval is tenant-bound hash-bound and dual-control',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'020_production_change_control.sql'),'utf8');
  assert.match(sql,/approved_by <> requested_by/);
  assert.match(sql,/target_hash char\(64\)/);
  assert.match(sql,/OLD\.status='APPROVED' AND NEW\.status='CONSUMED'/);
  assert.match(sql,/production change target identity immutable/);
  assert.match(sql,/production change requests are evidential/);
  assert.match(sql,/production change events are append-only/);
  assert.match(sql,/expires_at <= requested_at \+ interval '7 days'/);
  for(const table of ['production_change_requests','production_change_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});


test('V84 worker execution evidence is tenant-bound exact-targeted and immutable',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'021_worker_execution_identity.sql'),'utf8');
  assert.match(sql,/UNIQUE \(tenant_id,grant_fingerprint\)/);
  assert.match(sql,/object_type text NOT NULL CHECK \(object_type IN \('JOB','NOTIFICATION'\)\)/);
  assert.match(sql,/worker execution consumption is immutable/);
  assert.match(sql,/worker execution events are append-only/);
  assert.match(sql,/grant_fingerprint char\(64\)/);
  assert.doesNotMatch(sql,/raw_token|access_token|refresh_token|private_key|client_secret/i);
  for(const table of ['worker_execution_grant_consumptions','worker_execution_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});

test('V85 audit integrity checkpoints are tenant-bound append-only external-anchor evidence',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'022_audit_checkpoint_anchor.sql'),'utf8');
  assert.match(sql,/audit_event_count bigint NOT NULL CHECK \(audit_event_count > 0\)/);
  assert.match(sql,/head_hash char\(64\)/);
  assert.match(sql,/checkpoint_hash char\(64\)/);
  assert.match(sql,/anchor_ref_hash char\(64\)/);
  assert.match(sql,/FOREIGN KEY \(tenant_id,created_by\) REFERENCES actors\(tenant_id,id\)/);
  assert.match(sql,/audit integrity checkpoints are append-only/);
  assert.match(sql,/ALTER TABLE audit_integrity_checkpoints FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql,/anchor_ref text|raw_anchor|audit_body|document_text/i);
});

test('V86 document delivery evidence is tenant/matter/actor bound single-use and storage-ref free',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'023_document_delivery.sql'),'utf8');
  assert.match(sql,/document_ref_hash char\(64\)/);assert.match(sql,/document_binding_hash char\(64\)/);assert.match(sql,/token_hash char\(64\)/);
  assert.match(sql,/UNIQUE \(tenant_id,grant_id\)/);assert.match(sql,/expires_at <= issued_at \+ interval '5 minutes'/);
  assert.match(sql,/document delivery grants are immutable/);assert.match(sql,/document delivery consumptions are immutable/);assert.match(sql,/document delivery events are append-only/);
  assert.doesNotMatch(sql,/object_ref|storage_ref|public_url|access_token|raw_token/i);
  for(const table of ['document_delivery_grants','document_delivery_consumptions','document_delivery_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});

test('V87 key lifecycle stores metadata only and enforces monotonic safe transitions',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'024_key_lifecycle.sql'),'utf8');
  assert.match(sql,/provider_key_fingerprint char\(64\)/);assert.match(sql,/generation integer NOT NULL CHECK \(generation > 0\)/);
  assert.match(sql,/WHERE status='ACTIVE'/);assert.match(sql,/OLD.status='ACTIVE' AND NEW.status='DECRYPT_ONLY'/);assert.match(sql,/OLD.status='DECRYPT_ONLY' AND NEW.status='RETIRED'/);
  assert.match(sql,/encryption key generation identity immutable/);assert.match(sql,/encryption key events are append-only/);
  assert.doesNotMatch(sql,/key_material|plaintext_key|wrapped_key|private_key|client_secret/i);
  for(const table of ['encryption_key_generations','encryption_key_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});test('V88 support access is exact-resource short-lived dual-control and append-only',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'025_jit_support_access.sql'),'utf8');
  assert.match(sql,/scope IN \('MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ'\)/);
  assert.match(sql,/expires_at <= created_at \+ interval '15 minutes'/);
  assert.match(sql,/requester_id=NEW\.approver_id/);
  assert.match(sql,/support access dual control required/);
  assert.match(sql,/support access evidence is append-only/);
  assert.match(sql,/ticket_ref_hash char\(64\)/);assert.match(sql,/purpose_hash char\(64\)/);assert.match(sql,/document_ref_hash char\(64\)/);
  assert.doesNotMatch(sql,/ticket_ref text|purpose text|document_ref text|bearer|access_token|client_secret/i);
  for(const table of ['support_access_requests','support_access_approvals','support_access_revocations','support_access_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});test('V89 Graph webhook evidence is tenant-bound replay-safe append-only and payload-free',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'026_graph_webhook_ingress.sql'),'utf8');
  assert.match(sql,/UNIQUE \(tenant_id,notification_fingerprint\)/);
  assert.match(sql,/subscription_ref_hash char\(64\)/);assert.match(sql,/payload_hash char\(64\)/);
  assert.match(sql,/graph webhook evidence is append-only/);
  assert.doesNotMatch(sql,/client_state|validation_token|resource_data|raw_payload|notification_body/i);
  for(const table of ['graph_webhook_notification_fingerprints','graph_webhook_validation_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});

test('V90 Graph subscription registry is server-owned secret-referenced and lifecycle-safe',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'027_graph_subscription_lifecycle.sql'),'utf8');
  assert.match(sql,/client_state_secret_ref text NOT NULL/);assert.match(sql,/client_state_hash char\(64\)/);assert.match(sql,/resource_hash char\(64\)/);
  assert.match(sql,/status IN \('ACTIVE','REAUTH_REQUIRED','RECOVERY_REQUIRED','REMOVED','DELETED','EXPIRED'\)/);
  assert.match(sql,/WHERE status IN \('ACTIVE','REAUTH_REQUIRED','RECOVERY_REQUIRED'\)/);assert.match(sql,/graph subscription generation must increase/);
  assert.match(sql,/graph subscription lifecycle evidence is append-only/);assert.match(sql,/graph subscription identity is immutable/);
  assert.doesNotMatch(sql,/client_state text|raw_resource|resource_path text|validation_token|access_token|client_secret/i);
  for(const table of ['graph_subscription_registry','graph_subscription_lifecycle_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});


test('V92 Graph delta checkpoints are opaque append-only tenant-bound recovery evidence',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'028_graph_delta_recovery.sql'),'utf8');
  assert.match(sql,/delta_link_secret_ref text NOT NULL/);assert.match(sql,/delta_link_hash char\(64\)/);assert.match(sql,/resource_hash char\(64\)/);
  assert.match(sql,/PRIMARY KEY \(tenant_id,resource_hash,generation\)/);assert.match(sql,/graph delta checkpoints are append-only/);assert.match(sql,/graph delta recovery evidence is append-only/);
  assert.match(sql,/event_type text NOT NULL CHECK \(event_type IN \('STARTED','PAGE','PAGE_LIMIT','RETRY_REQUIRED','DELTA_COMPLETE','CHECKPOINTED','COMPLETED','FAILED'\)\)/);
  assert.doesNotMatch(sql,/delta_link text|next_link|raw_payload|message_body|message_subject|access_token|refresh_token|client_secret/i);
  for(const table of ['graph_delta_checkpoints','graph_delta_recovery_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
});


test('V93 incident response evidence is tenant-bound hash-only append-only and containment-linked',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'029_incident_response.sql'),'utf8');
  assert.match(sql,/status text NOT NULL CHECK \(status IN \('OPEN','CONTAINING','CONTAINED','RECOVERING','CLOSED'\)\)/);
  assert.match(sql,/evidence_hash text NOT NULL CHECK \(evidence_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/);
  assert.match(sql,/security incident evidence is append-only/);
  assert.match(sql,/source_ref_hash/);assert.match(sql,/recovery_evidence_hash/);assert.match(sql,/root_cause_hash/);assert.match(sql,/lessons_hash/);
  assert.doesNotMatch(sql,/raw_log|raw_payload|client_name|document_text|email_body|access_token|client_secret/i);
  for(const table of ['security_incidents','security_incident_evidence','security_incident_events']) assert.match(sql,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
});


test('V94 tenant configuration bundles are versioned immutable and activation history is append-only',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'030_tenant_configuration_rollout.sql'),'utf8');
  assert.match(sql,/UNIQUE \(tenant_id,bundle_key,version\)/);assert.match(sql,/bundle_hash char\(64\)/);
  assert.match(sql,/tenant configuration bundle identity immutable/);assert.match(sql,/tenant configuration activations are append-only/);
  assert.match(sql,/action text NOT NULL CHECK \(action IN \('ACTIVATE','ROLLBACK'\)\)/);
  assert.doesNotMatch(sql,/client_secret|access_token|refresh_token|private_key|credential_value/i);
  for(const table of ['tenant_configuration_bundles','tenant_configuration_activations']) assert.match(sql,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
});


test('V96 tenant configuration certification is exact hash-bound synthetic evidence and append-only',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'031_tenant_config_validation.sql'),'utf8');
  assert.match(sql,/bundle_hash char\(64\)/);assert.match(sql,/scenario_suite_hash char\(64\)/);assert.match(sql,/evidence_hash char\(64\)/);
  assert.match(sql,/failed integer NOT NULL CHECK \(failed = 0\)/);assert.match(sql,/CHECK \(passed = total\)/);
  assert.match(sql,/tenant configuration certifications are append-only/);assert.match(sql,/ALTER TABLE tenant_configuration_certifications ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql,/scenario_payload|client_name|document_text|email_body|access_token|client_secret/i);
});


test('V97 supply chain evidence is digest-only append-only and signature-material free',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'032_supply_chain_attestation.sql'),'utf8');
  for(const col of ['artifact_sha256','sbom_sha256','provenance_sha256','builder_ref_hash','attestation_ref_hash','statement_hash']) assert.match(sql,new RegExp(`${col} char\\(64\\)`));
  assert.match(sql,/source_revision char\(40\)/);assert.match(sql,/status text NOT NULL CHECK \(status='VERIFIED'\)/);assert.match(sql,/release supply chain evidence is append-only/);
  assert.doesNotMatch(sql,/signature_envelope|private_key|client_secret|access_token|builder_token/i);
});


test('V98 vulnerability and VEX evidence are append-only hash metadata only',()=>{
  const sql=fs.readFileSync(path.join(migrationDir,'033_vulnerability_evidence.sql'),'utf8');
  for(const col of ['sbom_sha256','scanner_id_hash','scanner_version_hash','scan_ref_hash','findings_hash','vulnerability_id_hash','component_ref_hash','vex_ref_hash','reviewer_ref_hash','statement_hash']) assert.match(sql,new RegExp(`${col} char\\(64\\)`));
  assert.match(sql,/release vulnerability scan evidence is append-only/);
  assert.match(sql,/release VEX evidence is append-only/);
  assert.doesNotMatch(sql,/signature_envelope|advisory_text|finding_payload|access_token|client_secret|private_key/i);
});


test('V99 dead-letter recovery is tenant-bound exact-target and append-only evidential',()=>{const sql=fs.readFileSync(path.join(migrationDir,'034_dead_letter_recovery.sql'),'utf8');assert.match(sql,/FOREIGN KEY \(tenant_id,job_id\) REFERENCES jobs\(tenant_id,id\)/);assert.match(sql,/job_snapshot_hash char\(64\)/);assert.match(sql,/attempts_at_request integer NOT NULL/);assert.match(sql,/dead letter recovery identity immutable/);assert.match(sql,/dead letter recovery events are append-only/);assert.match(sql,/approved_by IS NULL OR approved_by<>requested_by/);assert.doesNotMatch(sql,/payload jsonb|payload_json|reset_attempts/i);});
