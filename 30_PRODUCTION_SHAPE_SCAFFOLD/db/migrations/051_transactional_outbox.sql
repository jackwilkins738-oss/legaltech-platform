BEGIN;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['legaltech_outbox_writer','legaltech_outbox_relay'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',name);
    ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=name AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'unsafe outbox group';
    END IF;
  END LOOP;
END; $$;
GRANT USAGE ON SCHEMA public TO legaltech_outbox_writer,legaltech_outbox_relay;
-- Invoker function; no privileged access or alternate domain access path.
CREATE FUNCTION public.valid_job_intent(body text,expected_hash text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE j jsonb; k text; lo integer; hi integer; canonical text;
BEGIN
  IF body IS NULL OR octet_length(body)>2048 OR expected_hash IS NULL THEN RETURN false; END IF;
  j=body::jsonb;
  IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(j))<>11
    OR NOT j ?& ARRAY['tenantId','jobId','kind','objectId','traceHash','keyHash','maxAttempts','leaseMs','maxRunMs','delayMs','retryDelayMs'] THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['tenantId','jobId','objectId'] LOOP
    IF jsonb_typeof(j->k) IS DISTINCT FROM 'string' OR (j->>k)!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RETURN false; END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['traceHash','keyHash'] LOOP
    IF jsonb_typeof(j->k) IS DISTINCT FROM 'string' OR (j->>k)!~'^[a-f0-9]{64}$' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(j->'kind') IS DISTINCT FROM 'string' OR (j->>'kind') NOT IN ('PROCESS_INBOUND','POLICY_EVALUATION','PROCLAIM_WRITEBACK','NOTIFICATION_DELIVERY') THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['maxAttempts','leaseMs','maxRunMs','delayMs','retryDelayMs'] LOOP
    IF jsonb_typeof(j->k) IS DISTINCT FROM 'number' OR (j->>k)!~'^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
    lo=CASE k WHEN 'maxAttempts' THEN 1 WHEN 'leaseMs' THEN 5000 WHEN 'maxRunMs' THEN (j->>'leaseMs')::integer WHEN 'delayMs' THEN 0 ELSE 1000 END;
    hi=CASE k WHEN 'maxAttempts' THEN 10 WHEN 'leaseMs' THEN 300000 WHEN 'delayMs' THEN 86400000 ELSE 3600000 END;
    IF (j->>k)::integer NOT BETWEEN lo AND hi THEN RETURN false; END IF;
  END LOOP;
  SELECT '{'||string_agg(to_json(key)::text||':'||value::text,',' ORDER BY key COLLATE "C")||'}' INTO canonical FROM jsonb_each(j);
  RETURN body=canonical AND expected_hash=encode(public.digest(body,'sha256'),'hex');
EXCEPTION WHEN OTHERS THEN RETURN false;
END; $$;
CREATE TABLE public.domain_outbox_events (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id), job_id uuid NOT NULL,
  kind text NOT NULL, object_id uuid NOT NULL, key_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL, intent text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,job_id), UNIQUE(tenant_id,kind,key_hash), UNIQUE(tenant_id,job_id,request_hash),
  CHECK(public.valid_job_intent(intent,request_hash)),
  CHECK((intent::jsonb->>'tenantId')=tenant_id::text AND (intent::jsonb->>'jobId')=job_id::text
    AND (intent::jsonb->>'kind')=kind AND (intent::jsonb->>'objectId')=object_id::text AND (intent::jsonb->>'keyHash')=key_hash)
);
CREATE TABLE public.domain_outbox_receipts (
  tenant_id uuid NOT NULL, job_id uuid NOT NULL, request_hash char(64) NOT NULL,
  delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,job_id),
  FOREIGN KEY(tenant_id,job_id,request_hash) REFERENCES public.domain_outbox_events(tenant_id,job_id,request_hash)
);
CREATE INDEX idx_domain_outbox_pending ON public.domain_outbox_events(tenant_id,created_at,job_id);
ALTER TABLE public.domain_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.domain_outbox_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_outbox_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_read ON public.domain_outbox_events FOR SELECT TO legaltech_outbox_writer,legaltech_outbox_relay
  USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY outbox_events_append ON public.domain_outbox_events FOR INSERT TO legaltech_outbox_writer
  WITH CHECK(tenant_id=public.app_current_tenant_id());
CREATE POLICY outbox_receipts_read ON public.domain_outbox_receipts FOR SELECT TO legaltech_outbox_relay
  USING(tenant_id=public.app_current_tenant_id());
CREATE POLICY outbox_receipts_append ON public.domain_outbox_receipts FOR INSERT TO legaltech_outbox_relay
  WITH CHECK(tenant_id=public.app_current_tenant_id());
REVOKE ALL ON public.domain_outbox_events,public.domain_outbox_receipts FROM PUBLIC;
GRANT SELECT ON public.domain_outbox_events TO legaltech_outbox_writer,legaltech_outbox_relay;
GRANT INSERT(tenant_id,job_id,kind,object_id,key_hash,request_hash,intent) ON public.domain_outbox_events TO legaltech_outbox_writer;
GRANT SELECT ON public.domain_outbox_receipts TO legaltech_outbox_relay;
GRANT INSERT(tenant_id,job_id,request_hash) ON public.domain_outbox_receipts TO legaltech_outbox_relay;
COMMIT;
