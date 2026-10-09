BEGIN;

-- V71: generic trusted TEAM/POOL directory. No firm-specific group names,
-- management hierarchy or routing semantics are installed here.
CREATE TABLE org_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  group_kind text NOT NULL CHECK (group_kind IN ('TEAM','POOL')),
  group_ref text NOT NULL CHECK (group_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_by uuid,
  retired_at timestamptz,
  retire_reason text,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,group_kind,group_ref),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,retired_by) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_org_groups_lookup ON org_groups(tenant_id,group_kind,group_ref,status);

CREATE TABLE org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  group_kind text NOT NULL CHECK (group_kind IN ('TEAM','POOL')),
  group_ref text NOT NULL,
  actor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,group_kind,group_ref) REFERENCES org_groups(tenant_id,group_kind,group_ref),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id),
  FOREIGN KEY (tenant_id,revoked_by) REFERENCES actors(tenant_id,id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX idx_org_memberships_actor ON org_memberships(tenant_id,actor_id,status,starts_at,ends_at);
CREATE INDEX idx_org_memberships_group ON org_memberships(tenant_id,group_kind,group_ref,status,starts_at,ends_at);

CREATE TABLE org_directory_events (
  id bigserial PRIMARY KEY,
  event_uuid uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL CHECK (subject_type IN ('GROUP','MEMBERSHIP')),
  subject_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('GROUP_REGISTERED','GROUP_RETIRED','MEMBERSHIP_GRANTED','MEMBERSHIP_REVOKED')),
  actor_id uuid NOT NULL,
  trace_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_org_directory_events_subject ON org_directory_events(tenant_id,subject_type,subject_id,id);

ALTER TABLE org_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE org_directory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_directory_events FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_org_groups ON org_groups
  USING (tenant_id=app_current_tenant_id())
  WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_org_memberships ON org_memberships
  USING (tenant_id=app_current_tenant_id())
  WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_org_directory_events_read ON org_directory_events FOR SELECT
  USING (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_org_directory_events_insert ON org_directory_events FOR INSERT
  WITH CHECK (tenant_id=app_current_tenant_id());

CREATE OR REPLACE FUNCTION protect_org_group_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.group_kind IS DISTINCT FROM OLD.group_kind OR NEW.group_ref IS DISTINCT FROM OLD.group_ref OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.version <> OLD.version + 1 OR NOT (OLD.status='ACTIVE' AND NEW.status='RETIRED') THEN
    RAISE EXCEPTION 'organisation group transition invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER org_group_transition_guard BEFORE UPDATE ON org_groups
FOR EACH ROW EXECUTE FUNCTION protect_org_group_transition();

CREATE OR REPLACE FUNCTION protect_org_membership_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM org_groups g WHERE g.tenant_id=NEW.tenant_id AND g.group_kind=NEW.group_kind AND g.group_ref=NEW.group_ref AND g.status='ACTIVE') THEN
    RAISE EXCEPTION 'organisation group unavailable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM org_memberships m
    WHERE m.tenant_id=NEW.tenant_id AND m.group_kind=NEW.group_kind AND m.group_ref=NEW.group_ref AND m.actor_id=NEW.actor_id AND m.status='ACTIVE'
      AND tstzrange(m.starts_at,COALESCE(m.ends_at,'infinity'::timestamptz),'[)') && tstzrange(NEW.starts_at,COALESCE(NEW.ends_at,'infinity'::timestamptz),'[)')
  ) THEN RAISE EXCEPTION 'organisation membership overlap'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER org_membership_insert_guard BEFORE INSERT ON org_memberships
FOR EACH ROW EXECUTE FUNCTION protect_org_membership_insert();

CREATE OR REPLACE FUNCTION protect_org_membership_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.group_kind IS DISTINCT FROM OLD.group_kind OR NEW.group_ref IS DISTINCT FROM OLD.group_ref OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.version <> OLD.version + 1 OR NOT (OLD.status='ACTIVE' AND NEW.status='REVOKED') THEN
    RAISE EXCEPTION 'organisation membership transition invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER org_membership_transition_guard BEFORE UPDATE ON org_memberships
FOR EACH ROW EXECUTE FUNCTION protect_org_membership_transition();

CREATE OR REPLACE FUNCTION deny_org_directory_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'organisation directory events are append-only'; END; $$;
CREATE TRIGGER org_directory_events_append_only BEFORE UPDATE OR DELETE ON org_directory_events
FOR EACH ROW EXECUTE FUNCTION deny_org_directory_event_mutation();

COMMIT;
