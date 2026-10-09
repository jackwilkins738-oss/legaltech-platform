BEGIN;

-- V84: background execution must be authorized by a short-lived, exact-bound workload grant.
-- Raw execution tokens are never stored; only a SHA-256 grant fingerprint is durable.
CREATE TABLE worker_execution_grant_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grant_fingerprint char(64) NOT NULL CHECK (grant_fingerprint ~ '^[a-f0-9]{64}$'),
  worker_type text NOT NULL CHECK (worker_type ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,127}$'),
  object_type text NOT NULL CHECK (object_type IN ('JOB','NOTIFICATION')),
  object_ref text NOT NULL CHECK (object_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$'),
  service_ref text NOT NULL CHECK (service_ref ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$'),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,grant_fingerprint),
  UNIQUE (tenant_id,id),
  CHECK (expires_at > consumed_at - interval '30 seconds')
);
CREATE INDEX idx_worker_execution_object ON worker_execution_grant_consumptions(tenant_id,worker_type,object_type,object_ref,consumed_at DESC);
CREATE INDEX idx_worker_execution_service ON worker_execution_grant_consumptions(tenant_id,service_ref,consumed_at DESC);

CREATE TABLE worker_execution_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  consumption_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('AUTHORIZED','CLAIMED','COMPLETED','FAILED','SUPERSEDED')),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,consumption_id) REFERENCES worker_execution_grant_consumptions(tenant_id,id)
);
CREATE INDEX idx_worker_execution_events ON worker_execution_events(tenant_id,consumption_id,id);

ALTER TABLE worker_execution_grant_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_execution_grant_consumptions FORCE ROW LEVEL SECURITY;
ALTER TABLE worker_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_execution_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_worker_execution_consumption_read ON worker_execution_grant_consumptions FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_worker_execution_consumption_insert ON worker_execution_grant_consumptions FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_worker_execution_event_read ON worker_execution_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_worker_execution_event_insert ON worker_execution_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION deny_worker_execution_consumption_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'worker execution consumption is immutable'; END; $$;
CREATE TRIGGER worker_execution_consumption_immutable BEFORE UPDATE OR DELETE ON worker_execution_grant_consumptions FOR EACH ROW EXECUTE FUNCTION deny_worker_execution_consumption_mutation();

CREATE OR REPLACE FUNCTION deny_worker_execution_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'worker execution events are append-only'; END; $$;
CREATE TRIGGER worker_execution_events_append_only BEFORE UPDATE OR DELETE ON worker_execution_events FOR EACH ROW EXECUTE FUNCTION deny_worker_execution_event_mutation();

COMMIT;
