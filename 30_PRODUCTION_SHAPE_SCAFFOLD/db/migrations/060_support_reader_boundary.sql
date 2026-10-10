BEGIN;
-- V151: dedicated read-only support grant verifier; existing V88 tables are
-- metadata-only, RLS-forced, and accessed through the tenant GUC.
CREATE ROLE legaltech_support_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO legaltech_support_reader;
GRANT SELECT (id,tenant_id,requester_id,matter_id,scope,document_ref_hash,created_at,expires_at)
  ON public.support_access_requests TO legaltech_support_reader;
GRANT SELECT (tenant_id,request_id,approved_at)
  ON public.support_access_approvals TO legaltech_support_reader;
GRANT SELECT (tenant_id,request_id)
  ON public.support_access_revocations TO legaltech_support_reader;
-- Explicit role policy supplements V88's existing RLS tenant policies.
CREATE POLICY support_grant_role_requests ON public.support_access_requests
  FOR SELECT TO legaltech_support_reader USING (tenant_id=public.app_current_tenant_id());
CREATE POLICY support_grant_role_approvals ON public.support_access_approvals
  FOR SELECT TO legaltech_support_reader USING (tenant_id=public.app_current_tenant_id());
CREATE POLICY support_grant_role_revocations ON public.support_access_revocations
  FOR SELECT TO legaltech_support_reader USING (tenant_id=public.app_current_tenant_id());
COMMIT;
