BEGIN;
CREATE TABLE IF NOT EXISTS security_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS actor_security_zones (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
  security_zone_id uuid NOT NULL REFERENCES security_zones(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, actor_id, security_zone_id)
);

ALTER TABLE matters
  ADD CONSTRAINT fk_matters_security_zone
  FOREIGN KEY (security_zone_id) REFERENCES security_zones(id);
COMMIT;
