# SCHEMA / EVENT DRIFT POLICY

Changes to tenant IDs, security zones, authorization relations, event/audit envelopes, idempotency, external mappings or writeback state require migration/contract update, compatibility review, security review, regression test and an ADR for material semantic changes. CI should retain the approved schema/event fingerprint and require explicit review when it changes.
