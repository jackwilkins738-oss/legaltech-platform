BEGIN;
-- V117: these V93/V94/V96 tenant tables enabled RLS without forcing it.
-- Runtime roles must still be non-owners and have no BYPASSRLS authority.
ALTER TABLE security_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE security_incident_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE security_incident_events FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_configuration_bundles FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_configuration_activations FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_configuration_certifications FORCE ROW LEVEL SECURITY;
COMMIT;
