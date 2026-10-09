BEGIN;
-- V114: trusted-time integrity evidence. Only bounded skew/state and hashes are stored.
CREATE TABLE clock_integrity_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('HEALTHY','DRIFTED')),
  system_skew_ms integer NOT NULL CHECK (system_skew_ms BETWEEN 0 AND 86400000),
  evidence_hash char(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  sampled_at_hash char(64) NOT NULL CHECK (sampled_at_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_clock_integrity_evidence_recent ON clock_integrity_evidence(recorded_at DESC);
CREATE OR REPLACE FUNCTION deny_clock_integrity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'clock integrity evidence is append-only'; END; $$;
CREATE TRIGGER clock_integrity_append_only BEFORE UPDATE OR DELETE ON clock_integrity_evidence FOR EACH ROW EXECUTE FUNCTION deny_clock_integrity_mutation();
COMMIT;
