# V63 — Backup, Restore and Ransomware Recovery Resilience

V63 adds a recovery-safety boundary without claiming a live backup provider. The reference implementation validates immutable backup manifests, binds them to one tenant/backup set/generation, rejects stale or tampered evidence, requires isolated credentials and separate KMS key boundaries, and records append-only hash-chained recovery evidence.

Restore authorization uses dual control: requester and approver must be different identities. Production-recovery authorization additionally requires explicit production enablement and step-up evidence. A restore cannot be marked verified unless an authorized restore was started in an isolated target and database, audit-chain, object-reference and tenant-boundary integrity checks all pass.

Production-shaped configuration now requires immutable managed backups, workload/federated backup identity, separate KMS boundary, two-person destructive-action protection, PITR, durable append-only recovery evidence, isolated ransomware recovery and clean restore targets. Real-client-data mode adds evidence gates for immutability, PITR, credential/key isolation, dual control, restore integrity and a ransomware recovery drill.

This version does **not** prove that a cloud provider backup, PITR policy, air-gapped copy, ransomware drill, RTO/RPO target or production restore procedure exists. Those remain external deployment/evidence requirements.
