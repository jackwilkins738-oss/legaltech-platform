BEGIN;
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  job_type text NOT NULL,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','RETRY_WAIT','SUCCEEDED','DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_type, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, available_at);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON jobs(tenant_id, status, available_at);
COMMIT;
