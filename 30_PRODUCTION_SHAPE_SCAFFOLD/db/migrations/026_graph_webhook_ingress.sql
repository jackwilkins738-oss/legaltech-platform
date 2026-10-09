BEGIN;

-- V89: validated Microsoft Graph webhook evidence only. Raw notification payloads,
-- clientState values, validation JWTs and resource data do not belong in these tables.
CREATE TABLE graph_webhook_notification_fingerprints (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscription_ref_hash char(64) NOT NULL CHECK (subscription_ref_hash ~ '^[a-f0-9]{64}$'),
  notification_fingerprint char(64) NOT NULL CHECK (notification_fingerprint ~ '^[a-f0-9]{64}$'),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,notification_fingerprint)
);
CREATE INDEX idx_graph_webhook_subscription_fingerprints ON graph_webhook_notification_fingerprints(tenant_id,subscription_ref_hash,received_at DESC);

CREATE TABLE graph_webhook_validation_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscription_ref_hash char(64) NOT NULL CHECK (subscription_ref_hash ~ '^[a-f0-9]{64}$'),
  notification_fingerprint char(64),
  event_type text NOT NULL CHECK (event_type IN ('VALIDATED','DUPLICATE','REJECTED')),
  reason_code text,
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (notification_fingerprint IS NULL OR notification_fingerprint ~ '^[a-f0-9]{64}$'),
  CHECK (reason_code IS NULL OR (length(reason_code) BETWEEN 1 AND 100 AND reason_code ~ '^[A-Z0-9_]+$'))
);
CREATE INDEX idx_graph_webhook_validation_events ON graph_webhook_validation_events(tenant_id,subscription_ref_hash,id);

ALTER TABLE graph_webhook_notification_fingerprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_webhook_notification_fingerprints FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_webhook_validation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_webhook_validation_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_graph_webhook_fingerprint_read ON graph_webhook_notification_fingerprints FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_webhook_fingerprint_insert ON graph_webhook_notification_fingerprints FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_webhook_event_read ON graph_webhook_validation_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_webhook_event_insert ON graph_webhook_validation_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION deny_graph_webhook_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'graph webhook evidence is append-only'; END; $$;
CREATE TRIGGER graph_webhook_fingerprints_append_only BEFORE UPDATE OR DELETE ON graph_webhook_notification_fingerprints FOR EACH ROW EXECUTE FUNCTION deny_graph_webhook_evidence_mutation();
CREATE TRIGGER graph_webhook_events_append_only BEFORE UPDATE OR DELETE ON graph_webhook_validation_events FOR EACH ROW EXECUTE FUNCTION deny_graph_webhook_evidence_mutation();

COMMIT;
