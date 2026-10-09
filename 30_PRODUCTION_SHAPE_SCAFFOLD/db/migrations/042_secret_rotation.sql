BEGIN;

-- V111: managed-secret lifecycle evidence. Only fingerprints and evidence hashes
-- are persisted; secret values and raw managed-secret references are excluded.
CREATE TABLE secret_rotation_generations (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  purpose text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 256),
  secret_ref_fingerprint char(64) NOT NULL CHECK (secret_ref_fingerprint ~ '^[a-f0-9]{64}$'),
  generation integer NOT NULL CHECK (generation >= 1),
  state text NOT NULL CHECK (state IN ('STAGED','ACTIVE','RETIRING','REVOKED','CANCELLED')),
  validation_evidence_hash char(64) NOT NULL CHECK (validation_evidence_hash ~ '^[a-f0-9]{64}$'),
  staged_by_hash char(64) NOT NULL CHECK (staged_by_hash ~ '^[a-f0-9]{64}$'),
  staged_at timestamptz NOT NULL,
  activated_by_hash char(64),
  activated_at timestamptz,
  activation_evidence_hash char(64),
  revoked_by_hash char(64),
  revoked_at timestamptz,
  revocation_evidence_hash char(64),
  PRIMARY KEY (tenant_id,purpose,secret_ref_fingerprint,generation),
  CHECK ((state IN ('ACTIVE','RETIRING','REVOKED')) = (activation_evidence_hash IS NOT NULL)),
  CHECK ((state='REVOKED') = (revocation_evidence_hash IS NOT NULL)),
  CHECK (activated_by_hash IS NULL OR activated_by_hash ~ '^[a-f0-9]{64}$'),
  CHECK (activation_evidence_hash IS NULL OR activation_evidence_hash ~ '^[a-f0-9]{64}$'),
  CHECK (revoked_by_hash IS NULL OR revoked_by_hash ~ '^[a-f0-9]{64}$'),
  CHECK (revocation_evidence_hash IS NULL OR revocation_evidence_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX one_active_secret_generation ON secret_rotation_generations(tenant_id,purpose,secret_ref_fingerprint) WHERE state='ACTIVE';
CREATE TABLE secret_rotation_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  purpose_hash char(64) NOT NULL CHECK (purpose_hash ~ '^[a-f0-9]{64}$'),
  secret_ref_fingerprint char(64) NOT NULL CHECK (secret_ref_fingerprint ~ '^[a-f0-9]{64}$'),
  generation integer NOT NULL CHECK (generation >= 1),
  event_type text NOT NULL CHECK (event_type IN ('STAGED','ACTIVATED','REVOKED','CANCELLED')),
  actor_hash char(64) NOT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE secret_rotation_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret_rotation_generations FORCE ROW LEVEL SECURITY;
ALTER TABLE secret_rotation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret_rotation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_secret_rotation_read ON secret_rotation_generations FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_secret_rotation_insert ON secret_rotation_generations FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_secret_rotation_update ON secret_rotation_generations FOR UPDATE USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_secret_rotation_event_read ON secret_rotation_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_secret_rotation_event_insert ON secret_rotation_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE OR REPLACE FUNCTION enforce_secret_rotation_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id<>OLD.tenant_id OR NEW.purpose<>OLD.purpose OR NEW.secret_ref_fingerprint<>OLD.secret_ref_fingerprint OR NEW.generation<>OLD.generation OR NEW.validation_evidence_hash<>OLD.validation_evidence_hash OR NEW.staged_by_hash<>OLD.staged_by_hash OR NEW.staged_at<>OLD.staged_at THEN RAISE EXCEPTION 'secret rotation identity is immutable'; END IF; IF NOT ((OLD.state='STAGED' AND NEW.state IN('ACTIVE','CANCELLED')) OR (OLD.state='ACTIVE' AND NEW.state='RETIRING') OR (OLD.state='RETIRING' AND NEW.state='REVOKED')) THEN RAISE EXCEPTION 'invalid secret rotation transition'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER secret_rotation_transition BEFORE UPDATE ON secret_rotation_generations FOR EACH ROW EXECUTE FUNCTION enforce_secret_rotation_identity();
CREATE OR REPLACE FUNCTION deny_secret_rotation_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'secret rotation evidence cannot be deleted'; END; $$;
CREATE TRIGGER secret_rotation_no_delete BEFORE DELETE ON secret_rotation_generations FOR EACH ROW EXECUTE FUNCTION deny_secret_rotation_delete();
CREATE TRIGGER secret_rotation_events_append_only BEFORE UPDATE OR DELETE ON secret_rotation_events FOR EACH ROW EXECUTE FUNCTION deny_secret_rotation_delete();

COMMIT;
