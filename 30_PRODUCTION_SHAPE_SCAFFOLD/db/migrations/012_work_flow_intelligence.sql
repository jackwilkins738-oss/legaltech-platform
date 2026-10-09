BEGIN;

-- V67: generic delegation and aggregate flow intelligence. No firm-specific
-- routing ladder or SLA threshold is encoded here.
CREATE TABLE work_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  principal_kind text NOT NULL CHECK (principal_kind IN ('USER','ROLE','TEAM','POOL')),
  principal_actor_id uuid,
  principal_ref text,
  delegate_kind text NOT NULL CHECK (delegate_kind IN ('USER','ROLE','TEAM','POOL')),
  delegate_actor_id uuid,
  delegate_ref text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,principal_actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,delegate_actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,revoked_by) REFERENCES actors(tenant_id,id),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '90 days'),
  CHECK ((principal_kind='USER' AND principal_actor_id IS NOT NULL AND principal_ref IS NULL) OR (principal_kind<>'USER' AND principal_actor_id IS NULL AND principal_ref IS NOT NULL)),
  CHECK ((delegate_kind='USER' AND delegate_actor_id IS NOT NULL AND delegate_ref IS NULL) OR (delegate_kind<>'USER' AND delegate_actor_id IS NULL AND delegate_ref IS NOT NULL)),
  CHECK (NOT (principal_kind=delegate_kind AND COALESCE(principal_actor_id::text,principal_ref)=COALESCE(delegate_actor_id::text,delegate_ref)))
);
CREATE INDEX idx_work_delegations_principal ON work_delegations(tenant_id,principal_kind,COALESCE(principal_actor_id::text,principal_ref),status,starts_at,ends_at);

CREATE TABLE delegation_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  delegation_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('GRANTED','REVOKED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,delegation_id) REFERENCES work_delegations(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_delegation_events_rule ON delegation_events(tenant_id,delegation_id,id);

CREATE TABLE flow_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  captured_at timestamptz NOT NULL,
  window_start timestamptz,
  captured_by uuid NOT NULL,
  trace_id text NOT NULL,
  metrics jsonb NOT NULL,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,captured_by) REFERENCES actors(tenant_id,id),
  CHECK (window_start IS NULL OR window_start <= captured_at)
);
CREATE INDEX idx_flow_snapshots_tenant ON flow_snapshots(tenant_id,captured_at);

ALTER TABLE work_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_delegations FORCE ROW LEVEL SECURITY;
ALTER TABLE delegation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE flow_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_work_delegations ON work_delegations
  USING (tenant_id=app_current_tenant_id())
  WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_delegation_events_read ON delegation_events FOR SELECT
  USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_delegation_events_insert ON delegation_events FOR INSERT
  WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_flow_snapshots_read ON flow_snapshots FOR SELECT
  USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_flow_snapshots_insert ON flow_snapshots FOR INSERT
  WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_work_delegation_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.principal_kind IS DISTINCT FROM OLD.principal_kind OR NEW.principal_actor_id IS DISTINCT FROM OLD.principal_actor_id OR NEW.principal_ref IS DISTINCT FROM OLD.principal_ref OR NEW.delegate_kind IS DISTINCT FROM OLD.delegate_kind OR NEW.delegate_actor_id IS DISTINCT FROM OLD.delegate_actor_id OR NEW.delegate_ref IS DISTINCT FROM OLD.delegate_ref OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.version <> OLD.version + 1 OR NOT (OLD.status='ACTIVE' AND NEW.status='REVOKED') THEN
    RAISE EXCEPTION 'work delegation transition invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER work_delegation_transition_guard BEFORE UPDATE ON work_delegations
FOR EACH ROW EXECUTE FUNCTION protect_work_delegation_transition();

CREATE OR REPLACE FUNCTION deny_delegation_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'delegation events are append-only'; END; $$;
CREATE TRIGGER delegation_events_append_only BEFORE UPDATE OR DELETE ON delegation_events
FOR EACH ROW EXECUTE FUNCTION deny_delegation_event_mutation();

CREATE OR REPLACE FUNCTION deny_flow_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'flow snapshots are append-only'; END; $$;
CREATE TRIGGER flow_snapshots_append_only BEFORE UPDATE OR DELETE ON flow_snapshots
FOR EACH ROW EXECUTE FUNCTION deny_flow_snapshot_mutation();

COMMIT;
