BEGIN;

-- V92: Microsoft Graph delta recovery checkpoint metadata and evidence.
-- Raw @odata.nextLink/@odata.deltaLink URLs and message payloads never belong here.
CREATE TABLE graph_delta_checkpoints (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  resource_hash char(64) NOT NULL CHECK (resource_hash ~ '^[a-f0-9]{64}$'),
  generation integer NOT NULL CHECK (generation > 0),
  delta_link_secret_ref text NOT NULL CHECK (length(delta_link_secret_ref) BETWEEN 8 AND 2048),
  delta_link_hash char(64) NOT NULL CHECK (delta_link_hash ~ '^[a-f0-9]{64}$'),
  subscription_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,resource_hash,generation),
  FOREIGN KEY (tenant_id,subscription_id) REFERENCES graph_subscription_registry(tenant_id,subscription_id)
);
CREATE UNIQUE INDEX uq_graph_delta_checkpoint_generation ON graph_delta_checkpoints(tenant_id,resource_hash,generation);
CREATE INDEX idx_graph_delta_checkpoint_latest ON graph_delta_checkpoints(tenant_id,resource_hash,generation DESC);

CREATE TABLE graph_delta_recovery_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  recovery_ref_hash char(64) NOT NULL CHECK (recovery_ref_hash ~ '^[a-f0-9]{64}$'),
  subscription_ref_hash char(64) NOT NULL CHECK (subscription_ref_hash ~ '^[a-f0-9]{64}$'),
  resource_hash char(64) NOT NULL CHECK (resource_hash ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN ('STARTED','PAGE','PAGE_LIMIT','RETRY_REQUIRED','DELTA_COMPLETE','CHECKPOINTED','COMPLETED','FAILED')),
  page_count integer NOT NULL CHECK (page_count >= 0),
  change_count integer NOT NULL CHECK (change_count >= 0),
  checkpoint_generation integer CHECK (checkpoint_generation IS NULL OR checkpoint_generation > 0),
  checkpoint_hash char(64),
  error_code text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (checkpoint_hash IS NULL OR checkpoint_hash ~ '^[a-f0-9]{64}$'),
  CHECK (error_code IS NULL OR (length(error_code) BETWEEN 1 AND 128 AND error_code ~ '^[A-Z0-9_]+$'))
);
CREATE INDEX idx_graph_delta_recovery_events ON graph_delta_recovery_events(tenant_id,resource_hash,id);

ALTER TABLE graph_delta_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_delta_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_delta_recovery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_delta_recovery_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_graph_delta_checkpoints_read ON graph_delta_checkpoints FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_delta_checkpoints_insert ON graph_delta_checkpoints FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_delta_events_read ON graph_delta_recovery_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_graph_delta_events_insert ON graph_delta_recovery_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION deny_graph_delta_checkpoint_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'graph delta checkpoints are append-only'; END; $$;
CREATE TRIGGER graph_delta_checkpoints_append_only BEFORE UPDATE OR DELETE ON graph_delta_checkpoints FOR EACH ROW EXECUTE FUNCTION deny_graph_delta_checkpoint_mutation();
CREATE OR REPLACE FUNCTION deny_graph_delta_recovery_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'graph delta recovery evidence is append-only'; END; $$;
CREATE TRIGGER graph_delta_recovery_events_append_only BEFORE UPDATE OR DELETE ON graph_delta_recovery_events FOR EACH ROW EXECUTE FUNCTION deny_graph_delta_recovery_event_mutation();

COMMIT;
