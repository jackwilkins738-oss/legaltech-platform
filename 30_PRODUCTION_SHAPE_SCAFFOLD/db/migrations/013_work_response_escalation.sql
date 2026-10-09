BEGIN;

-- V68: configurable response targets and escalation intents. No default SLA,
-- role ladder or automatic reassignment is installed by this migration.
CREATE TABLE response_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_key text NOT NULL CHECK (policy_key ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  definition jsonb NOT NULL,
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  based_on_version integer,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retired_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,policy_key,policy_version),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_response_policies_lookup ON response_policies(tenant_id,policy_key,policy_version);

CREATE TABLE escalation_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  source_work_id uuid NOT NULL,
  matter_id uuid,
  action text NOT NULL CHECK (action IN ('NOTIFY_OWNER','CREATE_ESCALATION')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  dedupe_key text NOT NULL,
  notification_intent_id uuid,
  escalation_work_id uuid,
  triggered_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,dedupe_key),
  FOREIGN KEY (tenant_id,policy_key,policy_version) REFERENCES response_policies(tenant_id,policy_key,policy_version),
  FOREIGN KEY (tenant_id,source_work_id) REFERENCES work_items(tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  FOREIGN KEY (tenant_id,notification_intent_id) REFERENCES notification_intents(tenant_id,id),
  FOREIGN KEY (tenant_id,escalation_work_id) REFERENCES work_items(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,acknowledged_by) REFERENCES actors(tenant_id,id),
  CHECK ((action='NOTIFY_OWNER' AND notification_intent_id IS NOT NULL AND escalation_work_id IS NULL) OR (action='CREATE_ESCALATION' AND notification_intent_id IS NULL AND escalation_work_id IS NOT NULL))
);
CREATE INDEX idx_escalation_intents_queue ON escalation_intents(tenant_id,status,policy_key,triggered_at);

CREATE TABLE escalation_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  intent_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('TRIGGERED','ACKNOWLEDGED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,intent_id) REFERENCES escalation_intents(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_escalation_events_intent ON escalation_events(tenant_id,intent_id,id);

ALTER TABLE response_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE escalation_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE escalation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_response_policies ON response_policies
  USING (tenant_id=app_current_tenant_id())
  WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_escalation_intents ON escalation_intents
  USING (tenant_id=app_current_tenant_id())
  WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_escalation_events_read ON escalation_events FOR SELECT
  USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_escalation_events_insert ON escalation_events FOR INSERT
  WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_response_policy_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.policy_key IS DISTINCT FROM OLD.policy_key OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.definition IS DISTINCT FROM OLD.definition OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash OR NOT ((OLD.status='DRAFT' AND NEW.status='PUBLISHED') OR (OLD.status='PUBLISHED' AND NEW.status='RETIRED')) THEN
    RAISE EXCEPTION 'response policy transition invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER response_policy_transition_guard BEFORE UPDATE ON response_policies
FOR EACH ROW EXECUTE FUNCTION protect_response_policy_transition();

CREATE OR REPLACE FUNCTION protect_escalation_intent_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.policy_key IS DISTINCT FROM OLD.policy_key OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.policy_hash IS DISTINCT FROM OLD.policy_hash OR NEW.source_work_id IS DISTINCT FROM OLD.source_work_id OR NEW.matter_id IS DISTINCT FROM OLD.matter_id OR NEW.action IS DISTINCT FROM OLD.action OR NEW.dedupe_key IS DISTINCT FROM OLD.dedupe_key OR NEW.notification_intent_id IS DISTINCT FROM OLD.notification_intent_id OR NEW.escalation_work_id IS DISTINCT FROM OLD.escalation_work_id OR NEW.version <> OLD.version + 1 OR NOT (OLD.status='OPEN' AND NEW.status='ACKNOWLEDGED') THEN
    RAISE EXCEPTION 'escalation intent transition invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER escalation_intent_transition_guard BEFORE UPDATE ON escalation_intents
FOR EACH ROW EXECUTE FUNCTION protect_escalation_intent_transition();

CREATE OR REPLACE FUNCTION deny_escalation_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'escalation events are append-only'; END; $$;
CREATE TRIGGER escalation_events_append_only BEFORE UPDATE OR DELETE ON escalation_events
FOR EACH ROW EXECUTE FUNCTION deny_escalation_event_mutation();

COMMIT;
