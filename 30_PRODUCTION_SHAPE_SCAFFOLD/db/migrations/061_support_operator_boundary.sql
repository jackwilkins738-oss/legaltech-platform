BEGIN;
-- V154: dedicated append-only support grant operator. No UPDATE, DELETE, TRUNCATE or audit reads.
CREATE ROLE legaltech_support_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO legaltech_support_operator;
GRANT SELECT (id,tenant_id,requester_id,matter_id,scope,document_ref_hash,expires_at)
  ON public.support_access_requests TO legaltech_support_operator;
GRANT INSERT (id,tenant_id,requester_id,matter_id,scope,document_ref_hash,ticket_ref_hash,purpose_hash,trace_id,expires_at)
  ON public.support_access_requests TO legaltech_support_operator;
GRANT SELECT (tenant_id,request_id) ON public.support_access_approvals TO legaltech_support_operator;
GRANT INSERT (tenant_id,request_id,approver_id,trace_id) ON public.support_access_approvals TO legaltech_support_operator;
GRANT SELECT (tenant_id,request_id) ON public.support_access_revocations TO legaltech_support_operator;
GRANT INSERT (tenant_id,request_id,revoked_by,reason_hash,trace_id) ON public.support_access_revocations TO legaltech_support_operator;
GRANT INSERT (tenant_id,request_id,actor_id,matter_id,event_type,resource_hash,trace_id)
  ON public.support_access_events TO legaltech_support_operator;
GRANT USAGE ON SEQUENCE public.support_access_events_id_seq TO legaltech_support_operator;
CREATE POLICY support_operator_request_read ON public.support_access_requests FOR SELECT
  TO legaltech_support_operator USING (tenant_id=public.app_current_tenant_id());
CREATE POLICY support_operator_request_insert ON public.support_access_requests FOR INSERT
  TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND requester_id=public.app_current_actor_id());
CREATE POLICY support_operator_approval_read ON public.support_access_approvals FOR SELECT
  TO legaltech_support_operator USING (tenant_id=public.app_current_tenant_id());
CREATE POLICY support_operator_approval_insert ON public.support_access_approvals FOR INSERT
  TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND approver_id=public.app_current_actor_id());
CREATE POLICY support_operator_revocation_read ON public.support_access_revocations FOR SELECT
  TO legaltech_support_operator USING (tenant_id=public.app_current_tenant_id());
CREATE POLICY support_operator_revocation_insert ON public.support_access_revocations FOR INSERT
  TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND revoked_by=public.app_current_actor_id());
CREATE POLICY support_operator_event_insert ON public.support_access_events FOR INSERT
  TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND actor_id=public.app_current_actor_id());
COMMIT;
