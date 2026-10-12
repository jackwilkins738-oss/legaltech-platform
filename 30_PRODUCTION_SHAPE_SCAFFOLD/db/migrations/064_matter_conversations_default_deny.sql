BEGIN;
-- V204: dormant durable conversation schema. No application-role grants or endpoints.
-- Production activation requires transactional auth, live directory resolution, and revocation fencing.
CREATE TABLE public.matter_conversation_threads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 matter_id uuid NOT NULL REFERENCES public.matters(id),
 creator_actor_id uuid NOT NULL REFERENCES public.actors(id),
 subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
 revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(tenant_id,id)
);
CREATE TABLE public.matter_conversation_participants (
 tenant_id uuid NOT NULL,
 thread_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.actors(id),
 added_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 revoked_at timestamptz,
 PRIMARY KEY(tenant_id,thread_id,actor_id),
 FOREIGN KEY(tenant_id,thread_id) REFERENCES public.matter_conversation_threads(tenant_id,id)
);
CREATE TABLE public.matter_conversation_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 thread_id uuid NOT NULL,
 author_actor_id uuid NOT NULL REFERENCES public.actors(id),
 request_id text,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(tenant_id,thread_id) REFERENCES public.matter_conversation_threads(tenant_id,id),
 UNIQUE(tenant_id,thread_id,author_actor_id,request_id)
);
CREATE TABLE public.matter_conversation_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL,
 thread_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.actors(id),
 revision bigint NOT NULL CHECK(revision>=1),
 kind text NOT NULL CHECK(kind IN ('CREATED','MESSAGE_POSTED','PARTICIPANTS_CHANGED')),
 occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 FOREIGN KEY(tenant_id,thread_id) REFERENCES public.matter_conversation_threads(tenant_id,id),
 UNIQUE(tenant_id,thread_id,revision)
);
CREATE INDEX matter_conversation_threads_matter ON public.matter_conversation_threads(tenant_id,matter_id,created_at);
CREATE INDEX matter_conversation_messages_thread ON public.matter_conversation_messages(tenant_id,thread_id,created_at,id);
CREATE INDEX matter_conversation_participants_actor ON public.matter_conversation_participants(tenant_id,actor_id,revoked_at);
CREATE INDEX matter_conversation_audit_thread ON public.matter_conversation_audit(tenant_id,thread_id,revision);
REVOKE ALL ON public.matter_conversation_threads,public.matter_conversation_participants,public.matter_conversation_messages,public.matter_conversation_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.matter_conversation_audit_id_seq FROM PUBLIC;
ALTER TABLE public.matter_conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_conversation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matter_conversation_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_conversation_participants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_conversation_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.matter_conversation_audit FORCE ROW LEVEL SECURITY;
-- Intentionally no policies: RLS default-deny, even when a later operator has privileges.
COMMIT;
