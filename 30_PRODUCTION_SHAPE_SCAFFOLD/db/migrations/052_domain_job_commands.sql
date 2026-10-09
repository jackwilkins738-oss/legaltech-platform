BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_domain_commands') THEN
    CREATE ROLE legaltech_domain_commands NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='legaltech_domain_commands'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'unsafe domain command group';
  END IF;
END; $$;
GRANT USAGE ON SCHEMA public TO legaltech_domain_commands;
ALTER TABLE public.domain_outbox_events ADD CONSTRAINT uq_outbox_domain_binding UNIQUE(tenant_id,job_id,kind,object_id);
CREATE TABLE public.domain_job_commands (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id), command_id uuid NOT NULL,
  actor_id uuid NOT NULL, job_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('PROCESS_INBOUND','POLICY_EVALUATION')),
  object_id uuid NOT NULL, inbound_event_id uuid, matter_id uuid,
  payload_id uuid, payload_hash char(64) CHECK(payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$'), source_hash char(64),
  policy_version_id uuid, policy_version_hash char(64) CHECK(policy_version_hash IS NULL OR policy_version_hash ~ '^[a-f0-9]{64}$'),
  trace_hash char(64) NOT NULL CHECK(trace_hash ~ '^[a-f0-9]{64}$'),
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  intent_hash char(64) NOT NULL CHECK(intent_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,command_id), UNIQUE(tenant_id,job_id),
  FOREIGN KEY(tenant_id,actor_id) REFERENCES public.actors(tenant_id,id),
  FOREIGN KEY(tenant_id,inbound_event_id) REFERENCES public.inbound_events(tenant_id,id),
  FOREIGN KEY(tenant_id,matter_id) REFERENCES public.matters(tenant_id,id),
  FOREIGN KEY(tenant_id,job_id,intent_hash) REFERENCES public.domain_outbox_events(tenant_id,job_id,request_hash) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(tenant_id,job_id,kind,object_id) REFERENCES public.domain_outbox_events(tenant_id,job_id,kind,object_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK((kind='PROCESS_INBOUND' AND inbound_event_id IS NOT NULL AND object_id=inbound_event_id AND payload_id IS NOT NULL
      AND payload_hash IS NOT NULL AND source_hash IS NOT NULL AND source_hash ~ '^[a-f0-9]{64}$' AND matter_id IS NULL AND policy_version_id IS NULL AND policy_version_hash IS NULL)
    OR (kind='POLICY_EVALUATION' AND matter_id IS NOT NULL AND object_id=matter_id AND policy_version_id IS NOT NULL AND policy_version_hash IS NOT NULL
      AND inbound_event_id IS NULL AND payload_id IS NULL AND payload_hash IS NULL AND source_hash IS NULL))
);
ALTER TABLE public.domain_job_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_job_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY domain_command_read ON public.domain_job_commands FOR SELECT TO legaltech_domain_commands
  USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY domain_command_append ON public.domain_job_commands FOR INSERT TO legaltech_domain_commands
  WITH CHECK(tenant_id=public.app_current_tenant_id() AND actor_id=NULLIF(current_setting('app.actor_id',true),'')::uuid);
REVOKE ALL ON public.domain_job_commands FROM PUBLIC;
GRANT SELECT ON public.domain_job_commands TO legaltech_domain_commands;
GRANT INSERT(tenant_id,command_id,actor_id,job_id,kind,object_id,inbound_event_id,matter_id,payload_id,payload_hash,source_hash,policy_version_id,policy_version_hash,trace_hash,request_hash,intent_hash)
  ON public.domain_job_commands TO legaltech_domain_commands;
COMMIT;
