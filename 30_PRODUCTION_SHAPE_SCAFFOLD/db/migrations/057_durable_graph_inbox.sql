BEGIN;
-- Validated notification metadata only. Never persist raw Graph payloads,
-- resource paths, clientState, validation JWTs or document content here.
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['legaltech_graph_producer','legaltech_graph_worker','legaltech_graph_reader'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'unsafe Graph inbox group';
    END IF;
  END LOOP;
END; $$;
CREATE SCHEMA graph_security;
REVOKE ALL ON SCHEMA graph_security FROM PUBLIC;
GRANT USAGE ON SCHEMA graph_security TO legaltech_graph_producer,legaltech_graph_worker,legaltech_graph_reader;
GRANT USAGE ON SCHEMA public TO legaltech_graph_producer,legaltech_graph_worker,legaltech_graph_reader;
CREATE TABLE graph_security.notifications (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  subscription_id uuid NOT NULL,
  notification_fingerprint char(64) NOT NULL CHECK(notification_fingerprint ~ '^[a-f0-9]{64}$'),
  source_version_hash char(64) NOT NULL CHECK(source_version_hash ~ '^[a-f0-9]{64}$'),
  source_evidence_hash char(64) NOT NULL CHECK(source_evidence_hash ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK(event_type IN ('CREATED','UPDATED','DELETED','MISSED','SUBSCRIPTION_REMOVED','REAUTHORIZATION_REQUIRED','UNKNOWN')),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','DONE','DEAD')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND max_attempts),
  worker_id uuid,
  token_hash char(64) CHECK(token_hash IS NULL OR token_hash ~ '^[a-f0-9]{64}$'),
  error_code text CHECK(error_code IS NULL OR error_code IN ('DISPATCH_RETRY','DISPATCH_REJECTED','DISPATCH_CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,subscription_id,notification_fingerprint),
  CHECK((status='QUEUED' AND attempts<max_attempts AND worker_id IS NULL AND token_hash IS NULL)
    OR (status IN ('RUNNING','DONE') AND attempts>0 AND worker_id IS NOT NULL AND token_hash IS NOT NULL)
    OR (status='DEAD' AND attempts>0 AND worker_id IS NULL AND token_hash IS NULL))
);
CREATE INDEX idx_graph_inbox_claim ON graph_security.notifications(tenant_id,created_at,subscription_id,notification_fingerprint) WHERE status='QUEUED';
CREATE TABLE graph_security.receipts (
  tenant_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  notification_fingerprint char(64) NOT NULL,
  attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 10),
  worker_id uuid NOT NULL,
  token_hash char(64) NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  outcome_hash char(64) NOT NULL CHECK(outcome_hash ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,subscription_id,notification_fingerprint),
  FOREIGN KEY(tenant_id,subscription_id,notification_fingerprint)
    REFERENCES graph_security.notifications(tenant_id,subscription_id,notification_fingerprint)
);
CREATE FUNCTION graph_security.protect_notification() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'QUEUED' OR NEW.attempts<>0 OR NEW.worker_id IS NOT NULL OR NEW.token_hash IS NOT NULL OR NEW.error_code IS NOT NULL THEN
      RAISE EXCEPTION 'invalid initial Graph inbox state';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id,NEW.subscription_id,NEW.notification_fingerprint,NEW.source_evidence_hash,NEW.source_version_hash,NEW.event_type,NEW.request_hash,NEW.max_attempts,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.subscription_id,OLD.notification_fingerprint,OLD.source_evidence_hash,OLD.source_version_hash,OLD.event_type,OLD.request_hash,OLD.max_attempts,OLD.created_at) THEN
    RAISE EXCEPTION 'immutable Graph inbox binding';
  END IF;
  IF OLD.status='QUEUED' THEN
    IF NEW.status<>'RUNNING' OR NEW.attempts<>OLD.attempts+1 OR NEW.error_code IS NOT NULL THEN RAISE EXCEPTION 'invalid Graph claim'; END IF;
  ELSIF OLD.status='RUNNING' THEN
    IF NEW.attempts<>OLD.attempts OR NEW.status NOT IN ('QUEUED','DONE','DEAD') THEN RAISE EXCEPTION 'invalid Graph settlement'; END IF;
    IF NEW.status='DONE' THEN
      IF NEW.worker_id IS DISTINCT FROM OLD.worker_id OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.error_code IS NOT NULL THEN
        RAISE EXCEPTION 'immutable Graph claim fence';
      END IF;
    ELSIF NEW.error_code IS NULL THEN RAISE EXCEPTION 'Graph failure reason required'; END IF;
  ELSE RAISE EXCEPTION 'terminal Graph inbox state'; END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION graph_security.protect_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Graph receipt is append-only'; END IF;
  IF NOT EXISTS(SELECT 1 FROM graph_security.notifications n WHERE n.tenant_id=NEW.tenant_id AND n.subscription_id=NEW.subscription_id
    AND n.notification_fingerprint=NEW.notification_fingerprint AND n.status='RUNNING' AND n.attempts=NEW.attempt
    AND n.worker_id=NEW.worker_id AND n.token_hash=NEW.token_hash FOR SHARE) THEN RAISE EXCEPTION 'Graph receipt fence mismatch'; END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION graph_security.verify_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_TABLE_NAME='receipts' THEN
    IF NOT EXISTS(SELECT 1 FROM graph_security.notifications n WHERE n.tenant_id=NEW.tenant_id AND n.subscription_id=NEW.subscription_id
      AND n.notification_fingerprint=NEW.notification_fingerprint AND n.status='DONE' AND n.attempts=NEW.attempt
      AND n.worker_id=NEW.worker_id AND n.token_hash=NEW.token_hash) THEN RAISE EXCEPTION 'Graph receipt requires completion'; END IF;
  ELSIF NEW.status='DONE' THEN
    IF NOT EXISTS(SELECT 1 FROM graph_security.receipts r WHERE r.tenant_id=NEW.tenant_id AND r.subscription_id=NEW.subscription_id
      AND r.notification_fingerprint=NEW.notification_fingerprint AND r.attempt=NEW.attempts AND r.worker_id=NEW.worker_id
      AND r.token_hash=NEW.token_hash) THEN RAISE EXCEPTION 'Graph completion requires receipt'; END IF;
  END IF;
  RETURN NULL;
END; $$;
CREATE TRIGGER graph_notification_transition BEFORE INSERT OR UPDATE ON graph_security.notifications FOR EACH ROW EXECUTE FUNCTION graph_security.protect_notification();
CREATE TRIGGER graph_receipt_fence BEFORE INSERT OR UPDATE OR DELETE ON graph_security.receipts FOR EACH ROW EXECUTE FUNCTION graph_security.protect_receipt();
CREATE CONSTRAINT TRIGGER graph_notification_completion AFTER UPDATE ON graph_security.notifications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION graph_security.verify_completion();
CREATE CONSTRAINT TRIGGER graph_receipt_completion AFTER INSERT ON graph_security.receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION graph_security.verify_completion();
ALTER TABLE graph_security.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_security.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE graph_security.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_security.receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY graph_notification_read ON graph_security.notifications FOR SELECT TO legaltech_graph_producer,legaltech_graph_worker,legaltech_graph_reader USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY graph_notification_insert ON graph_security.notifications FOR INSERT TO legaltech_graph_producer WITH CHECK(tenant_id=public.app_current_tenant_id());
CREATE POLICY graph_notification_work ON graph_security.notifications FOR UPDATE TO legaltech_graph_worker USING(tenant_id=public.app_current_tenant_id()) WITH CHECK(tenant_id=public.app_current_tenant_id());
CREATE POLICY graph_receipt_read ON graph_security.receipts FOR SELECT TO legaltech_graph_producer,legaltech_graph_worker,legaltech_graph_reader USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY graph_receipt_insert ON graph_security.receipts FOR INSERT TO legaltech_graph_worker WITH CHECK(tenant_id=public.app_current_tenant_id());
REVOKE ALL ON graph_security.notifications,graph_security.receipts FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA graph_security FROM PUBLIC;
GRANT SELECT ON graph_security.notifications,graph_security.receipts TO legaltech_graph_producer,legaltech_graph_worker,legaltech_graph_reader;
GRANT INSERT(tenant_id,subscription_id,notification_fingerprint,source_evidence_hash,source_version_hash,event_type,request_hash,max_attempts) ON graph_security.notifications TO legaltech_graph_producer;
GRANT UPDATE(status,attempts,worker_id,token_hash,error_code) ON graph_security.notifications TO legaltech_graph_worker;
GRANT INSERT(tenant_id,subscription_id,notification_fingerprint,attempt,worker_id,token_hash,outcome_hash) ON graph_security.receipts TO legaltech_graph_worker;
COMMIT;
