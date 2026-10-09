BEGIN;

-- V87: envelope-encryption key lifecycle metadata only. No cryptographic key bytes,
-- wrapped data keys or provider credentials are stored in these tables.
CREATE TABLE encryption_key_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  purpose text NOT NULL CHECK (purpose ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  key_alias text NOT NULL CHECK (key_alias ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  generation integer NOT NULL CHECK (generation > 0),
  provider_key_fingerprint char(64) NOT NULL CHECK (provider_key_fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','DECRYPT_ONLY','RETIRED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  retired_at timestamptz,
  retirement_evidence_hash char(64),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  UNIQUE (tenant_id,purpose,generation),
  UNIQUE (tenant_id,purpose,provider_key_fingerprint),
  UNIQUE (tenant_id,id),
  CHECK (retirement_evidence_hash IS NULL OR retirement_evidence_hash ~ '^[a-f0-9]{64}$'),
  CHECK ((status='RETIRED' AND retired_at IS NOT NULL AND retirement_evidence_hash IS NOT NULL) OR status<>'RETIRED')
);
CREATE UNIQUE INDEX uq_encryption_key_active_generation ON encryption_key_generations(tenant_id,purpose) WHERE status='ACTIVE';
CREATE INDEX idx_encryption_key_generation ON encryption_key_generations(tenant_id,purpose,generation DESC);

CREATE TABLE encryption_key_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key_generation_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('REGISTERED','ROTATED','DECRYPT_ONLY','RETIRED')),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,key_generation_id) REFERENCES encryption_key_generations(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_encryption_key_events ON encryption_key_events(tenant_id,key_generation_id,id);

ALTER TABLE encryption_key_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE encryption_key_generations FORCE ROW LEVEL SECURITY;
ALTER TABLE encryption_key_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE encryption_key_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_encryption_key_generation_read ON encryption_key_generations FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_encryption_key_generation_insert ON encryption_key_generations FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_encryption_key_generation_update ON encryption_key_generations FOR UPDATE USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_encryption_key_event_read ON encryption_key_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_encryption_key_event_insert ON encryption_key_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION enforce_encryption_key_generation_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.id<>OLD.id OR NEW.tenant_id<>OLD.tenant_id OR NEW.purpose<>OLD.purpose OR NEW.key_alias<>OLD.key_alias OR NEW.generation<>OLD.generation OR NEW.provider_key_fingerprint<>OLD.provider_key_fingerprint OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'encryption key generation identity immutable';
  END IF;
  IF NOT ((OLD.status='ACTIVE' AND NEW.status='DECRYPT_ONLY') OR (OLD.status='DECRYPT_ONLY' AND NEW.status='RETIRED')) THEN
    RAISE EXCEPTION 'encryption key generation transition invalid';
  END IF;
  IF OLD.status='ACTIVE' AND (NEW.rotated_at IS NULL OR NEW.retired_at IS NOT NULL OR NEW.retirement_evidence_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'encryption key rotation evidence invalid';
  END IF;
  IF OLD.status='DECRYPT_ONLY' AND (NEW.retired_at IS NULL OR NEW.retirement_evidence_hash IS NULL) THEN
    RAISE EXCEPTION 'encryption key retirement evidence required';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER encryption_key_generation_transition BEFORE UPDATE ON encryption_key_generations FOR EACH ROW EXECUTE FUNCTION enforce_encryption_key_generation_transition();
CREATE OR REPLACE FUNCTION deny_encryption_key_generation_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'encryption key generations cannot be deleted'; END; $$;
CREATE TRIGGER encryption_key_generation_no_delete BEFORE DELETE ON encryption_key_generations FOR EACH ROW EXECUTE FUNCTION deny_encryption_key_generation_delete();
CREATE OR REPLACE FUNCTION deny_encryption_key_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'encryption key events are append-only'; END; $$;
CREATE TRIGGER encryption_key_events_append_only BEFORE UPDATE OR DELETE ON encryption_key_events FOR EACH ROW EXECUTE FUNCTION deny_encryption_key_event_mutation();

COMMIT;
