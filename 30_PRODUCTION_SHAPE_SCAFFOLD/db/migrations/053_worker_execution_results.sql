BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_job_domain_reader') THEN
    CREATE ROLE legaltech_job_domain_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_job_domain_reader'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unsafe worker domain reader';
  END IF;
END; $$;
GRANT USAGE ON SCHEMA public TO legaltech_job_domain_reader;
GRANT SELECT ON public.tenants,public.actors,public.matters,public.inbound_events,public.domain_job_commands,public.domain_outbox_events,
  public.matter_actor_access,public.matter_break_glass_grants,public.actor_security_zones TO legaltech_job_domain_reader;
CREATE POLICY worker_command_read ON public.domain_job_commands FOR SELECT TO legaltech_job_domain_reader USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY worker_outbox_read ON public.domain_outbox_events FOR SELECT TO legaltech_job_domain_reader USING(tenant_id=public.app_current_tenant_id());
CREATE TABLE queue_security.job_results (
  tenant_id uuid NOT NULL, job_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('PROCESS_INBOUND','POLICY_EVALUATION')),
  object_id uuid NOT NULL, command_id uuid NOT NULL,
  command_hash char(64) NOT NULL CHECK(command_hash ~ '^[a-f0-9]{64}$'),
  artifact_hash char(64) NOT NULL CHECK(artifact_hash ~ '^[a-f0-9]{64}$'),
  result_hash char(64) NOT NULL CHECK(result_hash ~ '^[a-f0-9]{64}$'),
  result_code text NOT NULL CHECK(result_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  attempt integer NOT NULL CHECK(attempt BETWEEN 1 AND 10), worker_id uuid NOT NULL,
  token_hash char(64) NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,job_id), FOREIGN KEY(tenant_id,job_id) REFERENCES queue_security.jobs(tenant_id,job_id)
);
CREATE FUNCTION queue_security.check_result_claim() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE j queue_security.jobs%ROWTYPE; BEGIN
  SELECT * INTO j FROM queue_security.jobs WHERE tenant_id=NEW.tenant_id AND job_id=NEW.job_id FOR UPDATE;
  IF NOT FOUND OR j.status<>'RUNNING' OR j.kind<>NEW.kind OR j.object_id<>NEW.object_id OR j.attempts<>NEW.attempt
    OR j.worker_id<>NEW.worker_id OR j.lease_token_hash<>NEW.token_hash OR j.lease_until<=clock_timestamp() THEN
    RAISE EXCEPTION 'result requires current claim';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER worker_result_claim BEFORE INSERT ON queue_security.job_results FOR EACH ROW EXECUTE FUNCTION queue_security.check_result_claim();
CREATE FUNCTION queue_security.check_result_completion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM queue_security.jobs j WHERE j.tenant_id=NEW.tenant_id AND j.job_id=NEW.job_id AND j.status='SUCCEEDED'
    AND j.kind=NEW.kind AND j.object_id=NEW.object_id AND j.attempts=NEW.attempt AND j.worker_id=NEW.worker_id
    AND j.lease_token_hash=NEW.token_hash AND j.result_code=NEW.result_code) THEN RAISE EXCEPTION 'result requires atomic completion'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER worker_result_completion AFTER INSERT ON queue_security.job_results DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION queue_security.check_result_completion();
ALTER TABLE queue_security.job_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_security.job_results FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_result_read ON queue_security.job_results FOR SELECT TO legaltech_queue_reader USING(true);
CREATE POLICY worker_result_append ON queue_security.job_results FOR INSERT TO legaltech_queue_worker WITH CHECK(true);
REVOKE ALL ON queue_security.job_results FROM PUBLIC;
GRANT SELECT ON queue_security.job_results TO legaltech_queue_reader;
GRANT INSERT(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id,token_hash)
  ON queue_security.job_results TO legaltech_queue_worker;
COMMIT;
