-- V93 incident response evidence and containment lifecycle.
-- Incident content is referenced by hashes only; client/legal content does not belong here.
CREATE TABLE IF NOT EXISTS security_incidents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  category text NOT NULL CHECK (category IN ('CREDENTIAL','MALWARE','DATA_EXFILTRATION','UNAUTHORIZED_ACCESS','AVAILABILITY','INTEGRITY','OTHER')),
  status text NOT NULL CHECK (status IN ('OPEN','CONTAINING','CONTAINED','RECOVERING','CLOSED')),
  reason_code text NOT NULL,
  opened_by text NOT NULL,
  opened_at timestamptz NOT NULL,
  contained_at timestamptz,
  recovering_at timestamptz,
  closed_at timestamptz,
  closed_by text,
  source_ref_hash text CHECK (source_ref_hash IS NULL OR source_ref_hash ~ '^[a-f0-9]{64}$'),
  root_cause_hash text CHECK (root_cause_hash IS NULL OR root_cause_hash ~ '^[a-f0-9]{64}$'),
  recovery_evidence_hash text CHECK (recovery_evidence_hash IS NULL OR recovery_evidence_hash ~ '^[a-f0-9]{64}$'),
  lessons_hash text CHECK (lessons_hash IS NULL OR lessons_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_security_incidents_tenant_status ON security_incidents(tenant_id,status,severity,opened_at);
ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_incidents_tenant_isolation ON security_incidents;
CREATE POLICY security_incidents_tenant_isolation ON security_incidents USING (tenant_id=current_setting('app.tenant_id',true));

CREATE TABLE IF NOT EXISTS security_incident_evidence (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  incident_id text NOT NULL REFERENCES security_incidents(id),
  evidence_type text NOT NULL CHECK (evidence_type IN ('SECURITY_ALERT','AUDIT','LOG','DOCUMENT_HASH','EXTERNAL_REFERENCE','FORENSIC_SNAPSHOT')),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  source_ref_hash text CHECK (source_ref_hash IS NULL OR source_ref_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  actor_id text NOT NULL,
  trace_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_incident_evidence_tenant_incident ON security_incident_evidence(tenant_id,incident_id,seq);
ALTER TABLE security_incident_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_incident_evidence_tenant_isolation ON security_incident_evidence;
CREATE POLICY security_incident_evidence_tenant_isolation ON security_incident_evidence USING (tenant_id=current_setting('app.tenant_id',true));

CREATE TABLE IF NOT EXISTS security_incident_events (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  incident_id text NOT NULL REFERENCES security_incidents(id),
  event_type text NOT NULL,
  actor_id text NOT NULL,
  trace_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  evidence_json jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_incident_events_tenant_incident ON security_incident_events(tenant_id,incident_id,seq);
ALTER TABLE security_incident_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_incident_events_tenant_isolation ON security_incident_events;
CREATE POLICY security_incident_events_tenant_isolation ON security_incident_events USING (tenant_id=current_setting('app.tenant_id',true));

CREATE OR REPLACE FUNCTION reject_security_incident_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'security incident evidence is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_security_incident_evidence_append_only ON security_incident_evidence;
CREATE TRIGGER trg_security_incident_evidence_append_only BEFORE UPDATE OR DELETE ON security_incident_evidence FOR EACH ROW EXECUTE FUNCTION reject_security_incident_evidence_mutation();
DROP TRIGGER IF EXISTS trg_security_incident_events_append_only ON security_incident_events;
CREATE TRIGGER trg_security_incident_events_append_only BEFORE UPDATE OR DELETE ON security_incident_events FOR EACH ROW EXECUTE FUNCTION reject_security_incident_evidence_mutation();
