BEGIN;

-- V86: individual document delivery grants are short-lived, actor/matter bound and
-- single-use. Raw object-storage references and grant tokens are deliberately absent.
CREATE TABLE document_delivery_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  document_ref_hash char(64) NOT NULL CHECK (document_ref_hash ~ '^[a-f0-9]{64}$'),
  document_binding_hash char(64) NOT NULL CHECK (document_binding_hash ~ '^[a-f0-9]{64}$'),
  token_hash char(64) NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,token_hash),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes')
);
CREATE INDEX idx_document_delivery_actor ON document_delivery_grants(tenant_id,actor_id,issued_at DESC);
CREATE INDEX idx_document_delivery_matter ON document_delivery_grants(tenant_id,matter_id,issued_at DESC);

CREATE TABLE document_delivery_consumptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,grant_id) REFERENCES document_delivery_grants(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id),
  UNIQUE (tenant_id,grant_id),
  UNIQUE (tenant_id,id)
);

CREATE TABLE document_delivery_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  grant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('GRANT_ISSUED','DELIVERED','FAILED','EXPIRED','DENIED')),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,grant_id) REFERENCES document_delivery_grants(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id)
);
CREATE INDEX idx_document_delivery_events ON document_delivery_events(tenant_id,grant_id,id);

ALTER TABLE document_delivery_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery_consumptions FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_document_delivery_grant_read ON document_delivery_grants FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_document_delivery_grant_insert ON document_delivery_grants FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_document_delivery_consumption_read ON document_delivery_consumptions FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_document_delivery_consumption_insert ON document_delivery_consumptions FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_document_delivery_event_read ON document_delivery_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_document_delivery_event_insert ON document_delivery_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION deny_document_delivery_grant_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'document delivery grants are immutable'; END; $$;
CREATE TRIGGER document_delivery_grants_immutable BEFORE UPDATE OR DELETE ON document_delivery_grants FOR EACH ROW EXECUTE FUNCTION deny_document_delivery_grant_mutation();
CREATE OR REPLACE FUNCTION deny_document_delivery_consumption_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'document delivery consumptions are immutable'; END; $$;
CREATE TRIGGER document_delivery_consumptions_immutable BEFORE UPDATE OR DELETE ON document_delivery_consumptions FOR EACH ROW EXECUTE FUNCTION deny_document_delivery_consumption_mutation();
CREATE OR REPLACE FUNCTION deny_document_delivery_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'document delivery events are append-only'; END; $$;
CREATE TRIGGER document_delivery_events_append_only BEFORE UPDATE OR DELETE ON document_delivery_events FOR EACH ROW EXECUTE FUNCTION deny_document_delivery_event_mutation();

COMMIT;
