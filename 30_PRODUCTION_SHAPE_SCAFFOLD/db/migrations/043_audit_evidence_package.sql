BEGIN;
-- V112: bounded audit evidence package manifests. No audit payload is persisted here.
CREATE TABLE audit_evidence_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  from_position bigint NOT NULL CHECK (from_position >= 1),
  to_position bigint NOT NULL CHECK (to_position >= from_position),
  entry_count integer NOT NULL CHECK (entry_count BETWEEN 1 AND 5000),
  first_previous_hash char(64) NOT NULL CHECK (first_previous_hash ~ '^[a-f0-9]{64}$'),
  last_hash char(64) NOT NULL CHECK (last_hash ~ '^[a-f0-9]{64}$'),
  checkpoint_hash char(64) NOT NULL CHECK (checkpoint_hash ~ '^[a-f0-9]{64}$'),
  actor_hash char(64) NOT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
  trace_hash char(64) NOT NULL CHECK (trace_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,manifest_hash),
  CHECK (entry_count = to_position-from_position+1)
);
ALTER TABLE audit_evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_evidence_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_audit_package_read ON audit_evidence_packages FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_audit_package_insert ON audit_evidence_packages FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE OR REPLACE FUNCTION deny_audit_package_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit evidence package is append-only'; END; $$;
CREATE TRIGGER audit_package_append_only BEFORE UPDATE OR DELETE ON audit_evidence_packages FOR EACH ROW EXECUTE FUNCTION deny_audit_package_mutation();
COMMIT;
