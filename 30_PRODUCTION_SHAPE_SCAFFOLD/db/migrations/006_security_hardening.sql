BEGIN;

-- V58: database-level defence in depth. Application authorization remains mandatory.
-- Composite tenant keys make it structurally impossible for a tenant-owned row to
-- reference another tenant's matter, actor, event or security zone.
ALTER TABLE actors ADD CONSTRAINT uq_actors_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE matters ADD CONSTRAINT uq_matters_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE inbound_events ADD CONSTRAINT uq_inbound_events_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE security_zones ADD CONSTRAINT uq_security_zones_tenant_id UNIQUE (tenant_id, id);

ALTER TABLE external_mappings
  ADD CONSTRAINT fk_external_mappings_matter_tenant
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE exceptions
  ADD CONSTRAINT fk_exceptions_matter_tenant
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters(tenant_id, id),
  ADD CONSTRAINT fk_exceptions_event_tenant
  FOREIGN KEY (tenant_id, source_event_id) REFERENCES inbound_events(tenant_id, id),
  ADD CONSTRAINT fk_exceptions_actor_tenant
  FOREIGN KEY (tenant_id, assigned_actor_id) REFERENCES actors(tenant_id, id);

ALTER TABLE audit_events
  ADD CONSTRAINT fk_audit_actor_tenant
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actors(tenant_id, id),
  ADD CONSTRAINT fk_audit_matter_tenant
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters(tenant_id, id);

ALTER TABLE actor_security_zones
  ADD CONSTRAINT fk_actor_security_zones_actor_tenant
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actors(tenant_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_actor_security_zones_zone_tenant
  FOREIGN KEY (tenant_id, security_zone_id) REFERENCES security_zones(tenant_id, id) ON DELETE CASCADE;

ALTER TABLE matters
  ADD CONSTRAINT fk_matters_security_zone_tenant
  FOREIGN KEY (tenant_id, security_zone_id) REFERENCES security_zones(tenant_id, id),
  ADD COLUMN visibility text NOT NULL DEFAULT 'STANDARD'
    CHECK (visibility IN ('STANDARD','TEAM_RESTRICTED','PRIVATE','SECURITY_ZONE'));

-- Restricted-matter membership is explicit. Runtime actors may read their own grants,
-- but no runtime RLS policy grants insert/update/delete authority to these tables.
CREATE TABLE matter_actor_access (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  access_type text NOT NULL DEFAULT 'MEMBER' CHECK (access_type IN ('MEMBER','OWNER','REVIEWER')),
  expires_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, matter_id, actor_id),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actors(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approved_by) REFERENCES actors(tenant_id, id)
);

-- Emergency access is a first-class, short-lived, matter-bound record. Possessing an
-- application capability alone is never sufficient to bypass a barrier.
CREATE TABLE matter_break_glass_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  approved_by uuid NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 8 AND 500),
  step_up_verified boolean NOT NULL CHECK (step_up_verified = true),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '15 minutes'),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actors(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approved_by) REFERENCES actors(tenant_id, id),
  UNIQUE (tenant_id, id)
);

-- Documents may be more restricted than their parent matter. document_ref is an opaque
-- server-owned identifier; no client-provided path is trusted here.
CREATE TABLE document_security (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL,
  document_ref text NOT NULL CHECK (length(document_ref) BETWEEN 1 AND 512),
  mode text NOT NULL DEFAULT 'INHERIT' CHECK (mode IN ('INHERIT','RESTRICTED','PRIVILEGED','SECURITY_ZONE')),
  security_zone_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, document_ref),
  FOREIGN KEY (tenant_id, matter_id) REFERENCES matters(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, security_zone_id) REFERENCES security_zones(tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES actors(tenant_id, id)
);

CREATE TABLE document_actor_access (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  document_ref text NOT NULL,
  actor_id uuid NOT NULL,
  approved_by uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, document_ref, actor_id),
  FOREIGN KEY (tenant_id, document_ref) REFERENCES document_security(tenant_id, document_ref) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, actor_id) REFERENCES actors(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, approved_by) REFERENCES actors(tenant_id, id)
);

CREATE OR REPLACE FUNCTION app_current_actor_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;

ALTER TABLE matter_actor_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_actor_access FORCE ROW LEVEL SECURITY;
ALTER TABLE matter_break_glass_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_break_glass_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE document_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_security FORCE ROW LEVEL SECURITY;
ALTER TABLE document_actor_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_actor_access FORCE ROW LEVEL SECURITY;

CREATE POLICY matter_actor_access_self_read ON matter_actor_access
  FOR SELECT USING (
    tenant_id = app_current_tenant_id()
    AND actor_id = app_current_actor_id()
    AND (expires_at IS NULL OR expires_at > now())
  );

CREATE POLICY break_glass_self_read ON matter_break_glass_grants
  FOR SELECT USING (
    tenant_id = app_current_tenant_id()
    AND actor_id = app_current_actor_id()
    AND revoked_at IS NULL
    AND issued_at <= now()
    AND expires_at > now()
    AND step_up_verified = true
  );

-- Runtime users may inspect only their own security-zone membership. Grant/revoke paths
-- require a separately privileged database role because there is deliberately no write policy.
DROP POLICY IF EXISTS tenant_isolation_actor_security_zones ON actor_security_zones;
CREATE POLICY actor_security_zones_self_read ON actor_security_zones
  FOR SELECT USING (
    tenant_id = app_current_tenant_id()
    AND actor_id = app_current_actor_id()
  );

-- Restricted matters require both matter membership (where configured) and zone membership.
-- A valid break-glass record may bypass those two checks for the exact matter only.
DROP POLICY IF EXISTS tenant_isolation_matters ON matters;
CREATE POLICY tenant_and_effective_access_matters ON matters
  USING (
    tenant_id = app_current_tenant_id()
    AND (
      EXISTS (
        SELECT 1 FROM matter_break_glass_grants bg
        WHERE bg.tenant_id = matters.tenant_id
          AND bg.matter_id = matters.id
          AND bg.actor_id = app_current_actor_id()
          AND bg.step_up_verified = true
          AND bg.revoked_at IS NULL
          AND bg.issued_at <= now()
          AND bg.expires_at > now()
      )
      OR (
        (
          matters.visibility = 'STANDARD'
          OR EXISTS (
            SELECT 1 FROM matter_actor_access ma
            WHERE ma.tenant_id = matters.tenant_id
              AND ma.matter_id = matters.id
              AND ma.actor_id = app_current_actor_id()
              AND (ma.expires_at IS NULL OR ma.expires_at > now())
          )
        )
        AND (
          matters.security_zone_id IS NULL
          OR EXISTS (
            SELECT 1 FROM actor_security_zones az
            WHERE az.tenant_id = matters.tenant_id
              AND az.actor_id = app_current_actor_id()
              AND az.security_zone_id = matters.security_zone_id
          )
        )
      )
    )
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND (
      visibility = 'STANDARD'
      OR EXISTS (
        SELECT 1 FROM matter_actor_access ma
        WHERE ma.tenant_id = matters.tenant_id
          AND ma.matter_id = matters.id
          AND ma.actor_id = app_current_actor_id()
          AND (ma.expires_at IS NULL OR ma.expires_at > now())
      )
    )
    AND (
      security_zone_id IS NULL
      OR EXISTS (
        SELECT 1 FROM actor_security_zones az
        WHERE az.tenant_id = matters.tenant_id
          AND az.actor_id = app_current_actor_id()
          AND az.security_zone_id = matters.security_zone_id
      )
    )
  );

-- Rows that point at a matter inherit the matter visibility boundary. The composite
-- foreign keys above prevent cross-tenant references even if application code is wrong.
DROP POLICY IF EXISTS tenant_isolation_external_mappings ON external_mappings;
CREATE POLICY tenant_and_matter_isolation_external_mappings ON external_mappings
  USING (
    tenant_id = app_current_tenant_id()
    AND EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id = external_mappings.tenant_id AND m.id = external_mappings.matter_id)
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id = external_mappings.tenant_id AND m.id = external_mappings.matter_id)
  );

DROP POLICY IF EXISTS tenant_isolation_exceptions ON exceptions;
CREATE POLICY tenant_and_matter_isolation_exceptions ON exceptions
  USING (
    tenant_id = app_current_tenant_id()
    AND (matter_id IS NULL OR EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id = exceptions.tenant_id AND m.id = exceptions.matter_id))
  )
  WITH CHECK (
    tenant_id = app_current_tenant_id()
    AND (matter_id IS NULL OR EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id = exceptions.tenant_id AND m.id = exceptions.matter_id))
  );

-- Document restriction is an additional filter over already-authorized matter access.
CREATE POLICY document_security_effective_read ON document_security
  FOR SELECT USING (
    tenant_id = app_current_tenant_id()
    AND EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id = document_security.tenant_id AND m.id = document_security.matter_id)
    AND (
      mode = 'INHERIT'
      OR EXISTS (
        SELECT 1 FROM matter_break_glass_grants bg
        WHERE bg.tenant_id = document_security.tenant_id
          AND bg.matter_id = document_security.matter_id
          AND bg.actor_id = app_current_actor_id()
          AND bg.step_up_verified = true
          AND bg.revoked_at IS NULL
          AND bg.issued_at <= now()
          AND bg.expires_at > now()
      )
      OR EXISTS (
        SELECT 1 FROM document_actor_access da
        WHERE da.tenant_id = document_security.tenant_id
          AND da.document_ref = document_security.document_ref
          AND da.actor_id = app_current_actor_id()
          AND (da.expires_at IS NULL OR da.expires_at > now())
      )
      OR (
        mode = 'SECURITY_ZONE'
        AND security_zone_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM actor_security_zones az
          WHERE az.tenant_id = document_security.tenant_id
            AND az.actor_id = app_current_actor_id()
            AND az.security_zone_id = document_security.security_zone_id
        )
      )
    )
  );

CREATE POLICY document_actor_access_self_read ON document_actor_access
  FOR SELECT USING (
    tenant_id = app_current_tenant_id()
    AND actor_id = app_current_actor_id()
    AND (expires_at IS NULL OR expires_at > now())
  );

DROP POLICY IF EXISTS tenant_isolation_audit ON audit_events;
CREATE POLICY tenant_and_matter_isolation_audit ON audit_events
  FOR SELECT
  USING (
    tenant_id = app_current_tenant_id()
    AND (matter_id IS NULL OR EXISTS (SELECT 1 FROM matters m WHERE m.tenant_id = audit_events.tenant_id AND m.id = audit_events.matter_id))
  );
CREATE POLICY tenant_insert_audit ON audit_events
  FOR INSERT WITH CHECK (tenant_id = app_current_tenant_id());

-- The application audit ledger is append-only at the database boundary. Production
-- deployment must additionally ensure the runtime role is not the table owner/superuser.
CREATE OR REPLACE FUNCTION deny_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION deny_audit_mutation();

COMMIT;
