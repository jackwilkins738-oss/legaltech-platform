BEGIN;

-- V62: central security-monitoring primitives. Existing audit rows remain historical;
-- every new audit row is chained server-side so the runtime cannot choose chain values.
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS previous_hash text;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS entry_hash text;

CREATE OR REPLACE FUNCTION chain_audit_event() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  prior text;
  material text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text));
  SELECT entry_hash INTO prior
  FROM audit_events
  WHERE tenant_id = NEW.tenant_id AND entry_hash IS NOT NULL
  ORDER BY id DESC LIMIT 1;
  NEW.previous_hash := COALESCE(prior, repeat('0',64));
  material := concat_ws('|',
    NEW.previous_hash, NEW.tenant_id::text, COALESCE(NEW.actor_id::text,''),
    NEW.action, NEW.object_type, NEW.object_id, COALESCE(NEW.matter_id::text,''),
    NEW.outcome, COALESCE(NEW.reason_code,''), NEW.trace_id,
    COALESCE(NEW.metadata::text,'{}'), NEW.occurred_at::text
  );
  NEW.entry_hash := encode(digest(material,'sha256'),'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_events_hash_chain ON audit_events;
CREATE TRIGGER audit_events_hash_chain
BEFORE INSERT ON audit_events
FOR EACH ROW EXECUTE FUNCTION chain_audit_event();

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_tenant_entry_hash
  ON audit_events(tenant_id, entry_hash) WHERE entry_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_alerts (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  incident_id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  session_id text,
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','MEDIUM','HIGH','CRITICAL')),
  trace_id text NOT NULL,
  matter_id uuid,
  action text,
  context_hash text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters(tenant_id,id),
  CHECK (context_hash IS NULL OR context_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_security_alert_tenant_time ON security_alerts(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_alert_incident ON security_alerts(tenant_id, incident_id);

ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_security_alert_read ON security_alerts
  FOR SELECT USING (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_security_alert_insert ON security_alerts
  FOR INSERT WITH CHECK (tenant_id = app_current_tenant_id());

CREATE OR REPLACE FUNCTION deny_security_alert_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'security alerts are append-only';
END;
$$;
DROP TRIGGER IF EXISTS security_alerts_append_only ON security_alerts;
CREATE TRIGGER security_alerts_append_only
BEFORE UPDATE OR DELETE ON security_alerts
FOR EACH ROW EXECUTE FUNCTION deny_security_alert_mutation();

COMMIT;
