BEGIN;

-- V85: durable local evidence for an audit-chain head that is anchored outside the
-- primary database. The external anchor reference itself is not stored here; only
-- its SHA-256 fingerprint is retained so checkpoint evidence cannot disclose a
-- provider object reference or credential-bearing URI.
CREATE TABLE audit_integrity_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  audit_event_count bigint NOT NULL CHECK (audit_event_count > 0),
  head_hash char(64) NOT NULL CHECK (head_hash ~ '^[a-f0-9]{64}$'),
  checkpoint_hash char(64) NOT NULL CHECK (checkpoint_hash ~ '^[a-f0-9]{64}$'),
  anchor_ref_hash char(64) NOT NULL CHECK (anchor_ref_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  UNIQUE (tenant_id,checkpoint_hash),
  UNIQUE (tenant_id,id)
);
CREATE INDEX idx_audit_integrity_checkpoint_head
  ON audit_integrity_checkpoints(tenant_id,audit_event_count DESC,created_at DESC);

ALTER TABLE audit_integrity_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_integrity_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_audit_integrity_checkpoint_read ON audit_integrity_checkpoints
  FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_audit_integrity_checkpoint_insert ON audit_integrity_checkpoints
  FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION deny_audit_integrity_checkpoint_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit integrity checkpoints are append-only'; END; $$;
CREATE TRIGGER audit_integrity_checkpoints_append_only
BEFORE UPDATE OR DELETE ON audit_integrity_checkpoints
FOR EACH ROW EXECUTE FUNCTION deny_audit_integrity_checkpoint_mutation();

COMMIT;
