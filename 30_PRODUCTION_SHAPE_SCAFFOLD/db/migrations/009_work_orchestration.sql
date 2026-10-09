BEGIN;

-- V64: generic pre-TO work orchestration primitives. These deliberately avoid
-- practice-area or firm-specific workflow assumptions.
CREATE TABLE work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid,
  work_type text NOT NULL CHECK (work_type IN ('TASK','QUESTION','DECISION','REVIEW','APPROVAL','HANDOFF','ESCALATION')),
  state text NOT NULL DEFAULT 'READY' CHECK (state IN ('READY','IN_PROGRESS','WAITING_INTERNAL','WAITING_EXTERNAL','BLOCKED','REVIEW','COMPLETED','CANCELLED')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  description text,
  requester_actor_id uuid NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('USER','ROLE','TEAM','POOL')),
  owner_actor_id uuid,
  owner_ref text,
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  due_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  waiting_since timestamptz,
  reactivated_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  response jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,requester_actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,owner_actor_id) REFERENCES actors(tenant_id,id),
  CHECK ((owner_kind='USER' AND owner_actor_id IS NOT NULL AND owner_ref IS NULL) OR (owner_kind<>'USER' AND owner_actor_id IS NULL AND owner_ref IS NOT NULL))
);
CREATE INDEX idx_work_queue ON work_items(tenant_id,state,owner_kind,priority DESC,due_at);
CREATE INDEX idx_work_matter ON work_items(tenant_id,matter_id,state);

CREATE TABLE work_dependencies (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_id uuid NOT NULL,
  depends_on_work_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RESOLVED')),
  created_by uuid NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY (tenant_id,work_id,depends_on_work_id),
  FOREIGN KEY (tenant_id,work_id) REFERENCES work_items(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,depends_on_work_id) REFERENCES work_items(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  CHECK (work_id <> depends_on_work_id)
);
CREATE INDEX idx_work_dependencies_blocker ON work_dependencies(tenant_id,depends_on_work_id,status);

CREATE TABLE work_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_id uuid NOT NULL,
  matter_id uuid,
  event_type text NOT NULL,
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,work_id) REFERENCES work_items(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,matter_id) REFERENCES matters(tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_work_events_work ON work_events(tenant_id,work_id,id);

ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items FORCE ROW LEVEL SECURITY;
ALTER TABLE work_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE work_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_and_matter_work_items ON work_items
  USING (tenant_id=app_current_tenant_id() AND (matter_id IS NULL OR EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id=work_items.tenant_id AND m.id=work_items.matter_id)))
  WITH CHECK (tenant_id=app_current_tenant_id() AND (matter_id IS NULL OR EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id=work_items.tenant_id AND m.id=work_items.matter_id)));
CREATE POLICY tenant_work_dependencies ON work_dependencies
  USING (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM work_items w WHERE w.tenant_id=work_dependencies.tenant_id AND w.id=work_dependencies.work_id))
  WITH CHECK (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM work_items w WHERE w.tenant_id=work_dependencies.tenant_id AND w.id=work_dependencies.work_id) AND EXISTS (SELECT 1 FROM work_items b WHERE b.tenant_id=work_dependencies.tenant_id AND b.id=work_dependencies.depends_on_work_id));
CREATE POLICY tenant_work_events_read ON work_events FOR SELECT
  USING (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM work_items w WHERE w.tenant_id=work_events.tenant_id AND w.id=work_events.work_id));
CREATE POLICY tenant_work_events_insert ON work_events FOR INSERT
  WITH CHECK (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM work_items w WHERE w.tenant_id=work_events.tenant_id AND w.id=work_events.work_id));

CREATE OR REPLACE FUNCTION deny_work_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'work_events are append-only'; END; $$;
CREATE TRIGGER work_events_append_only BEFORE UPDATE OR DELETE ON work_events
FOR EACH ROW EXECUTE FUNCTION deny_work_event_mutation();

COMMIT;
