BEGIN;

-- V79: generic data-lifecycle policy, legal holds and dual-control disposition intent.
-- This migration does not create an automatic deletion worker or default retention period.
CREATE TABLE data_lifecycle_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_key text NOT NULL CHECK (policy_key ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  policy_version integer NOT NULL CHECK (policy_version > 0),
  resource_class text NOT NULL CHECK (resource_class ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 36500),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED','RETIRED')),
  definition_hash text NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retired_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,policy_key,policy_version),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_data_lifecycle_policy_lookup ON data_lifecycle_policies(tenant_id,policy_key,policy_version);

CREATE TABLE legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope_kind text NOT NULL CHECK (scope_kind IN ('RESOURCE','MATTER')),
  resource_class text,
  resource_ref text,
  matter_id uuid,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','RELEASED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  release_reason_code text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,released_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  CHECK ((scope_kind='MATTER' AND matter_id IS NOT NULL AND resource_class IS NULL AND resource_ref IS NULL) OR (scope_kind='RESOURCE' AND matter_id IS NULL AND resource_class IS NOT NULL AND resource_ref IS NOT NULL)),
  CHECK (release_reason_code IS NULL OR release_reason_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  CHECK ((status='ACTIVE' AND released_by IS NULL AND released_at IS NULL AND release_reason_code IS NULL) OR (status='RELEASED' AND released_by IS NOT NULL AND released_at IS NOT NULL AND release_reason_code IS NOT NULL))
);
CREATE INDEX idx_legal_holds_active_matter ON legal_holds(tenant_id,matter_id) WHERE status='ACTIVE';
CREATE INDEX idx_legal_holds_active_resource ON legal_holds(tenant_id,resource_class,resource_ref) WHERE status='ACTIVE';

CREATE TABLE disposition_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_key text NOT NULL,
  policy_version integer NOT NULL,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  resource_class text NOT NULL,
  resource_ref text NOT NULL,
  matter_id uuid,
  resource_created_at timestamptz NOT NULL,
  eligible_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING_APPROVAL','APPROVED','CANCELLED')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason_code text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,policy_key,policy_version) REFERENCES data_lifecycle_policies(tenant_id,policy_key,policy_version),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  FOREIGN KEY (tenant_id,requested_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,approved_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,cancelled_by) REFERENCES actors(tenant_id,id),
  CHECK (eligible_at >= resource_created_at),
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK (cancel_reason_code IS NULL OR cancel_reason_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  CHECK ((status='PENDING_APPROVAL' AND approved_by IS NULL AND approved_at IS NULL AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason_code IS NULL) OR (status='APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by <> requested_by AND cancelled_by IS NULL AND cancelled_at IS NULL AND cancel_reason_code IS NULL) OR (status='CANCELLED' AND approved_by IS NULL AND approved_at IS NULL AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_reason_code IS NOT NULL))
);
CREATE INDEX idx_disposition_intents_queue ON disposition_intents(tenant_id,status,eligible_at,requested_at);

CREATE TABLE data_lifecycle_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  object_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('POLICY_DRAFT_CREATED','POLICY_PUBLISHED','POLICY_RETIRED','LEGAL_HOLD_PLACED','LEGAL_HOLD_RELEASED','DISPOSITION_PLANNED','DISPOSITION_APPROVED','DISPOSITION_CANCELLED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_data_lifecycle_events ON data_lifecycle_events(tenant_id,object_id,id);

ALTER TABLE data_lifecycle_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_lifecycle_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE legal_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_holds FORCE ROW LEVEL SECURITY;
ALTER TABLE disposition_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE disposition_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE data_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_lifecycle_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_data_lifecycle_policies ON data_lifecycle_policies USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_legal_holds ON legal_holds USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_disposition_intents ON disposition_intents USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_data_lifecycle_events_read ON data_lifecycle_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_data_lifecycle_events_insert ON data_lifecycle_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_data_lifecycle_policy_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.policy_key IS DISTINCT FROM OLD.policy_key OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.resource_class IS DISTINCT FROM OLD.resource_class OR NEW.retention_days IS DISTINCT FROM OLD.retention_days OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash OR NOT ((OLD.status='DRAFT' AND NEW.status='PUBLISHED' AND NEW.published_at IS NOT NULL AND NEW.retired_at IS NULL) OR (OLD.status='PUBLISHED' AND NEW.status='RETIRED' AND NEW.published_at IS NOT NULL AND NEW.retired_at IS NOT NULL)) THEN RAISE EXCEPTION 'data lifecycle policy transition invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER data_lifecycle_policy_transition_guard BEFORE UPDATE ON data_lifecycle_policies FOR EACH ROW EXECUTE FUNCTION protect_data_lifecycle_policy_transition();

CREATE OR REPLACE FUNCTION protect_legal_hold_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind OR NEW.resource_class IS DISTINCT FROM OLD.resource_class OR NEW.resource_ref IS DISTINCT FROM OLD.resource_ref OR NEW.matter_id IS DISTINCT FROM OLD.matter_id OR NEW.reason_code IS DISTINCT FROM OLD.reason_code OR NOT (OLD.status='ACTIVE' AND NEW.status='RELEASED' AND NEW.released_by IS NOT NULL AND NEW.released_at IS NOT NULL AND NEW.release_reason_code IS NOT NULL) THEN RAISE EXCEPTION 'legal hold transition invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER legal_hold_transition_guard BEFORE UPDATE ON legal_holds FOR EACH ROW EXECUTE FUNCTION protect_legal_hold_transition();

CREATE OR REPLACE FUNCTION protect_disposition_intent_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.policy_key IS DISTINCT FROM OLD.policy_key OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.policy_hash IS DISTINCT FROM OLD.policy_hash OR NEW.resource_class IS DISTINCT FROM OLD.resource_class OR NEW.resource_ref IS DISTINCT FROM OLD.resource_ref OR NEW.matter_id IS DISTINCT FROM OLD.matter_id OR NEW.resource_created_at IS DISTINCT FROM OLD.resource_created_at OR NEW.eligible_at IS DISTINCT FROM OLD.eligible_at OR NOT (OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','CANCELLED')) THEN RAISE EXCEPTION 'disposition intent transition invalid'; END IF;
  IF NEW.status='APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_by=NEW.requested_by OR NEW.approved_at IS NULL OR NEW.cancelled_by IS NOT NULL) THEN RAISE EXCEPTION 'disposition dual control required'; END IF;
  IF NEW.status='CANCELLED' AND (NEW.cancelled_by IS NULL OR NEW.cancelled_at IS NULL OR NEW.cancel_reason_code IS NULL OR NEW.approved_by IS NOT NULL) THEN RAISE EXCEPTION 'disposition cancellation evidence required'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER disposition_intent_transition_guard BEFORE UPDATE ON disposition_intents FOR EACH ROW EXECUTE FUNCTION protect_disposition_intent_transition();

CREATE OR REPLACE FUNCTION deny_data_lifecycle_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'data lifecycle events are append-only'; END; $$;
CREATE TRIGGER data_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON data_lifecycle_events FOR EACH ROW EXECUTE FUNCTION deny_data_lifecycle_event_mutation();

COMMIT;
