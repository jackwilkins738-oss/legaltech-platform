BEGIN;

-- V90: server-owned Microsoft Graph subscription lifecycle metadata.
-- clientState bytes and raw Graph resource paths never belong in these tables.
CREATE TABLE graph_subscription_registry (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subscription_id uuid NOT NULL,
  directory_tenant_id uuid NOT NULL,
  resource_hash char(64) NOT NULL CHECK (resource_hash ~ '^[a-f0-9]{64}$'),
  client_state_secret_ref text NOT NULL CHECK (length(client_state_secret_ref) BETWEEN 8 AND 2048),
  client_state_hash char(64) NOT NULL CHECK (client_state_hash ~ '^[a-f0-9]{64}$'),
  change_types text[] NOT NULL CHECK (cardinality(change_types) BETWEEN 1 AND 3),
  rich_data boolean NOT NULL DEFAULT false,
  app_id uuid,
  status text NOT NULL CHECK (status IN ('ACTIVE','REAUTH_REQUIRED','RECOVERY_REQUIRED','REMOVED','DELETED','EXPIRED')),
  generation integer NOT NULL CHECK (generation > 0),
  expires_at timestamptz NOT NULL,
  predecessor_subscription_id uuid,
  last_lifecycle_event text CHECK (last_lifecycle_event IS NULL OR last_lifecycle_event IN ('missed','subscriptionRemoved','reauthorizationRequired')),
  last_graph_mutation_at timestamptz,
  last_graph_mutation_action text CHECK (last_graph_mutation_action IS NULL OR last_graph_mutation_action IN ('CREATE','RENEW','REAUTHORIZE','DELETE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,subscription_id),
  CHECK ((rich_data AND app_id IS NOT NULL) OR (NOT rich_data)),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX uq_graph_subscription_live_resource ON graph_subscription_registry(tenant_id,resource_hash)
  WHERE status IN ('ACTIVE','REAUTH_REQUIRED','RECOVERY_REQUIRED');
CREATE INDEX idx_graph_subscription_renewal ON graph_subscription_registry(tenant_id,status,expires_at)
  WHERE status='ACTIVE';

CREATE TABLE graph_subscription_lifecycle_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  subscription_ref_hash char(64) NOT NULL CHECK (subscription_ref_hash ~ '^[a-f0-9]{64}$'),
  resource_hash char(64) NOT NULL CHECK (resource_hash ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN ('CREATED','RENEWED','REAUTHORIZED','LIFECYCLE_MISSED','LIFECYCLE_SUBSCRIPTIONREMOVED','LIFECYCLE_REAUTHORIZATIONREQUIRED','RECOVERY_COMPLETED','DELETED','EXPIRED')),
  generation integer NOT NULL CHECK (generation > 0),
  evidence_ref_hash char(64),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,subscription_id) REFERENCES graph_subscription_registry(tenant_id,subscription_id),
  CHECK (evidence_ref_hash IS NULL OR evidence_ref_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX idx_graph_subscription_events ON graph_subscription_lifecycle_events(tenant_id,subscription_id,id);

ALTER TABLE graph_subscription_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_subscription_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_subscription_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_subscription_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_graph_subscription_registry ON graph_subscription_registry USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_subscription_events_read ON graph_subscription_lifecycle_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_subscription_events_insert ON graph_subscription_lifecycle_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_graph_subscription_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id<>OLD.tenant_id OR NEW.subscription_id<>OLD.subscription_id OR NEW.directory_tenant_id<>OLD.directory_tenant_id OR NEW.resource_hash<>OLD.resource_hash OR NEW.client_state_secret_ref<>OLD.client_state_secret_ref OR NEW.client_state_hash<>OLD.client_state_hash OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'graph subscription identity is immutable';
  END IF;
  IF NEW.generation<=OLD.generation THEN RAISE EXCEPTION 'graph subscription generation must increase'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER graph_subscription_identity_guard BEFORE UPDATE ON graph_subscription_registry FOR EACH ROW EXECUTE FUNCTION protect_graph_subscription_identity();

CREATE OR REPLACE FUNCTION deny_graph_subscription_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'graph subscription lifecycle evidence is append-only'; END; $$;
CREATE TRIGGER graph_subscription_events_append_only BEFORE UPDATE OR DELETE ON graph_subscription_lifecycle_events FOR EACH ROW EXECUTE FUNCTION deny_graph_subscription_event_mutation();

COMMIT;
