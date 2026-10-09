-- V94 immutable tenant configuration bundles and append-only activation history.
CREATE TABLE IF NOT EXISTS tenant_configuration_bundles (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  bundle_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('DRAFT','PUBLISHED')),
  bundle_hash char(64) NOT NULL CHECK (bundle_hash ~ '^[a-f0-9]{64}$'),
  components_json jsonb NOT NULL,
  based_on_version integer,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  UNIQUE (tenant_id,bundle_key,version)
);
CREATE INDEX IF NOT EXISTS idx_tenant_configuration_bundles_lookup ON tenant_configuration_bundles(tenant_id,bundle_key,version DESC);
ALTER TABLE tenant_configuration_bundles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_configuration_bundles_tenant_isolation ON tenant_configuration_bundles;
CREATE POLICY tenant_configuration_bundles_tenant_isolation ON tenant_configuration_bundles USING (tenant_id=current_setting('app.tenant_id',true));

CREATE TABLE IF NOT EXISTS tenant_configuration_activations (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  bundle_key text NOT NULL,
  bundle_id text NOT NULL REFERENCES tenant_configuration_bundles(id),
  version integer NOT NULL CHECK (version > 0),
  previous_version integer,
  action text NOT NULL CHECK (action IN ('ACTIVATE','ROLLBACK')),
  bundle_hash char(64) NOT NULL CHECK (bundle_hash ~ '^[a-f0-9]{64}$'),
  actor_id text NOT NULL,
  trace_id text NOT NULL,
  activated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_configuration_activations_current ON tenant_configuration_activations(tenant_id,bundle_key,seq DESC);
ALTER TABLE tenant_configuration_activations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_configuration_activations_tenant_isolation ON tenant_configuration_activations;
CREATE POLICY tenant_configuration_activations_tenant_isolation ON tenant_configuration_activations USING (tenant_id=current_setting('app.tenant_id',true));

CREATE OR REPLACE FUNCTION protect_tenant_configuration_bundle() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.tenant_id<>NEW.tenant_id OR OLD.bundle_key<>NEW.bundle_key OR OLD.version<>NEW.version OR OLD.bundle_hash<>NEW.bundle_hash OR OLD.components_json<>NEW.components_json OR OLD.created_by<>NEW.created_by OR OLD.created_at<>NEW.created_at THEN RAISE EXCEPTION 'tenant configuration bundle identity immutable'; END IF;
  IF NOT (OLD.status='DRAFT' AND NEW.status='PUBLISHED') THEN RAISE EXCEPTION 'tenant configuration bundle transition invalid'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tenant_configuration_bundle_guard ON tenant_configuration_bundles;
CREATE TRIGGER trg_tenant_configuration_bundle_guard BEFORE UPDATE ON tenant_configuration_bundles FOR EACH ROW EXECUTE FUNCTION protect_tenant_configuration_bundle();

CREATE OR REPLACE FUNCTION reject_tenant_configuration_activation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tenant configuration activations are append-only'; END $$;
DROP TRIGGER IF EXISTS trg_tenant_configuration_activations_append_only ON tenant_configuration_activations;
CREATE TRIGGER trg_tenant_configuration_activations_append_only BEFORE UPDATE OR DELETE ON tenant_configuration_activations FOR EACH ROW EXECUTE FUNCTION reject_tenant_configuration_activation_mutation();
