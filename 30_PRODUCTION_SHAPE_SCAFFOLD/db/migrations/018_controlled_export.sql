BEGIN;

-- V81: controlled data-export package and single-use actor-bound download grants.
-- No public links, arbitrary outbound destinations, email delivery or raw package bytes are stored here.
CREATE TABLE controlled_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requested_by uuid NOT NULL,
  format text NOT NULL CHECK (format ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  resource_count integer NOT NULL CHECK (resource_count BETWEEN 1 AND 5000),
  matter_count integer NOT NULL CHECK (matter_count BETWEEN 0 AND resource_count),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('REQUESTED','READY','REVOKED')),
  package_sha256 text CHECK (package_sha256 ~ '^[a-f0-9]{64}$'),
  package_bytes bigint CHECK (package_bytes BETWEEN 1 AND 262144000),
  storage_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,requested_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,revoked_by) REFERENCES actors(tenant_id,id),
  CHECK ((status='REQUESTED' AND package_sha256 IS NULL AND package_bytes IS NULL AND storage_ref IS NULL AND ready_at IS NULL AND revoked_at IS NULL AND revoked_by IS NULL) OR
         (status='READY' AND package_sha256 IS NOT NULL AND package_bytes IS NOT NULL AND storage_ref IS NOT NULL AND ready_at IS NOT NULL AND revoked_at IS NULL AND revoked_by IS NULL) OR
         (status='REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);
CREATE INDEX idx_controlled_exports_actor ON controlled_exports(tenant_id,requested_by,status,created_at);

CREATE TABLE controlled_export_resources (
  tenant_id uuid NOT NULL,
  export_id uuid NOT NULL,
  resource_class text NOT NULL CHECK (resource_class ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  resource_ref text NOT NULL CHECK (length(resource_ref) BETWEEN 1 AND 256),
  matter_id uuid,
  PRIMARY KEY (tenant_id,export_id,resource_class,resource_ref),
  FOREIGN KEY (tenant_id,export_id) REFERENCES controlled_exports(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id)
);
CREATE INDEX idx_controlled_export_resources_matter ON controlled_export_resources(tenant_id,matter_id,export_id);

CREATE TABLE controlled_export_download_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  export_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','REVOKED')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,token_hash),
  FOREIGN KEY (tenant_id,export_id) REFERENCES controlled_exports(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '15 minutes'),
  CHECK ((status='ACTIVE' AND consumed_at IS NULL AND revoked_at IS NULL) OR
         (status='CONSUMED' AND consumed_at IS NOT NULL AND revoked_at IS NULL) OR
         (status='REVOKED' AND consumed_at IS NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX idx_controlled_export_grants_active ON controlled_export_download_grants(tenant_id,export_id,status,expires_at);

CREATE TABLE controlled_export_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  export_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('EXPORT_REQUESTED','EXPORT_READY','EXPORT_DOWNLOAD_GRANT_ISSUED','EXPORT_DOWNLOADED','EXPORT_REVOKED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,export_id) REFERENCES controlled_exports(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_controlled_export_events_export ON controlled_export_events(tenant_id,export_id,id);

ALTER TABLE controlled_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE controlled_exports FORCE ROW LEVEL SECURITY;
ALTER TABLE controlled_export_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE controlled_export_resources FORCE ROW LEVEL SECURITY;
ALTER TABLE controlled_export_download_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE controlled_export_download_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE controlled_export_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE controlled_export_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_controlled_exports ON controlled_exports USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_controlled_export_resources ON controlled_export_resources USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_controlled_export_grants ON controlled_export_download_grants USING (tenant_id=app_current_tenant_id()) WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_controlled_export_events_read ON controlled_export_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_controlled_export_events_insert ON controlled_export_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_controlled_export_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.format IS DISTINCT FROM OLD.format OR NEW.resource_count IS DISTINCT FROM OLD.resource_count OR NEW.matter_count IS DISTINCT FROM OLD.matter_count OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'controlled export identity immutable'; END IF;
  IF NOT ((OLD.status='REQUESTED' AND NEW.status IN ('READY','REVOKED')) OR (OLD.status='READY' AND NEW.status='REVOKED')) THEN RAISE EXCEPTION 'controlled export transition invalid'; END IF;
  IF NEW.status='READY' AND (NEW.package_sha256 IS NULL OR NEW.package_bytes IS NULL OR NEW.storage_ref IS NULL OR NEW.ready_at IS NULL) THEN RAISE EXCEPTION 'controlled export ready evidence required'; END IF;
  IF NEW.status='REVOKED' AND (NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL) THEN RAISE EXCEPTION 'controlled export revocation evidence required'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER controlled_export_transition_guard BEFORE UPDATE ON controlled_exports FOR EACH ROW EXECUTE FUNCTION protect_controlled_export_transition();

CREATE OR REPLACE FUNCTION deny_controlled_export_resource_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled export resources are immutable'; END; $$;
CREATE TRIGGER controlled_export_resources_immutable BEFORE UPDATE OR DELETE ON controlled_export_resources FOR EACH ROW EXECUTE FUNCTION deny_controlled_export_resource_mutation();

CREATE OR REPLACE FUNCTION protect_controlled_export_grant_transition() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.export_id IS DISTINCT FROM OLD.export_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN RAISE EXCEPTION 'export grant identity immutable'; END IF;
  IF NOT (OLD.status='ACTIVE' AND NEW.status IN ('CONSUMED','REVOKED')) THEN RAISE EXCEPTION 'export grant transition invalid'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER controlled_export_grant_transition_guard BEFORE UPDATE ON controlled_export_download_grants FOR EACH ROW EXECUTE FUNCTION protect_controlled_export_grant_transition();

CREATE OR REPLACE FUNCTION deny_controlled_export_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'controlled export events are append-only'; END; $$;
CREATE TRIGGER controlled_export_events_append_only BEFORE UPDATE OR DELETE ON controlled_export_events FOR EACH ROW EXECUTE FUNCTION deny_controlled_export_event_mutation();

COMMIT;
