-- V103 tenant lifecycle/offboarding safety. No automatic deletion is introduced.
CREATE TABLE IF NOT EXISTS tenant_lifecycle (
  tenant_id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('PROVISIONING','ACTIVE','SUSPENDED','OFFBOARDING','OFFBOARDED')),
  version bigint NOT NULL CHECK (version >= 1),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
ALTER TABLE tenant_lifecycle ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_lifecycle FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_lifecycle_tenant_isolation ON tenant_lifecycle;
CREATE POLICY tenant_lifecycle_tenant_isolation ON tenant_lifecycle USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS tenant_lifecycle_events (
  seq bigserial PRIMARY KEY,
  id text UNIQUE NOT NULL,
  tenant_id text NOT NULL REFERENCES tenant_lifecycle(tenant_id),
  event_type text NOT NULL,
  state text NOT NULL,
  version bigint NOT NULL,
  actor_hash char(64) NOT NULL CHECK (actor_hash ~ '^[a-f0-9]{64}$'),
  trace_hash char(64) NOT NULL CHECK (trace_hash ~ '^[a-f0-9]{64}$'),
  evidence_json jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);
ALTER TABLE tenant_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_lifecycle_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_lifecycle_events_tenant_isolation ON tenant_lifecycle_events;
CREATE POLICY tenant_lifecycle_events_tenant_isolation ON tenant_lifecycle_events USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE OR REPLACE FUNCTION deny_tenant_lifecycle_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tenant lifecycle events are append only'; END $$;
DROP TRIGGER IF EXISTS tenant_lifecycle_events_append_only ON tenant_lifecycle_events;
CREATE TRIGGER tenant_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON tenant_lifecycle_events FOR EACH ROW EXECUTE FUNCTION deny_tenant_lifecycle_event_mutation();
