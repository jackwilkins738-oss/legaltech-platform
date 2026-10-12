BEGIN;
-- Never permit later permissive policies to override the dormant default-deny boundary.
DROP POLICY matter_conversation_threads_deny ON public.matter_conversation_threads;
CREATE POLICY matter_conversation_threads_deny ON public.matter_conversation_threads AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY matter_conversation_participants_deny ON public.matter_conversation_participants;
CREATE POLICY matter_conversation_participants_deny ON public.matter_conversation_participants AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY matter_conversation_messages_deny ON public.matter_conversation_messages;
CREATE POLICY matter_conversation_messages_deny ON public.matter_conversation_messages AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY matter_conversation_audit_deny ON public.matter_conversation_audit;
CREATE POLICY matter_conversation_audit_deny ON public.matter_conversation_audit AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
COMMIT;
