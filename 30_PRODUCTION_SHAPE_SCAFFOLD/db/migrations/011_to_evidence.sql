BEGIN;

-- V66: de-identified time-and-motion evidence. This stores process evidence,
-- not client records. Corrections append a replacement observation instead of
-- mutating historical evidence.
CREATE TABLE to_studies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  study_key text NOT NULL CHECK (study_key ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','LOCKED')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,study_key),
  FOREIGN KEY (tenant_id,created_by) REFERENCES actors(tenant_id,id)
);

CREATE TABLE to_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  study_id uuid NOT NULL,
  participant_alias text NOT NULL CHECK (participant_alias ~ '^P-[0-9]{2,6}$'),
  matter_alias text CHECK (matter_alias IS NULL OR matter_alias ~ '^MAT-[0-9]{3,8}$'),
  role_code text NOT NULL CHECK (role_code ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  task_family text NOT NULL CHECK (task_family ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  source_type text NOT NULL CHECK (source_type IN ('DIRECT_OBSERVATION','INTERVIEW','SYSTEM_LOG')),
  timing_basis text NOT NULL CHECK (timing_basis IN ('MEASURED','ESTIMATED')),
  wait_type text NOT NULL CHECK (wait_type IN ('NONE','INTERNAL','EXTERNAL')),
  request_type text NOT NULL CHECK (request_type IN ('NONE','QUESTION','DECISION','REVIEW','APPROVAL','HANDOFF','ESCALATION')),
  judgement_level text NOT NULL CHECK (judgement_level IN ('MECHANICAL','OPERATIONAL','LEGAL')),
  proclaim_capability text NOT NULL CHECK (proclaim_capability IN ('YES','NO','PARTIAL','UNKNOWN')),
  active_ms bigint NOT NULL CHECK (active_ms BETWEEN 0 AND 2678400000),
  waiting_ms bigint NOT NULL CHECK (waiting_ms BETWEEN 0 AND 2678400000),
  context_retrieval_ms bigint NOT NULL CHECK (context_retrieval_ms BETWEEN 0 AND 2678400000),
  reactivation_ms bigint NOT NULL CHECK (reactivation_ms BETWEEN 0 AND 2678400000),
  system_switches integer NOT NULL CHECK (system_switches BETWEEN 0 AND 100),
  chase_count integer NOT NULL CHECK (chase_count BETWEEN 0 AND 100),
  rework boolean NOT NULL,
  dependency boolean NOT NULL,
  dependency_role_code text,
  escalated boolean NOT NULL,
  escalation_depth integer NOT NULL CHECK (escalation_depth BETWEEN 0 AND 10),
  blocked_matter boolean NOT NULL,
  systems jsonb NOT NULL DEFAULT '[]'::jsonb,
  process_note text,
  supersedes_observation_id uuid,
  observed_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,supersedes_observation_id),
  FOREIGN KEY (tenant_id,study_id) REFERENCES to_studies(tenant_id,id),
  FOREIGN KEY (tenant_id,supersedes_observation_id) REFERENCES to_observations(tenant_id,id),
  FOREIGN KEY (tenant_id,recorded_by) REFERENCES actors(tenant_id,id),
  CHECK (NOT (timing_basis='MEASURED' AND source_type='INTERVIEW')),
  CHECK ((wait_type='NONE' AND waiting_ms=0) OR wait_type<>'NONE'),
  CHECK ((dependency AND request_type<>'NONE' AND dependency_role_code IS NOT NULL) OR (NOT dependency AND request_type='NONE' AND dependency_role_code IS NULL AND chase_count=0 AND NOT escalated AND escalation_depth=0 AND NOT blocked_matter)),
  CHECK ((escalated AND escalation_depth>=1) OR (NOT escalated AND escalation_depth=0))
);
CREATE INDEX idx_to_observations_study ON to_observations(tenant_id,study_id,task_family,role_code,recorded_at);

CREATE TABLE to_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  study_id uuid NOT NULL,
  task_family text NOT NULL CHECK (task_family ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  metric text NOT NULL CHECK (metric IN ('FREQUENCY_PER_PERSON_DAY','STAFF_COUNT')),
  estimate_value numeric NOT NULL CHECK (estimate_value > 0 AND estimate_value <= 1000000),
  evidence_type text NOT NULL CHECK (evidence_type IN ('INTERVIEW','DIRECT_COUNT','WORKFLOW_LOG','SYSTEM_REPORT','ROSTER')),
  confidence text NOT NULL CHECK (confidence IN ('LOW','MEDIUM','HIGH')),
  evidence_ref text NOT NULL CHECK (evidence_ref ~ '^[A-Z0-9][A-Z0-9_.:/-]{0,99}$'),
  observed_at timestamptz,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,study_id) REFERENCES to_studies(tenant_id,id),
  FOREIGN KEY (tenant_id,recorded_by) REFERENCES actors(tenant_id,id)
);
CREATE INDEX idx_to_estimates_study ON to_estimates(tenant_id,study_id,task_family,metric,recorded_at);

ALTER TABLE to_studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE to_studies FORCE ROW LEVEL SECURITY;
ALTER TABLE to_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE to_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE to_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE to_estimates FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_to_studies ON to_studies
  USING (tenant_id=app_current_tenant_id())
  WITH CHECK (tenant_id=app_current_tenant_id());
CREATE POLICY tenant_to_observations ON to_observations
  USING (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM to_studies s WHERE s.tenant_id=to_observations.tenant_id AND s.id=to_observations.study_id))
  WITH CHECK (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM to_studies s WHERE s.tenant_id=to_observations.tenant_id AND s.id=to_observations.study_id));
CREATE POLICY tenant_to_estimates ON to_estimates
  USING (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM to_studies s WHERE s.tenant_id=to_estimates.tenant_id AND s.id=to_estimates.study_id))
  WITH CHECK (tenant_id=app_current_tenant_id() AND EXISTS (SELECT 1 FROM to_studies s WHERE s.tenant_id=to_estimates.tenant_id AND s.id=to_estimates.study_id));

CREATE OR REPLACE FUNCTION protect_locked_to_study() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='LOCKED' THEN RAISE EXCEPTION 'locked TO study is immutable'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.study_key IS DISTINCT FROM OLD.study_key OR NEW.version <> OLD.version + 1 OR NOT (OLD.status='OPEN' AND NEW.status='LOCKED') THEN
    RAISE EXCEPTION 'TO study transition invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER to_studies_locked_immutable BEFORE UPDATE ON to_studies
FOR EACH ROW EXECUTE FUNCTION protect_locked_to_study();

CREATE OR REPLACE FUNCTION deny_to_observation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TO observations are append-only'; END; $$;
CREATE TRIGGER to_observations_append_only BEFORE UPDATE OR DELETE ON to_observations
FOR EACH ROW EXECUTE FUNCTION deny_to_observation_mutation();

CREATE OR REPLACE FUNCTION deny_to_estimate_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TO estimates are append-only'; END; $$;
CREATE TRIGGER to_estimates_append_only BEFORE UPDATE OR DELETE ON to_estimates
FOR EACH ROW EXECUTE FUNCTION deny_to_estimate_mutation();

COMMIT;
