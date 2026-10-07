BEGIN;
CREATE INDEX IF NOT EXISTS idx_matters_tenant_status ON matters(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_mappings_matter ON external_mappings(tenant_id, matter_id);
CREATE INDEX IF NOT EXISTS idx_inbound_tenant_received ON inbound_events(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_exceptions_open ON exceptions(tenant_id, status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_matter_time ON audit_events(tenant_id, matter_id, occurred_at DESC);
COMMIT;
