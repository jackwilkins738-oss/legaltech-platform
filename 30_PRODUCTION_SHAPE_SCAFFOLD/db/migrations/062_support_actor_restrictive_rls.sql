BEGIN;
CREATE POLICY support_actor_request_guard ON public.support_access_requests AS RESTRICTIVE FOR INSERT TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND requester_id=public.app_current_actor_id());
CREATE POLICY support_actor_approval_guard ON public.support_access_approvals AS RESTRICTIVE FOR INSERT TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND approver_id=public.app_current_actor_id());
CREATE POLICY support_actor_revocation_guard ON public.support_access_revocations AS RESTRICTIVE FOR INSERT TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND revoked_by=public.app_current_actor_id());
CREATE POLICY support_actor_event_guard ON public.support_access_events AS RESTRICTIVE FOR INSERT TO legaltech_support_operator WITH CHECK (tenant_id=public.app_current_tenant_id() AND actor_id=public.app_current_actor_id());
COMMIT;
