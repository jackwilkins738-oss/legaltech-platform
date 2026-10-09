BEGIN;
-- V99 exact-target dead-letter recovery. Recovery never edits job identity/payload or resets attempts.
ALTER TABLE jobs ADD CONSTRAINT jobs_tenant_job_unique UNIQUE (tenant_id,id);

CREATE TABLE dead_letter_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_id uuid NOT NULL,
  job_type text NOT NULL,
  job_snapshot_hash char(64) NOT NULL CHECK (job_snapshot_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  attempts_at_request integer NOT NULL CHECK (attempts_at_request >= 0),
  high_risk boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPROVED','EXECUTED','CANCELLED')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  executed_by uuid,
  executed_at timestamptz,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,job_id) REFERENCES jobs(tenant_id,id),
  FOREIGN KEY (tenant_id,requested_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,approved_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,executed_by) REFERENCES actors(tenant_id,id),
  CHECK (approved_by IS NULL OR approved_by<>requested_by),
  CHECK ((high_risk AND status='PENDING_APPROVAL' AND approved_by IS NULL AND executed_by IS NULL) OR
         (high_risk AND status='APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND executed_by IS NULL) OR
         (high_risk AND status='EXECUTED' AND approved_by IS NOT NULL AND executed_by IS NOT NULL AND executed_at IS NOT NULL) OR
         (NOT high_risk AND status='APPROVED' AND approved_by IS NULL AND executed_by IS NULL) OR
         (NOT high_risk AND status='EXECUTED' AND executed_by IS NOT NULL AND executed_at IS NOT NULL) OR
         status='CANCELLED')
);
CREATE UNIQUE INDEX dead_letter_one_open_recovery ON dead_letter_recoveries(tenant_id,job_id) WHERE status IN ('PENDING_APPROVAL','APPROVED');
CREATE INDEX dead_letter_recovery_queue ON dead_letter_recoveries(tenant_id,status,requested_at);

CREATE TABLE dead_letter_recovery_events (
  seq bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  recovery_id uuid NOT NULL,
  job_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('RECOVERY_REQUESTED','RECOVERY_APPROVED','RECOVERY_EXECUTED','RECOVERY_CANCELLED','RECOVERY_CONFLICT')),
  actor_ref_hash char(64) NOT NULL CHECK (actor_ref_hash ~ '^[a-f0-9]{64}$'),
  trace_hash char(64) NOT NULL CHECK (trace_hash ~ '^[a-f0-9]{64}$'),
  event_hash char(64) NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,recovery_id) REFERENCES dead_letter_recoveries(tenant_id,id),
  FOREIGN KEY (tenant_id,job_id) REFERENCES jobs(tenant_id,id)
);
CREATE INDEX dead_letter_recovery_events_lookup ON dead_letter_recovery_events(tenant_id,recovery_id,seq);

ALTER TABLE dead_letter_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_recoveries FORCE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dead_letter_recovery_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_dead_letter_recoveries ON dead_letter_recoveries USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_dead_letter_recovery_events_read ON dead_letter_recovery_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_dead_letter_recovery_events_insert ON dead_letter_recovery_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_dead_letter_recovery_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.job_type IS DISTINCT FROM OLD.job_type OR NEW.job_snapshot_hash IS DISTINCT FROM OLD.job_snapshot_hash OR NEW.evidence_hash IS DISTINCT FROM OLD.evidence_hash OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.attempts_at_request IS DISTINCT FROM OLD.attempts_at_request OR NEW.high_risk IS DISTINCT FROM OLD.high_risk OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN RAISE EXCEPTION 'dead letter recovery identity immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER dead_letter_recovery_identity_guard BEFORE UPDATE ON dead_letter_recoveries FOR EACH ROW EXECUTE FUNCTION protect_dead_letter_recovery_identity();
CREATE OR REPLACE FUNCTION deny_dead_letter_recovery_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'dead letter recoveries are evidential'; END; $$;
CREATE TRIGGER dead_letter_recovery_no_delete BEFORE DELETE ON dead_letter_recoveries FOR EACH ROW EXECUTE FUNCTION deny_dead_letter_recovery_delete();
CREATE OR REPLACE FUNCTION deny_dead_letter_recovery_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'dead letter recovery events are append-only'; END; $$;
CREATE TRIGGER dead_letter_recovery_events_append_only BEFORE UPDATE OR DELETE ON dead_letter_recovery_events FOR EACH ROW EXECUTE FUNCTION deny_dead_letter_recovery_event_mutation();
COMMIT;
