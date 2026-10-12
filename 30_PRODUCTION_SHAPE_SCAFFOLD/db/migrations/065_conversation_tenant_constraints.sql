BEGIN;
-- Tenant-consistent foreign keys: existence alone is insufficient for an eventual writer.
CREATE UNIQUE INDEX actors_tenant_id_id_for_conversations ON public.actors(tenant_id,id);
CREATE UNIQUE INDEX matters_tenant_id_id_for_conversations ON public.matters(tenant_id,id);
ALTER TABLE public.matter_conversation_threads
  ADD CONSTRAINT conversation_thread_matter_tenant_fk FOREIGN KEY (tenant_id,matter_id) REFERENCES public.matters(tenant_id,id),
  ADD CONSTRAINT conversation_thread_creator_tenant_fk FOREIGN KEY (tenant_id,creator_actor_id) REFERENCES public.actors(tenant_id,id);
ALTER TABLE public.matter_conversation_participants
  ADD CONSTRAINT conversation_participant_actor_tenant_fk FOREIGN KEY (tenant_id,actor_id) REFERENCES public.actors(tenant_id,id);
ALTER TABLE public.matter_conversation_messages
  ADD CONSTRAINT conversation_message_author_tenant_fk FOREIGN KEY (tenant_id,author_actor_id) REFERENCES public.actors(tenant_id,id);
ALTER TABLE public.matter_conversation_audit
  ADD CONSTRAINT conversation_audit_actor_tenant_fk FOREIGN KEY (tenant_id,actor_id) REFERENCES public.actors(tenant_id,id);
-- Immutable evidence and messages: even future accidental DML grants must not silently erase history.
CREATE FUNCTION public.conversation_immutable_record_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'CONVERSATION_IMMUTABLE_RECORD';
END;
$$;
REVOKE ALL ON FUNCTION public.conversation_immutable_record_guard() FROM PUBLIC;
CREATE TRIGGER conversation_message_immutable BEFORE UPDATE OR DELETE ON public.matter_conversation_messages
  FOR EACH ROW EXECUTE FUNCTION public.conversation_immutable_record_guard();
CREATE TRIGGER conversation_audit_immutable BEFORE UPDATE OR DELETE ON public.matter_conversation_audit
  FOR EACH ROW EXECUTE FUNCTION public.conversation_immutable_record_guard();
COMMIT;
