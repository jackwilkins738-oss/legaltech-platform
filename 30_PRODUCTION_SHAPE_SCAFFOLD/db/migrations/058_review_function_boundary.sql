BEGIN;
-- V133: review trigger entry points are never a caller-executable API.
REVOKE ALL ON FUNCTION public.check_domain_review_decision() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_inbound_review_transition() FROM PUBLIC;
-- Read-only reviewers cannot acquire row locks directly without UPDATE rights.
-- This one bounded function locks only their GUC-bound active human/tenant and
-- optionally an open matter. It exposes no arbitrary SQL, data or mutation.
CREATE SCHEMA review_security;
REVOKE ALL ON SCHEMA review_security FROM PUBLIC;
GRANT USAGE ON SCHEMA review_security TO legaltech_domain_reviewer;
CREATE FUNCTION review_security.lock_scope(tenant uuid,actor uuid,matter uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $$
BEGIN
  IF NOT pg_catalog.pg_has_role(session_user,'legaltech_domain_reviewer','MEMBER')
    OR tenant IS NULL OR actor IS NULL
    OR tenant IS DISTINCT FROM public.app_current_tenant_id()
    OR actor IS DISTINCT FROM public.app_current_actor_id() THEN
    RAISE EXCEPTION 'review scope forbidden';
  END IF;
  PERFORM 1 FROM public.actors a JOIN public.tenants t ON t.id=a.tenant_id
    WHERE a.tenant_id=tenant AND a.id=actor AND a.actor_type='USER'
      AND a.status='ACTIVE' AND t.status='ACTIVE' FOR SHARE OF a,t;
  IF NOT FOUND THEN RETURN false; END IF;
  IF matter IS NOT NULL THEN
    PERFORM 1 FROM public.matters m WHERE m.tenant_id=tenant AND m.id=matter AND m.status='OPEN' FOR SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
  END IF;
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION review_security.lock_scope(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_security.lock_scope(uuid,uuid,uuid) TO legaltech_domain_reviewer;
COMMIT;
