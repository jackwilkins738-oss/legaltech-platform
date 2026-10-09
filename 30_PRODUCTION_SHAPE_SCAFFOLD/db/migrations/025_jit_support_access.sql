BEGIN;

-- V88: just-in-time support access. These tables contain approval/evidence metadata
-- only; no client payload, raw ticket identifier, support rationale or credential material.
CREATE TABLE support_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  requester_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ')),
  document_ref_hash char(64),
  ticket_ref_hash char(64) NOT NULL CHECK (ticket_ref_hash ~ '^[a-f0-9]{64}$'),
  purpose_hash char(64) NOT NULL CHECK (purpose_hash ~ '^[a-f0-9]{64}$'),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (tenant_id,requester_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  UNIQUE (tenant_id,id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  CHECK ((scope='DOCUMENT_READ' AND document_ref_hash ~ '^[a-f0-9]{64}$') OR (scope<>'DOCUMENT_READ' AND document_ref_hash IS NULL))
);
CREATE INDEX idx_support_access_requests_actor ON support_access_requests(tenant_id,requester_id,expires_at DESC);
CREATE INDEX idx_support_access_requests_matter ON support_access_requests(tenant_id,matter_id,expires_at DESC);

CREATE TABLE support_access_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  approver_id uuid NOT NULL,
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  approved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,request_id) REFERENCES support_access_requests(tenant_id,id),
  FOREIGN KEY (tenant_id,approver_id) REFERENCES actors(tenant_id,id),
  UNIQUE (tenant_id,request_id)
);

CREATE TABLE support_access_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  revoked_by uuid NOT NULL,
  reason_hash char(64) NOT NULL CHECK (reason_hash ~ '^[a-f0-9]{64}$'),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  revoked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,request_id) REFERENCES support_access_requests(tenant_id,id),
  FOREIGN KEY (tenant_id,revoked_by) REFERENCES actors(tenant_id,id),
  UNIQUE (tenant_id,request_id)
);

CREATE TABLE support_access_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  matter_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('REQUESTED','APPROVED','REVOKED','MATTER_READ','DOCUMENT_READ','DIAGNOSTIC_READ','DENIED')),
  resource_hash char(64),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 256),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,request_id) REFERENCES support_access_requests(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  CHECK (resource_hash IS NULL OR resource_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX idx_support_access_events ON support_access_events(tenant_id,request_id,id);

ALTER TABLE support_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE support_access_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE support_access_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_revocations FORCE ROW LEVEL SECURITY;
ALTER TABLE support_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_access_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_support_access_request_read ON support_access_requests FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_access_request_insert ON support_access_requests FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_access_approval_read ON support_access_approvals FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_access_approval_insert ON support_access_approvals FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_access_revocation_read ON support_access_revocations FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_access_revocation_insert ON support_access_revocations FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_access_event_read ON support_access_events FOR SELECT USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_support_access_event_insert ON support_access_events FOR INSERT WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION enforce_support_access_dual_control() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS (SELECT 1 FROM support_access_requests r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.request_id AND r.requester_id=NEW.approver_id) THEN
    RAISE EXCEPTION 'support access dual control required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM support_access_requests r WHERE r.tenant_id=NEW.tenant_id AND r.id=NEW.request_id AND NEW.approved_at < r.expires_at) THEN
    RAISE EXCEPTION 'support access request expired';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER support_access_dual_control BEFORE INSERT ON support_access_approvals FOR EACH ROW EXECUTE FUNCTION enforce_support_access_dual_control();

CREATE OR REPLACE FUNCTION deny_support_access_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'support access evidence is append-only'; END; $$;
CREATE TRIGGER support_access_requests_append_only BEFORE UPDATE OR DELETE ON support_access_requests FOR EACH ROW EXECUTE FUNCTION deny_support_access_evidence_mutation();
CREATE TRIGGER support_access_approvals_append_only BEFORE UPDATE OR DELETE ON support_access_approvals FOR EACH ROW EXECUTE FUNCTION deny_support_access_evidence_mutation();
CREATE TRIGGER support_access_revocations_append_only BEFORE UPDATE OR DELETE ON support_access_revocations FOR EACH ROW EXECUTE FUNCTION deny_support_access_evidence_mutation();
CREATE TRIGGER support_access_events_append_only BEFORE UPDATE OR DELETE ON support_access_events FOR EACH ROW EXECUTE FUNCTION deny_support_access_evidence_mutation();

COMMIT;
