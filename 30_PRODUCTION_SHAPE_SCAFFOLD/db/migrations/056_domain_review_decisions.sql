BEGIN;
-- V130: the durable human review decision on an adopted inbound result.
-- One immutable decision per inbound event, bound to the exact adopted result
-- hash, made by an active USER (never a service), approving into an open
-- matter or rejecting. An approval atomically queues one PROCLAIM_WRITEBACK
-- outbox intent for the event. The reviewer group is separate from the result
-- writer: the identity that adopts a machine result is not the one that
-- approves it.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_domain_reviewer') THEN
    CREATE ROLE legaltech_domain_reviewer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_domain_reviewer'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe review group'; END IF;
END; $$;
GRANT USAGE ON SCHEMA public TO legaltech_domain_reviewer;
ALTER TABLE public.domain_job_results ADD CONSTRAINT domain_result_review_binding UNIQUE(tenant_id,job_id,kind,object_id,result_hash);
CREATE TABLE public.domain_review_decisions (
  tenant_id uuid NOT NULL, event_id uuid NOT NULL,
  result_job_id uuid NOT NULL, result_kind text GENERATED ALWAYS AS ('PROCESS_INBOUND') STORED,
  result_hash char(64) NOT NULL CHECK(result_hash ~ '^[a-f0-9]{64}$'),
  decision text NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
  matter_id uuid, decided_by uuid NOT NULL,
  decision_key_hash char(64) NOT NULL CHECK(decision_key_hash ~ '^[a-f0-9]{64}$'),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  writeback_job_id uuid,
  writeback_kind text GENERATED ALWAYS AS (CASE WHEN decision='APPROVE' THEN 'PROCLAIM_WRITEBACK' END) STORED,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,event_id), UNIQUE(tenant_id,decision_key_hash), UNIQUE(tenant_id,result_job_id),
  FOREIGN KEY(tenant_id,event_id) REFERENCES public.inbound_events(tenant_id,id),
  FOREIGN KEY(tenant_id,decided_by) REFERENCES public.actors(tenant_id,id),
  FOREIGN KEY(tenant_id,matter_id) REFERENCES public.matters(tenant_id,id),
  FOREIGN KEY(tenant_id,result_job_id,result_kind,event_id,result_hash)
    REFERENCES public.domain_job_results(tenant_id,job_id,kind,object_id,result_hash),
  FOREIGN KEY(tenant_id,writeback_job_id,writeback_kind,event_id)
    REFERENCES public.domain_outbox_events(tenant_id,job_id,kind,object_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK((decision='APPROVE' AND matter_id IS NOT NULL AND writeback_job_id IS NOT NULL)
    OR (decision='REJECT' AND matter_id IS NULL AND writeback_job_id IS NULL))
);
CREATE FUNCTION public.check_domain_review_decision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.actors a JOIN public.tenants t ON t.id=a.tenant_id WHERE a.tenant_id=NEW.tenant_id
    AND a.id=NEW.decided_by AND a.actor_type='USER' AND a.status='ACTIVE' AND t.status='ACTIVE') THEN
    RAISE EXCEPTION 'review decision requires an active user';
  END IF;
  IF NEW.decision='APPROVE' AND NOT EXISTS(SELECT 1 FROM public.matters m WHERE m.tenant_id=NEW.tenant_id AND m.id=NEW.matter_id AND m.status='OPEN') THEN
    RAISE EXCEPTION 'approval requires a visible open matter';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.inbound_events e WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.event_id
    AND e.status=CASE NEW.decision WHEN 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END) THEN
    RAISE EXCEPTION 'review decision requires its atomic event transition';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER domain_review_decision_binding AFTER INSERT ON public.domain_review_decisions DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_domain_review_decision();
CREATE FUNCTION public.check_inbound_review_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF pg_has_role(current_user,'legaltech_domain_reviewer','MEMBER') AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status<>'PROCESSED' OR NEW.status NOT IN ('APPROVED','REJECTED') OR NOT EXISTS(SELECT 1 FROM public.domain_review_decisions d
      WHERE d.tenant_id=OLD.tenant_id AND d.event_id=OLD.id AND d.decided_by=public.app_current_actor_id()
        AND d.decision=CASE NEW.status WHEN 'APPROVED' THEN 'APPROVE' ELSE 'REJECT' END) THEN
      RAISE EXCEPTION 'inbound review transition requires its decision';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER inbound_review_transition BEFORE UPDATE OF status ON public.inbound_events FOR EACH ROW EXECUTE FUNCTION public.check_inbound_review_transition();
ALTER TABLE public.domain_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_review_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_review_read ON public.domain_review_decisions FOR SELECT TO legaltech_domain_reviewer USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY domain_review_append ON public.domain_review_decisions FOR INSERT TO legaltech_domain_reviewer
  WITH CHECK(tenant_id=public.app_current_tenant_id() AND decided_by=public.app_current_actor_id());
-- The reviewer reads the adopted result it binds to; it can never write one.
CREATE POLICY domain_result_review_read ON public.domain_job_results FOR SELECT TO legaltech_domain_reviewer USING(tenant_id=public.app_current_tenant_id());
REVOKE ALL ON public.domain_review_decisions FROM PUBLIC;
GRANT SELECT ON public.domain_review_decisions TO legaltech_domain_reviewer;
GRANT INSERT(tenant_id,event_id,result_job_id,result_hash,decision,matter_id,decided_by,decision_key_hash,request_hash,writeback_job_id)
  ON public.domain_review_decisions TO legaltech_domain_reviewer;
GRANT SELECT ON public.domain_job_results TO legaltech_domain_reviewer;
GRANT UPDATE(status) ON public.inbound_events TO legaltech_domain_reviewer;
COMMIT;
