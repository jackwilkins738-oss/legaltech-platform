-- V96 append-only synthetic regression certification for exact tenant configuration bundles.
CREATE TABLE IF NOT EXISTS tenant_configuration_certifications (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  bundle_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  bundle_hash char(64) NOT NULL CHECK (bundle_hash ~ '^[a-f0-9]{64}$'),
  scenario_suite_hash char(64) NOT NULL CHECK (scenario_suite_hash ~ '^[a-f0-9]{64}$'),
  total integer NOT NULL CHECK (total > 0 AND total <= 10000),
  passed integer NOT NULL,
  failed integer NOT NULL CHECK (failed = 0),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  runner_version text NOT NULL,
  certified_by text NOT NULL,
  certified_at timestamptz NOT NULL,
  trace_id text NOT NULL,
  CHECK (passed = total)
);
CREATE INDEX IF NOT EXISTS idx_tenant_configuration_certifications_lookup ON tenant_configuration_certifications(tenant_id,bundle_key,version,bundle_hash,seq DESC);
ALTER TABLE tenant_configuration_certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_configuration_certifications_tenant_isolation ON tenant_configuration_certifications;
CREATE POLICY tenant_configuration_certifications_tenant_isolation ON tenant_configuration_certifications USING (tenant_id=current_setting('app.tenant_id',true));
CREATE OR REPLACE FUNCTION reject_tenant_configuration_certification_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'tenant configuration certifications are append-only'; END $$;
DROP TRIGGER IF EXISTS trg_tenant_configuration_certifications_append_only ON tenant_configuration_certifications;
CREATE TRIGGER trg_tenant_configuration_certifications_append_only BEFORE UPDATE OR DELETE ON tenant_configuration_certifications FOR EACH ROW EXECUTE FUNCTION reject_tenant_configuration_certification_mutation();
