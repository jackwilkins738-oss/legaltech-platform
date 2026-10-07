BEGIN;

ALTER TABLE actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE actors FORCE ROW LEVEL SECURITY;
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE matters FORCE ROW LEVEL SECURITY;
ALTER TABLE external_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_mappings FORCE ROW LEVEL SECURITY;
ALTER TABLE inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_events FORCE ROW LEVEL SECURITY;
ALTER TABLE exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE security_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_zones FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_security_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE actor_security_zones FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE POLICY tenant_isolation_actors ON actors
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_matters ON matters
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_external_mappings ON external_mappings
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_inbound_events ON inbound_events
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_exceptions ON exceptions
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_idempotency ON idempotency_records
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_audit ON audit_events
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_jobs ON jobs
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_security_zones ON security_zones
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_actor_security_zones ON actor_security_zones
  USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id());

COMMIT;
