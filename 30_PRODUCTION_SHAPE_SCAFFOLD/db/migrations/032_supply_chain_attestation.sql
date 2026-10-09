-- V97 verified supply-chain evidence. Signature material remains external.
CREATE TABLE IF NOT EXISTS release_supply_chain_evidence (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  release_id text NOT NULL,
  artifact_sha256 char(64) NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  sbom_sha256 char(64) NOT NULL CHECK (sbom_sha256 ~ '^[a-f0-9]{64}$'),
  provenance_sha256 char(64) NOT NULL CHECK (provenance_sha256 ~ '^[a-f0-9]{64}$'),
  source_revision char(40) NOT NULL CHECK (source_revision ~ '^[a-f0-9]{40}$'),
  builder_ref_hash char(64) NOT NULL CHECK (builder_ref_hash ~ '^[a-f0-9]{64}$'),
  build_type_hash char(64) NOT NULL CHECK (build_type_hash ~ '^[a-f0-9]{64}$'),
  attestation_ref_hash char(64) NOT NULL CHECK (attestation_ref_hash ~ '^[a-f0-9]{64}$'),
  statement_hash char(64) NOT NULL CHECK (statement_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status='VERIFIED')
);
CREATE INDEX IF NOT EXISTS idx_release_supply_chain_lookup ON release_supply_chain_evidence(release_id,artifact_sha256,verified_at DESC);
CREATE OR REPLACE FUNCTION reject_release_supply_chain_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'release supply chain evidence is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_release_supply_chain_evidence_append_only ON release_supply_chain_evidence;
CREATE TRIGGER trg_release_supply_chain_evidence_append_only BEFORE UPDATE OR DELETE ON release_supply_chain_evidence FOR EACH ROW EXECUTE FUNCTION reject_release_supply_chain_evidence_mutation();
