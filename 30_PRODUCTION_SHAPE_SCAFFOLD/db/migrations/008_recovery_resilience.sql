BEGIN;

-- V63: durable, tenant-bound, append-only recovery evidence. This records recovery
-- control evidence; backup bytes remain in an external managed immutable backup plane.
CREATE TABLE IF NOT EXISTS recovery_evidence (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL CHECK (event_type IN ('BACKUP_VERIFIED','RESTORE_AUTHORIZED','RESTORE_STARTED','RESTORE_VERIFIED','RECOVERY_DRILL')),
  backup_id text NOT NULL,
  backup_set_id text NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  restore_id uuid,
  actor_id uuid,
  approver_id uuid,
  target_environment text,
  outcome text NOT NULL,
  reason_code text NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash text,
  entry_hash text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id, approver_id) REFERENCES actors(tenant_id,id),
  CHECK (actor_id IS NULL OR approver_id IS NULL OR actor_id <> approver_id)
);
CREATE INDEX IF NOT EXISTS idx_recovery_evidence_tenant_time ON recovery_evidence(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_backup ON recovery_evidence(tenant_id, backup_id, generation);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_restore_event ON recovery_evidence(tenant_id, restore_id, event_type) WHERE restore_id IS NOT NULL;

CREATE OR REPLACE FUNCTION chain_recovery_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE prior text; material text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text));
  SELECT entry_hash INTO prior FROM recovery_evidence
    WHERE tenant_id=NEW.tenant_id AND entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1;
  NEW.previous_hash := COALESCE(prior, repeat('0',64));
  material := concat_ws('|',NEW.previous_hash,NEW.tenant_id::text,NEW.event_type,NEW.backup_id,
    NEW.backup_set_id,NEW.generation::text,NEW.manifest_hash,COALESCE(NEW.restore_id::text,''),
    COALESCE(NEW.actor_id::text,''),COALESCE(NEW.approver_id::text,''),COALESCE(NEW.target_environment,''),
    NEW.outcome,NEW.reason_code,NEW.trace_id,NEW.evidence::text,NEW.occurred_at::text);
  NEW.entry_hash := encode(digest(material,'sha256'),'hex');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS recovery_evidence_hash_chain ON recovery_evidence;
CREATE TRIGGER recovery_evidence_hash_chain BEFORE INSERT ON recovery_evidence
FOR EACH ROW EXECUTE FUNCTION chain_recovery_evidence();

CREATE OR REPLACE FUNCTION deny_recovery_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'recovery evidence is append-only'; END; $$;
DROP TRIGGER IF EXISTS recovery_evidence_append_only ON recovery_evidence;
CREATE TRIGGER recovery_evidence_append_only BEFORE UPDATE OR DELETE ON recovery_evidence
FOR EACH ROW EXECUTE FUNCTION deny_recovery_evidence_mutation();

ALTER TABLE recovery_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_recovery_evidence_read ON recovery_evidence FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_recovery_evidence_insert ON recovery_evidence FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

COMMIT;
