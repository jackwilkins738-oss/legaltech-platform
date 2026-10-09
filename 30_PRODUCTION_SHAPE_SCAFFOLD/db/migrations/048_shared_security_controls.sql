BEGIN;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['legaltech_security_reader','legaltech_security_operator','legaltech_rate_limiter'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'unsafe shared security group';
    END IF;
  END LOOP;
END; $$;
GRANT legaltech_security_reader TO legaltech_security_operator;
CREATE SCHEMA operational_security;
REVOKE ALL ON SCHEMA operational_security FROM PUBLIC;
GRANT USAGE ON SCHEMA operational_security TO legaltech_security_reader,legaltech_security_operator,legaltech_rate_limiter;

CREATE TABLE operational_security.interlocks (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  control text NOT NULL CHECK(control IN ('ALL_EGRESS','PROCLAIM_WRITE','EXTERNAL_NOTIFICATION','EXPORT','CONNECTOR_USE','DOCUMENT_DELIVERY','NEW_SESSION')),
  id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK(status IN ('ACTIVE','RELEASED')),
  incident_id text NOT NULL CHECK(incident_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$'),
  reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  activated_by uuid NOT NULL,
  activated_at timestamptz NOT NULL,
  released_by uuid,
  released_at timestamptz,
  resolution_code text CHECK(resolution_code IS NULL OR resolution_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  trace_id text NOT NULL CHECK(trace_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$'),
  PRIMARY KEY(tenant_id,control),
  FOREIGN KEY(tenant_id,activated_by) REFERENCES public.actors(tenant_id,id),
  FOREIGN KEY(tenant_id,released_by) REFERENCES public.actors(tenant_id,id),
  CHECK((status='ACTIVE' AND released_by IS NULL AND released_at IS NULL AND resolution_code IS NULL)
    OR (status='RELEASED' AND released_by IS NOT NULL AND released_by<>activated_by AND released_at>=activated_at AND resolution_code IS NOT NULL))
);
CREATE TABLE operational_security.interlock_events (
  event_id uuid PRIMARY KEY,
  interlock_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  control text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('INTERLOCK_ACTIVATED','INTERLOCK_RELEASED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  at timestamptz NOT NULL,
  incident_id text NOT NULL,
  reason_code text NOT NULL,
  resolution_code text
);
CREATE INDEX idx_shared_interlock_events ON operational_security.interlock_events(tenant_id,at);
CREATE FUNCTION operational_security.protect_interlock_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='INSERT' AND NEW.status<>'ACTIVE' THEN RAISE EXCEPTION 'invalid initial interlock'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.tenant_id<>OLD.tenant_id OR NEW.control<>OLD.control THEN RAISE EXCEPTION 'immutable interlock binding'; END IF;
    IF OLD.status='ACTIVE' THEN
      IF NEW.status<>'RELEASED' OR NEW.id<>OLD.id OR NEW.incident_id<>OLD.incident_id OR NEW.reason_code<>OLD.reason_code
        OR NEW.activated_by<>OLD.activated_by OR NEW.activated_at<>OLD.activated_at THEN RAISE EXCEPTION 'invalid interlock release'; END IF;
    ELSIF NEW.status<>'ACTIVE' OR NEW.id=OLD.id OR NEW.activated_at<OLD.released_at THEN
      RAISE EXCEPTION 'invalid interlock reactivation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_interlock_transition BEFORE INSERT OR UPDATE ON operational_security.interlocks
FOR EACH ROW EXECUTE FUNCTION operational_security.protect_interlock_transition();
CREATE FUNCTION operational_security.record_interlock_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  INSERT INTO operational_security.interlock_events(event_id,interlock_id,tenant_id,control,event_type,actor_id,trace_id,at,incident_id,reason_code,resolution_code)
  VALUES(gen_random_uuid(),NEW.id,NEW.tenant_id,NEW.control,
    CASE WHEN NEW.status='ACTIVE' THEN 'INTERLOCK_ACTIVATED' ELSE 'INTERLOCK_RELEASED' END,
    CASE WHEN NEW.status='ACTIVE' THEN NEW.activated_by ELSE NEW.released_by END,NEW.trace_id,
    CASE WHEN NEW.status='ACTIVE' THEN NEW.activated_at ELSE NEW.released_at END,NEW.incident_id,NEW.reason_code,NEW.resolution_code);
  RETURN NEW;
END; $$;
CREATE TRIGGER record_interlock_transition AFTER INSERT OR UPDATE ON operational_security.interlocks
FOR EACH ROW EXECUTE FUNCTION operational_security.record_interlock_transition();

-- Bootstrap only: one immutable shared key/policy fingerprint. No raw HMAC key.
CREATE TABLE operational_security.rate_configuration (
  singleton boolean PRIMARY KEY CHECK(singleton=true),
  fingerprint char(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$')
);
CREATE TABLE operational_security.rate_buckets (
  bucket_hash char(64) PRIMARY KEY CHECK(bucket_hash ~ '^[a-f0-9]{64}$'),
  scope text NOT NULL CHECK(scope IN ('IP','TENANT','READ')),
  window_ms integer NOT NULL CHECK(window_ms BETWEEN 1000 AND 3600000),
  record_limit integer NOT NULL CHECK(record_limit BETWEEN 1 AND 1000000),
  matter_limit integer NOT NULL CHECK(matter_limit BETWEEN 0 AND 100000),
  window_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  records integer NOT NULL CHECK(records BETWEEN 0 AND record_limit),
  UNIQUE(bucket_hash,window_id),
  CHECK((scope='READ' AND matter_limit>0) OR (scope<>'READ' AND matter_limit=0))
);
CREATE TABLE operational_security.read_matters (
  bucket_hash char(64) NOT NULL,
  window_id uuid NOT NULL,
  matter_hash char(64) NOT NULL CHECK(matter_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(bucket_hash,window_id,matter_hash),
  FOREIGN KEY(bucket_hash,window_id) REFERENCES operational_security.rate_buckets(bucket_hash,window_id)
);
CREATE FUNCTION operational_security.protect_rate_bucket() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF NEW.started_at>clock_timestamp() THEN RAISE EXCEPTION 'future rate window'; END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.bucket_hash<>OLD.bucket_hash OR NEW.scope<>OLD.scope OR NEW.window_ms<>OLD.window_ms
      OR NEW.record_limit<>OLD.record_limit OR NEW.matter_limit<>OLD.matter_limit THEN
      RAISE EXCEPTION 'immutable rate configuration';
    END IF;
    IF NEW.window_id=OLD.window_id THEN
      IF NEW.started_at<>OLD.started_at OR NEW.records<OLD.records THEN RAISE EXCEPTION 'rate counter regression'; END IF;
    ELSIF clock_timestamp()<OLD.started_at+(OLD.window_ms*interval '1 millisecond')
      OR NEW.started_at<OLD.started_at+(OLD.window_ms*interval '1 millisecond') OR NEW.records<>0 THEN
      RAISE EXCEPTION 'premature rate reset';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_rate_bucket BEFORE INSERT OR UPDATE ON operational_security.rate_buckets
FOR EACH ROW EXECUTE FUNCTION operational_security.protect_rate_bucket();
ALTER TABLE operational_security.interlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_security.interlocks FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_security.interlock_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_security.interlock_events FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_security.rate_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_security.rate_buckets FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_security.read_matters ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_security.read_matters FORCE ROW LEVEL SECURITY;
ALTER TABLE operational_security.rate_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_security.rate_configuration FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_interlock_read ON operational_security.interlocks FOR SELECT TO legaltech_security_reader USING(true);
CREATE POLICY shared_interlock_insert ON operational_security.interlocks FOR INSERT TO legaltech_security_operator WITH CHECK(true);
CREATE POLICY shared_interlock_update ON operational_security.interlocks FOR UPDATE TO legaltech_security_operator USING(true) WITH CHECK(true);
CREATE POLICY shared_interlock_events_read ON operational_security.interlock_events FOR SELECT TO legaltech_security_reader USING(true);
CREATE POLICY shared_interlock_events_insert ON operational_security.interlock_events FOR INSERT TO legaltech_security_operator WITH CHECK(true);
CREATE POLICY shared_rate_buckets ON operational_security.rate_buckets FOR ALL TO legaltech_rate_limiter USING(true) WITH CHECK(true);
CREATE POLICY shared_read_matters ON operational_security.read_matters FOR ALL TO legaltech_rate_limiter USING(true) WITH CHECK(true);
CREATE POLICY shared_rate_configuration_read ON operational_security.rate_configuration FOR SELECT TO legaltech_rate_limiter USING(true);
CREATE POLICY shared_rate_configuration_insert ON operational_security.rate_configuration FOR INSERT TO legaltech_rate_limiter WITH CHECK(true);
REVOKE ALL ON ALL TABLES IN SCHEMA operational_security FROM PUBLIC;
GRANT SELECT ON operational_security.interlocks,operational_security.interlock_events TO legaltech_security_reader;
GRANT INSERT,UPDATE ON operational_security.interlocks TO legaltech_security_operator;
GRANT INSERT ON operational_security.interlock_events TO legaltech_security_operator;
GRANT SELECT,INSERT ON operational_security.rate_buckets TO legaltech_rate_limiter;
GRANT UPDATE(window_id,started_at,records) ON operational_security.rate_buckets TO legaltech_rate_limiter;
GRANT SELECT,INSERT,DELETE ON operational_security.read_matters TO legaltech_rate_limiter;
GRANT SELECT,INSERT ON operational_security.rate_configuration TO legaltech_rate_limiter;
COMMIT;
