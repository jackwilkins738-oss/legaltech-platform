BEGIN;

-- V73: append-only evidence for bounded notification delivery attempts.
-- External transports remain separately credentialed adapters; this table stores only bounded delivery evidence.
CREATE TABLE notification_delivery_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  notification_intent_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('DELIVERED','FAILED')),
  channel text NOT NULL CHECK (channel IN ('IN_APP','TEAMS')),
  trace_id text NOT NULL,
  delivery_ref_hash text CHECK (delivery_ref_hash IS NULL OR delivery_ref_hash ~ '^[a-f0-9]{64}$'),
  error_code text,
  retry boolean,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,notification_intent_id) REFERENCES notification_intents(tenant_id,id)
);
CREATE INDEX idx_notification_delivery_events_intent ON notification_delivery_events(tenant_id,notification_intent_id,id);

ALTER TABLE notification_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_delivery_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_notification_delivery_events_read ON notification_delivery_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_notification_delivery_events_insert ON notification_delivery_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION deny_notification_delivery_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notification delivery events are append-only'; END; $$;
CREATE TRIGGER notification_delivery_events_append_only BEFORE UPDATE OR DELETE ON notification_delivery_events FOR EACH ROW EXECUTE FUNCTION deny_notification_delivery_event_mutation();

COMMIT;
