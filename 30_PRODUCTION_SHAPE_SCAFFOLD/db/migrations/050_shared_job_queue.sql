BEGIN;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['legaltech_queue_producer','legaltech_queue_worker','legaltech_queue_reader'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'unsafe queue group';
    END IF;
  END LOOP;
END; $$;
GRANT legaltech_queue_reader TO legaltech_queue_producer,legaltech_queue_worker;
CREATE SCHEMA queue_security;
REVOKE ALL ON SCHEMA queue_security FROM PUBLIC;
GRANT USAGE ON SCHEMA queue_security TO legaltech_queue_reader,legaltech_queue_producer,legaltech_queue_worker;
CREATE TABLE queue_security.jobs (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  job_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('PROCESS_INBOUND','POLICY_EVALUATION','PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY')),
  object_id uuid NOT NULL,
  trace_hash char(64) NOT NULL CHECK(trace_hash ~ '^[a-f0-9]{64}$'),
  key_hash char(64) NOT NULL CHECK(key_hash ~ '^[a-f0-9]{64}$'),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 10),
  lease_ms integer NOT NULL CHECK(lease_ms BETWEEN 5000 AND 300000),
  max_run_ms integer NOT NULL CHECK(max_run_ms BETWEEN lease_ms AND 3600000),
  initial_delay_ms integer NOT NULL CHECK(initial_delay_ms BETWEEN 0 AND 86400000),
  retry_delay_ms integer NOT NULL CHECK(retry_delay_ms BETWEEN 1000 AND 3600000),
  status text NOT NULL CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','DEAD','RECONCILE')),
  attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND max_attempts),
  worker_id uuid,
  lease_token_hash char(64) CHECK(lease_token_hash IS NULL OR lease_token_hash ~ '^[a-f0-9]{64}$'),
  lease_until timestamptz,
  run_until timestamptz,
  started_at timestamptz,
  available_at timestamptz NOT NULL,
  last_error_code text CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  result_code text CHECK(result_code IS NULL OR result_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,job_id),
  UNIQUE(tenant_id,kind,key_hash),
  CHECK(updated_at>=created_at),
  CHECK((status='RUNNING' AND worker_id IS NOT NULL AND lease_token_hash IS NOT NULL AND lease_until IS NOT NULL AND run_until IS NOT NULL AND attempts>0
    AND started_at IS NOT NULL AND lease_until>started_at AND run_until>=lease_until)
    OR (status<>'RUNNING' AND lease_until IS NULL AND run_until IS NULL)),
  CHECK(status<>'QUEUED' OR (worker_id IS NULL AND lease_token_hash IS NULL AND started_at IS NULL AND attempts<max_attempts)),
  CHECK(status<>'SUCCEEDED' OR (worker_id IS NOT NULL AND lease_token_hash IS NOT NULL AND result_code IS NOT NULL))
);
CREATE INDEX idx_shared_queue_claim ON queue_security.jobs(tenant_id,kind,available_at,created_at,job_id) WHERE status='QUEUED';
CREATE INDEX idx_shared_queue_expiry ON queue_security.jobs(tenant_id,kind,lease_until,job_id) WHERE status='RUNNING';
CREATE FUNCTION queue_security.protect_job_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ DECLARE stamp timestamptz=clock_timestamp(); BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'QUEUED' OR NEW.attempts<>0 OR NEW.worker_id IS NOT NULL OR NEW.lease_token_hash IS NOT NULL
      OR NEW.started_at IS NOT NULL OR NEW.lease_until IS NOT NULL OR NEW.run_until IS NOT NULL
      OR NEW.last_error_code IS NOT NULL OR NEW.result_code IS NOT NULL OR NEW.created_at>stamp
      OR NEW.updated_at<>NEW.created_at OR NEW.available_at<>NEW.created_at+(NEW.initial_delay_ms*interval '1 millisecond') THEN
      RAISE EXCEPTION 'invalid initial queue state';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.tenant_id,NEW.job_id,NEW.kind,NEW.object_id,NEW.trace_hash,NEW.key_hash,NEW.request_hash,NEW.max_attempts,NEW.lease_ms,NEW.max_run_ms,NEW.initial_delay_ms,NEW.retry_delay_ms,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.job_id,OLD.kind,OLD.object_id,OLD.trace_hash,OLD.key_hash,OLD.request_hash,OLD.max_attempts,OLD.lease_ms,OLD.max_run_ms,OLD.initial_delay_ms,OLD.retry_delay_ms,OLD.created_at)
    OR NEW.updated_at<OLD.updated_at OR NEW.updated_at>stamp THEN RAISE EXCEPTION 'immutable queue binding/clock'; END IF;
  IF OLD.status='QUEUED' THEN
    IF NEW.status<>'RUNNING' OR OLD.available_at>stamp OR NEW.attempts<>OLD.attempts+1
      OR NEW.started_at<OLD.updated_at OR NEW.started_at>stamp OR NEW.available_at<>OLD.available_at
      OR NEW.lease_until<>NEW.started_at+(NEW.lease_ms*interval '1 millisecond')
      OR NEW.run_until<>NEW.started_at+(NEW.max_run_ms*interval '1 millisecond')
      OR NEW.result_code IS NOT NULL OR NEW.last_error_code IS NOT NULL THEN RAISE EXCEPTION 'invalid queue claim'; END IF;
  ELSIF OLD.status='RUNNING' THEN
    IF NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION 'immutable claim fence'; END IF;
    IF NEW.status='RUNNING' THEN
      IF OLD.lease_until<=stamp OR NEW.worker_id<>OLD.worker_id OR NEW.lease_token_hash<>OLD.lease_token_hash
        OR NEW.started_at<>OLD.started_at OR NEW.run_until<>OLD.run_until OR NEW.available_at<>OLD.available_at
        OR NEW.lease_until<OLD.lease_until OR NEW.lease_until>LEAST(stamp+(NEW.lease_ms*interval '1 millisecond'),OLD.run_until)
        OR NEW.last_error_code IS DISTINCT FROM OLD.last_error_code OR NEW.result_code IS DISTINCT FROM OLD.result_code THEN
        RAISE EXCEPTION 'invalid queue renewal';
      END IF;
    ELSE
      IF NEW.status NOT IN ('QUEUED','SUCCEEDED','DEAD','RECONCILE') OR NEW.lease_until IS NOT NULL OR NEW.run_until IS NOT NULL THEN RAISE EXCEPTION 'invalid queue settlement'; END IF;
      IF NEW.status='SUCCEEDED' THEN
        IF OLD.lease_until<=stamp OR NEW.worker_id<>OLD.worker_id OR NEW.lease_token_hash<>OLD.lease_token_hash
          OR NEW.started_at<>OLD.started_at OR NEW.available_at<>OLD.available_at OR NEW.last_error_code IS NOT NULL
          OR NEW.result_code IS NULL THEN RAISE EXCEPTION 'stale queue completion'; END IF;
      ELSE
        IF NEW.worker_id IS NOT NULL OR NEW.lease_token_hash IS NOT NULL OR NEW.started_at IS NOT NULL
          OR NEW.result_code IS NOT NULL OR NEW.last_error_code IS NULL OR NEW.available_at<stamp THEN
          RAISE EXCEPTION 'invalid queue failure'; END IF;
        IF NEW.kind IN ('PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY') AND NEW.status<>'RECONCILE' THEN RAISE EXCEPTION 'external job requires reconciliation'; END IF;
        IF NEW.kind NOT IN ('PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY') AND NEW.status='RECONCILE' THEN RAISE EXCEPTION 'invalid internal recovery'; END IF;
      END IF;
    END IF;
  ELSE RAISE EXCEPTION 'terminal queue state'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_shared_job_transition BEFORE INSERT OR UPDATE ON queue_security.jobs
FOR EACH ROW EXECUTE FUNCTION queue_security.protect_job_transition();
ALTER TABLE queue_security.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_security.jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_queue_read ON queue_security.jobs FOR SELECT TO legaltech_queue_reader USING(true);
CREATE POLICY shared_queue_enqueue ON queue_security.jobs FOR INSERT TO legaltech_queue_producer WITH CHECK(true);
CREATE POLICY shared_queue_work ON queue_security.jobs FOR UPDATE TO legaltech_queue_worker USING(true) WITH CHECK(true);
REVOKE ALL ON queue_security.jobs FROM PUBLIC;
GRANT SELECT ON queue_security.jobs TO legaltech_queue_reader;
GRANT INSERT ON queue_security.jobs TO legaltech_queue_producer;
GRANT UPDATE(status,attempts,worker_id,lease_token_hash,lease_until,run_until,started_at,available_at,last_error_code,result_code,updated_at)
  ON queue_security.jobs TO legaltech_queue_worker;
COMMIT;
