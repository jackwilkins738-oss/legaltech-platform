BEGIN;

-- V110: bounded redacted support diagnostics. Durable evidence contains only
-- hashes plus bounded state/count metadata. Sensitive source values are excluded.
CREATE TABLE support_diagnostic_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  support_request_id uuid NOT NULL,
  actor_hash char(64) NOT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
  matter_hash char(64) NOT NULL CHECK (matter_hash ~ '^[a-f0-9]{64}$'),
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  release_state_hash char(64) NOT NULL CHECK (release_state_hash ~ '^[a-f0-9]{64}$'),
  dependency_count integer NOT NULL CHECK (dependency_count BETWEEN 0 AND 32),
  active_incident_count integer NOT NULL CHECK (active_incident_count BETWEEN 0 AND 1000000000),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  generated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,support_request_id) REFERENCES support_access_requests(tenant_id,id)
);
CREATE INDEX idx_support_diagnostic_evidence ON support_diagnostic_evidence(tenant_id,support_request_id,generated_at DESC);
ALTER TABLE support_diagnostic_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_diagnostic_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_support_diagnostic_read ON support_diagnostic_evidence FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_diagnostic_insert ON support_diagnostic_evidence FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE OR REPLACE FUNCTION deny_support_diagnostic_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'support diagnostic evidence is append-only'; END; $$;
CREATE TRIGGER support_diagnostic_evidence_append_only BEFORE UPDATE OR DELETE ON support_diagnostic_evidence FOR EACH ROW EXECUTE FUNCTION deny_support_diagnostic_mutation();

COMMIT;
