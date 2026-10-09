BEGIN;
-- Separate identity control-plane role. NOLOGIN group; provision a dedicated login
-- separately. Never grant this membership to the domain/API data runtime login.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='legaltech_session_broker') THEN
    CREATE ROLE legaltech_session_broker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='legaltech_session_broker'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unsafe session broker group';
  END IF;
END; $$;
CREATE SCHEMA identity_security;
REVOKE ALL ON SCHEMA identity_security FROM PUBLIC;
GRANT USAGE ON SCHEMA identity_security TO legaltech_session_broker;

CREATE TABLE identity_security.server_sessions (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  session_id uuid NOT NULL UNIQUE,
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  mfa_verified boolean NOT NULL,
  auth_time timestamptz,
  provider_session_hash char(64) CHECK (provider_session_hash IS NULL OR provider_session_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  idle_timeout_ms integer NOT NULL CHECK (idle_timeout_ms BETWEEN 60000 AND 7200000),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  FOREIGN KEY (tenant_id,actor_id) REFERENCES public.actors(tenant_id,id),
  CHECK (expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
  CHECK (auth_time IS NULL OR auth_time<=created_at),
  CHECK (last_seen_at>=created_at)
);
CREATE INDEX idx_shared_session_provider ON identity_security.server_sessions(provider_session_hash) WHERE provider_session_hash IS NOT NULL;
CREATE TABLE identity_security.provider_session_revocations (
  provider_session_hash char(64) PRIMARY KEY CHECK (provider_session_hash ~ '^[a-f0-9]{64}$'),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE identity_security.server_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_security.server_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_security.provider_session_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_security.provider_session_revocations FORCE ROW LEVEL SECURITY;
-- Broker-only global lookup is intentional: authentication precedes tenant context.
-- These rows contain authentication metadata, never legal content or capabilities.
CREATE POLICY session_broker_read ON identity_security.server_sessions FOR SELECT TO legaltech_session_broker USING (true);
CREATE POLICY session_broker_insert ON identity_security.server_sessions FOR INSERT TO legaltech_session_broker WITH CHECK (true);
CREATE POLICY session_broker_update ON identity_security.server_sessions FOR UPDATE TO legaltech_session_broker USING (true) WITH CHECK (true);
CREATE POLICY session_revocation_read ON identity_security.provider_session_revocations FOR SELECT TO legaltech_session_broker USING (true);
CREATE POLICY session_revocation_insert ON identity_security.provider_session_revocations FOR INSERT TO legaltech_session_broker WITH CHECK (true);
GRANT SELECT,INSERT ON identity_security.server_sessions TO legaltech_session_broker;
GRANT UPDATE(last_seen_at,revoked_at) ON identity_security.server_sessions TO legaltech_session_broker;
GRANT SELECT,INSERT ON identity_security.provider_session_revocations TO legaltech_session_broker;

CREATE FUNCTION identity_security.protect_session_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF ROW(NEW.token_hash,NEW.session_id,NEW.tenant_id,NEW.actor_id,NEW.mfa_verified,NEW.auth_time,NEW.provider_session_hash,NEW.created_at,NEW.expires_at,NEW.idle_timeout_ms)
    IS DISTINCT FROM ROW(OLD.token_hash,OLD.session_id,OLD.tenant_id,OLD.actor_id,OLD.mfa_verified,OLD.auth_time,OLD.provider_session_hash,OLD.created_at,OLD.expires_at,OLD.idle_timeout_ms)
    OR NEW.last_seen_at<OLD.last_seen_at OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'shared session identity immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER shared_session_identity_guard BEFORE UPDATE ON identity_security.server_sessions
  FOR EACH ROW EXECUTE FUNCTION identity_security.protect_session_identity();
COMMIT;
