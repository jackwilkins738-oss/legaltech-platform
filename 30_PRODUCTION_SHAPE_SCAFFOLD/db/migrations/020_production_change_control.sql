BEGIN;

-- V83: normal production behavior changes are hash-bound, expiring and dual-control.
-- Emergency security interlocks remain a separate immediate containment path.
CREATE TABLE production_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  change_type text NOT NULL CHECK (change_type IN ('WORKFLOW_PUBLISH','RESPONSE_POLICY_PUBLISH','FEATURE_FLAG_CHANGE','RETENTION_POLICY_PUBLISH')),
  target_ref text NOT NULL CHECK (target_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$'),
  target_hash char(64) NOT NULL CHECK (target_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED','CONSUMED')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$'),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_code text,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_code text,
  consumed_by uuid,
  consumed_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,idempotency_key),
  FOREIGN KEY (tenant_id,requested_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,approved_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,rejected_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,cancelled_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,consumed_by) REFERENCES actors(tenant_id,id),
  CHECK (expires_at > requested_at + interval '1 minute' AND expires_at <= requested_at + interval '7 days'),
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK (rejected_by IS NULL OR rejected_by <> requested_by),
  CHECK (rejection_code IS NULL OR rejection_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  CHECK (cancel_code IS NULL OR cancel_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  CHECK (
    (status='PENDING_APPROVAL' AND approved_by IS NULL AND rejected_by IS NULL AND cancelled_by IS NULL AND consumed_by IS NULL) OR
    (status='APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by<>requested_by AND rejected_by IS NULL AND cancelled_by IS NULL AND consumed_by IS NULL) OR
    (status='REJECTED' AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND rejection_code IS NOT NULL AND approved_by IS NULL AND cancelled_by IS NULL AND consumed_by IS NULL) OR
    (status='CANCELLED' AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_code IS NOT NULL AND consumed_by IS NULL) OR
    (status='CONSUMED' AND approved_by IS NOT NULL AND approved_by<>requested_by AND consumed_by IS NOT NULL AND consumed_at IS NOT NULL)
  )
);
CREATE INDEX idx_production_change_pending ON production_change_requests(tenant_id,status,expires_at,requested_at);
CREATE INDEX idx_production_change_target ON production_change_requests(tenant_id,change_type,target_ref,status);

CREATE TABLE production_change_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  change_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CHANGE_REQUESTED','CHANGE_APPROVED','CHANGE_REJECTED','CHANGE_CANCELLED','CHANGE_EXECUTION_FAILED','CHANGE_CONSUMED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,change_id) REFERENCES production_change_requests(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_production_change_events ON production_change_events(tenant_id,change_id,id);

ALTER TABLE production_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_change_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE production_change_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_change_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_production_change_requests ON production_change_requests USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_production_change_events_read ON production_change_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_production_change_events_insert ON production_change_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_production_change_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.change_type IS DISTINCT FROM OLD.change_type OR NEW.target_ref IS DISTINCT FROM OLD.target_ref OR NEW.target_hash IS DISTINCT FROM OLD.target_hash OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN RAISE EXCEPTION 'production change target identity immutable'; END IF;
  IF OLD.status='PENDING_APPROVAL' AND NEW.status='APPROVED' THEN
    IF NEW.approved_by IS NULL OR NEW.approved_by=OLD.requested_by OR NEW.approved_at IS NULL OR now()>=OLD.expires_at THEN RAISE EXCEPTION 'production change approval invalid'; END IF;
  ELSIF OLD.status='PENDING_APPROVAL' AND NEW.status='REJECTED' THEN
    IF NEW.rejected_by IS NULL OR NEW.rejected_by=OLD.requested_by OR NEW.rejected_at IS NULL OR NEW.rejection_code IS NULL THEN RAISE EXCEPTION 'production change rejection invalid'; END IF;
  ELSIF OLD.status IN ('PENDING_APPROVAL','APPROVED') AND NEW.status='CANCELLED' THEN
    IF NEW.cancelled_by IS NULL OR NEW.cancelled_at IS NULL OR NEW.cancel_code IS NULL THEN RAISE EXCEPTION 'production change cancellation invalid'; END IF;
  ELSIF OLD.status='APPROVED' AND NEW.status='CONSUMED' THEN
    IF NEW.consumed_by IS NULL OR NEW.consumed_at IS NULL OR now()>=OLD.expires_at OR OLD.approved_by=OLD.requested_by THEN RAISE EXCEPTION 'production change consumption invalid'; END IF;
  ELSE RAISE EXCEPTION 'production change transition invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER production_change_transition_guard BEFORE UPDATE ON production_change_requests FOR EACH ROW EXECUTE FUNCTION protect_production_change_transition();

CREATE OR REPLACE FUNCTION deny_production_change_delete() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'production change requests are evidential'; END; $$;
CREATE TRIGGER production_change_no_delete BEFORE DELETE ON production_change_requests FOR EACH ROW EXECUTE FUNCTION deny_production_change_delete();

CREATE OR REPLACE FUNCTION deny_production_change_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'production change events are append-only'; END; $$;
CREATE TRIGGER production_change_events_append_only BEFORE UPDATE OR DELETE ON production_change_events FOR EACH ROW EXECUTE FUNCTION deny_production_change_event_mutation();

COMMIT;
