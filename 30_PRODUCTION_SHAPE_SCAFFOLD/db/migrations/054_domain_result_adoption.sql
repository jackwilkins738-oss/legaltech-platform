BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_domain_result_writer') THEN
    CREATE ROLE legaltech_domain_result_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_domain_result_writer'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe result writer'; END IF;
END; $$;
GRANT USAGE ON SCHEMA public TO legaltech_domain_result_writer;
ALTER TABLE queue_security.job_results ADD CONSTRAINT worker_result_exact_binding
  UNIQUE(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id);
CREATE TABLE public.domain_job_results (
  tenant_id uuid NOT NULL, job_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('PROCESS_INBOUND','POLICY_EVALUATION')),
  object_id uuid NOT NULL, command_id uuid NOT NULL, command_hash char(64) NOT NULL,
  artifact_hash char(64) NOT NULL, result_hash char(64) NOT NULL, result_code text NOT NULL,
  attempt integer NOT NULL, worker_id uuid NOT NULL, adopted_by uuid NOT NULL,
  adopted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,job_id),
  FOREIGN KEY(tenant_id,job_id) REFERENCES public.domain_job_commands(tenant_id,job_id),
  FOREIGN KEY(tenant_id,adopted_by) REFERENCES public.actors(tenant_id,id),
  FOREIGN KEY(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id)
    REFERENCES queue_security.job_results(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id)
);
CREATE FUNCTION public.check_domain_result_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.domain_job_commands c WHERE c.tenant_id=NEW.tenant_id AND c.job_id=NEW.job_id
    AND c.command_id=NEW.command_id AND c.kind=NEW.kind AND c.object_id=NEW.object_id AND c.request_hash=NEW.command_hash
    AND CASE WHEN c.kind='PROCESS_INBOUND' THEN c.payload_hash=NEW.artifact_hash ELSE c.policy_version_hash=NEW.artifact_hash END) THEN
    RAISE EXCEPTION 'result command binding invalid';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.actors a JOIN public.tenants t ON t.id=a.tenant_id WHERE a.tenant_id=NEW.tenant_id
    AND a.id=NEW.adopted_by AND a.actor_type='SERVICE' AND a.status='ACTIVE' AND t.status='ACTIVE')
    OR NOT EXISTS(SELECT 1 FROM public.actors a JOIN public.domain_job_commands c ON c.tenant_id=a.tenant_id AND c.actor_id=a.id
      WHERE c.tenant_id=NEW.tenant_id AND c.job_id=NEW.job_id AND a.status='ACTIVE' AND a.actor_type IN ('USER','SERVICE')) THEN
    RAISE EXCEPTION 'result adoption requires active identities';
  END IF;
  IF NEW.kind='PROCESS_INBOUND' AND NOT EXISTS(SELECT 1 FROM public.inbound_events e WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.object_id AND e.status='PROCESSED') THEN
    RAISE EXCEPTION 'inbound result requires atomic adoption';
  END IF;
  IF NEW.kind='POLICY_EVALUATION' AND NOT EXISTS(SELECT 1 FROM public.matters m WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.object_id AND m.status='OPEN') THEN
    RAISE EXCEPTION 'policy result requires visible open matter';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER domain_result_binding AFTER INSERT ON public.domain_job_results DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_domain_result_binding();
CREATE FUNCTION public.check_inbound_result_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF pg_has_role(current_user,'legaltech_domain_result_writer','MEMBER') AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status<>'RECEIVED' OR NEW.status<>'PROCESSED' OR NOT EXISTS(SELECT 1 FROM public.domain_job_results r
      WHERE r.tenant_id=OLD.tenant_id AND r.object_id=OLD.id AND r.kind='PROCESS_INBOUND' AND r.adopted_by=public.app_current_actor_id()) THEN
      RAISE EXCEPTION 'inbound transition requires adopted result';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER inbound_result_transition BEFORE UPDATE OF status ON public.inbound_events FOR EACH ROW EXECUTE FUNCTION public.check_inbound_result_transition();
ALTER TABLE public.domain_job_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_job_results FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_result_read ON public.domain_job_results FOR SELECT TO legaltech_domain_result_writer USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY domain_result_append ON public.domain_job_results FOR INSERT TO legaltech_domain_result_writer
  WITH CHECK(tenant_id=public.app_current_tenant_id() AND adopted_by=public.app_current_actor_id());
REVOKE ALL ON public.domain_job_results FROM PUBLIC;
GRANT SELECT ON public.domain_job_results TO legaltech_domain_result_writer;
GRANT INSERT(tenant_id,job_id,kind,object_id,command_id,command_hash,artifact_hash,result_hash,result_code,attempt,worker_id,adopted_by)
  ON public.domain_job_results TO legaltech_domain_result_writer;
GRANT UPDATE(status) ON public.inbound_events TO legaltech_domain_result_writer;
COMMIT;
