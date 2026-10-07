BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS actors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_type text NOT NULL CHECK (actor_type IN ('USER','SERVICE')),
  external_subject text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_subject)
);

CREATE TABLE IF NOT EXISTS matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  display_reference text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  stage text,
  security_zone_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, display_reference)
);

CREATE TABLE IF NOT EXISTS external_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  system text NOT NULL,
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, system, external_id)
);

CREATE TABLE IF NOT EXISTS inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  external_event_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_ref text,
  status text NOT NULL DEFAULT 'RECEIVED',
  trace_id text NOT NULL,
  UNIQUE (tenant_id, source_system, external_event_id)
);

CREATE TABLE IF NOT EXISTS exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  matter_id uuid REFERENCES matters(id),
  exception_type text NOT NULL,
  priority integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSIGNED','RESOLVED','DISMISSED')),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_event_id uuid REFERENCES inbound_events(id),
  assigned_actor_id uuid REFERENCES actors(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_code integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (tenant_id, scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid REFERENCES actors(id),
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  matter_id uuid REFERENCES matters(id),
  outcome text NOT NULL,
  reason_code text,
  trace_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
