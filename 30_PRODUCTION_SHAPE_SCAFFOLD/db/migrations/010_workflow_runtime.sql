BEGIN;

-- V65: versioned workflow execution, tenant feature flags and notification intents.
-- Runtime definitions are generic and cannot directly execute Graph/Proclaim writes.
CREATE TABLE workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  name text NOT NULL,
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  definition jsonb NOT NULL,
  based_on_version integer,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retired_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,workflow_key,version),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id)
);

CREATE TABLE workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_definition_id uuid NOT NULL,
  workflow_key text NOT NULL,
  workflow_version integer NOT NULL,
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  matter_id uuid,
  state text NOT NULL CHECK (state IN ('RUNNING','WAITING','COMPLETED','FAILED','CANCELLED')),
  current_step_id text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  waiting jsonb,
  step_count integer NOT NULL DEFAULT 0 CHECK (step_count BETWEEN 0 AND 100),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,workflow_definition_id) REFERENCES workflow_definitions(tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_workflow_instances_queue ON workflow_instances(tenant_id,state,workflow_key,updated_at);

CREATE TABLE workflow_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  workflow_instance_id uuid NOT NULL,
  matter_id uuid,
  event_type text NOT NULL,
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,workflow_instance_id) REFERENCES workflow_instances(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);

CREATE TABLE feature_flags (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  flag_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  rollout_percent integer NOT NULL DEFAULT 100 CHECK (rollout_percent BETWEEN 0 AND 100),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,flag_key),
  FOREIGN KEY (tenant_id,updated_by) REFERENCES actors(tenant_id,id)
);

CREATE TABLE notification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  channel text NOT NULL CHECK (channel IN ('IN_APP','TEAMS')),
  template_id text NOT NULL,
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('USER','ROLE','TEAM','POOL')),
  recipient_actor_id uuid,
  recipient_ref text,
  object_type text NOT NULL,
  object_id text NOT NULL,
  dedupe_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('LOW','NORMAL','HIGH','CRITICAL')),
  status text NOT NULL CHECK (status IN ('QUEUED','SENDING','DELIVERED','DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  trace_id text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  last_error text,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,dedupe_key),
  FOREIGN KEY (tenant_id,recipient_actor_id) REFERENCES actors(tenant_id,id),
  CHECK ((recipient_kind='USER' AND recipient_actor_id IS NOT NULL AND recipient_ref IS NULL) OR (recipient_kind<>'USER' AND recipient_actor_id IS NULL AND recipient_ref IS NOT NULL))
);
CREATE INDEX idx_notification_intents_queue ON notification_intents(tenant_id,status,channel,created_at);

ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY; ALTER TABLE workflow_events FORCE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY; ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_intents ENABLE ROW LEVEL SECURITY; ALTER TABLE notification_intents FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_workflow_definitions ON workflow_definitions USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_workflow_instances ON workflow_instances USING (tenant_id=app_current_tenant_id() AND (matter_id IS NULL OR EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id=workflow_instances.tenant_id AND m.id=workflow_instances.matter_id))) WITH CHECK (tenant_id=app_current_tenant_id() AND (matter_id IS NULL OR EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id=workflow_instances.tenant_id AND m.id=workflow_instances.matter_id)));
CREATE POLICY tenant_workflow_events_read ON workflow_events FOR SELECT USING (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM workflow_instances w WHERE w.tenant_id=workflow_events.tenant_id AND w.id=workflow_events.workflow_instance_id));
CREATE POLICY tenant_workflow_events_insert ON workflow_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM workflow_instances w WHERE w.tenant_id=workflow_events.tenant_id AND w.id=workflow_events.workflow_instance_id));
CREATE POLICY tenant_feature_flags ON feature_flags USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_notification_intents ON notification_intents USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_published_workflow_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED','RETIRED') AND (NEW.definition IS DISTINCT FROM OLD.definition OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key OR NEW.version IS DISTINCT FROM OLD.version) THEN RAISE EXCEPTION 'published workflow definition is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER workflow_definition_immutable BEFORE UPDATE ON workflow_definitions FOR EACH ROW EXECUTE FUNCTION protect_published_workflow_definition();

CREATE OR REPLACE FUNCTION deny_workflow_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events are append-only'; END; $$;
CREATE TRIGGER workflow_events_append_only BEFORE UPDATE OR DELETE ON workflow_events FOR EACH ROW EXECUTE FUNCTION deny_workflow_event_mutation();

COMMIT;
