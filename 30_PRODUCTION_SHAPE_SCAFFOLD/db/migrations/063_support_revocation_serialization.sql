BEGIN;
-- Serialize every support revocation insert against an in-progress
-- transaction-held document transfer using the established advisory key.
CREATE FUNCTION public.support_revocation_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    '["' || NEW.tenant_id::text || '","' || NEW.request_id::text || '"]',0));
  RETURN NEW;
END; $$;
CREATE TRIGGER support_revocation_serialization
  BEFORE INSERT ON public.support_access_revocations
  FOR EACH ROW EXECUTE FUNCTION public.support_revocation_lock_guard();
COMMIT;
