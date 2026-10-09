BEGIN;
-- V113: exact-version offboarding export inventory certification. No exported payload is stored.
CREATE TABLE offboarding_export_sets (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  manifest_key text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  definition_hash char(64) NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  required_classes jsonb NOT NULL,
  defined_by_hash char(64) NOT NULL CHECK (defined_by_hash ~ '^[a-f0-9]{64}$'),
  defined_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,manifest_key,version)
);
CREATE TABLE offboarding_export_evidence (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  manifest_key text NOT NULL,
  manifest_version integer NOT NULL,
  resource_class text NOT NULL,
  item_count bigint NOT NULL CHECK (item_count BETWEEN 0 AND 1000000000),
  inventory_hash char(64) NOT NULL CHECK (inventory_hash ~ '^[a-f0-9]{64}$'),
  package_hash char(64) NOT NULL CHECK (package_hash ~ '^[a-f0-9]{64}$'),
  recorded_by_hash char(64) NOT NULL CHECK (recorded_by_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,manifest_key,manifest_version,resource_class)
);
CREATE TABLE offboarding_export_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  manifest_key text NOT NULL,
  manifest_version integer NOT NULL,
  definition_hash char(64) NOT NULL CHECK (definition_hash ~ '^[a-f0-9]{64}$'),
  export_evidence_hash char(64) NOT NULL CHECK (export_evidence_hash ~ '^[a-f0-9]{64}$'),
  resource_class_count integer NOT NULL CHECK (resource_class_count BETWEEN 1 AND 100),
  total_item_count bigint NOT NULL CHECK (total_item_count BETWEEN 0 AND 100000000000),
  certified_by_hash char(64) NOT NULL CHECK (certified_by_hash ~ '^[a-f0-9]{64}$'),
  certified_at timestamptz NOT NULL,
  UNIQUE(tenant_id,export_evidence_hash)
);
ALTER TABLE offboarding_export_sets ENABLE ROW LEVEL SECURITY;ALTER TABLE offboarding_export_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE offboarding_export_evidence ENABLE ROW LEVEL SECURITY;ALTER TABLE offboarding_export_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE offboarding_export_certifications ENABLE ROW LEVEL SECURITY;ALTER TABLE offboarding_export_certifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_offboard_set ON offboarding_export_sets USING(tenant_id=app_current_tenant_id()) WITH CHECK(tenant_id=app_current_tenant_id());
CREATE POLICY tenant_offboard_evidence ON offboarding_export_evidence USING(tenant_id=app_current_tenant_id()) WITH CHECK(tenant_id=app_current_tenant_id());
CREATE POLICY tenant_offboard_cert ON offboarding_export_certifications USING(tenant_id=app_current_tenant_id()) WITH CHECK(tenant_id=app_current_tenant_id());
CREATE OR REPLACE FUNCTION deny_offboarding_export_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'offboarding export evidence is append-only'; END; $$;
CREATE TRIGGER offboard_sets_append_only BEFORE UPDATE OR DELETE ON offboarding_export_sets FOR EACH ROW EXECUTE FUNCTION deny_offboarding_export_mutation();
CREATE TRIGGER offboard_evidence_append_only BEFORE UPDATE OR DELETE ON offboarding_export_evidence FOR EACH ROW EXECUTE FUNCTION deny_offboarding_export_mutation();
CREATE TRIGGER offboard_cert_append_only BEFORE UPDATE OR DELETE ON offboarding_export_certifications FOR EACH ROW EXECUTE FUNCTION deny_offboarding_export_mutation();
COMMIT;
