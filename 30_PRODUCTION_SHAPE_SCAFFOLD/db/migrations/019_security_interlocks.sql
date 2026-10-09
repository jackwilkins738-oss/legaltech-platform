BEGIN;

-- V82: tenant-scoped incident/security interlocks. Activation is immediate;
-- release requires a distinct actor and append-only evidence.
CREATE TABLE security_interlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  control text NOT NULL CHECK (control IN ('ALL_EGRESS','PROCLAIM_WRITE','EXTERNAL_NOTIFICATION','EXPORT','CONNECTOR_USE','NEW_SESSION')),
  status text NOT NULL CHECK (status IN ('ACTIVE','RELEASED')),
  incident_id text NOT NULL CHECK (incident_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  activated_by uuid NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  resolution_code text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,activated_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,released_by) REFERENCES actors(tenant_id,id),
  CHECK (released_by IS NULL OR released_by <> activated_by),
  CHECK (resolution_code IS NULL OR resolution_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  CHECK ((status='ACTIVE' AND released_by IS NULL AND released_at IS NULL AND resolution_code IS NULL) OR
         (status='RELEASED' AND released_by IS NOT NULL AND released_at IS NOT NULL AND resolution_code IS NOT NULL AND released_by <> activated_by))
);
CREATE UNIQUE INDEX uq_security_interlock_active ON security_interlocks(tenant_id,control) WHERE status='ACTIVE';
CREATE INDEX idx_security_interlock_incident ON security_interlocks(tenant_id,incident_id,status);

CREATE TABLE security_interlock_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  interlock_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('INTERLOCK_ACTIVATED','INTERLOCK_RELEASED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,interlock_id) REFERENCES security_interlocks(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_security_interlock_events ON security_interlock_events(tenant_id,interlock_id,id);

ALTER TABLE security_interlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_interlocks FORCE ROW LEVEL SECURITY;
ALTER TABLE security_interlock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_interlock_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_security_interlocks ON security_interlocks USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_security_interlock_events_read ON security_interlock_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_security_interlock_events_insert ON security_interlock_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_security_interlock_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.control IS DISTINCT FROM OLD.control OR NEW.incident_id IS DISTINCT FROM OLD.incident_id OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NEW.activated_by IS DISTINCT FROM OLD.activated_by OR NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN RAISE EXCEPTION 'security interlock identity immutable'; END IF;
  IF NOT (OLD.status='ACTIVE' AND NEW.status='RELEASED' AND NEW.released_by IS NOT NULL AND NEW.released_by<>OLD.activated_by AND NEW.released_at IS NOT NULL AND NEW.resolution_code IS NOT NULL) THEN RAISE EXCEPTION 'security interlock release invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER security_interlock_transition_guard BEFORE UPDATE ON security_interlocks FOR EACH ROW EXECUTE FUNCTION protect_security_interlock_transition();

CREATE OR REPLACE FUNCTION deny_security_interlock_delete() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'security interlocks are evidential'; END; $$;
CREATE TRIGGER security_interlock_no_delete BEFORE DELETE ON security_interlocks FOR EACH ROW EXECUTE FUNCTION deny_security_interlock_delete();

CREATE OR REPLACE FUNCTION deny_security_interlock_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'security interlock events are append-only'; END; $$;
CREATE TRIGGER security_interlock_events_append_only BEFORE UPDATE OR DELETE ON security_interlock_events FOR EACH ROW EXECUTE FUNCTION deny_security_interlock_event_mutation();

COMMIT;
