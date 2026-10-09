# V85 — Audit checkpoint and rollback detection

V85 extends the V62 hash-chained audit ledger with an external checkpoint boundary. A valid local hash chain proves internal continuity, but an older restored database can still contain a valid shorter chain. V85 binds a tenant's audit count and chain head to a checkpoint hash that can be anchored outside the primary database, allowing rollback, truncation and alternate-history forks to be detected.

## Platform boundary

`AuditCheckpointService` creates an idempotent checkpoint only after verifying the current tenant audit chain. The external anchor receives a bounded descriptor containing tenant ID, audit count, head hash, creation time and checkpoint hash. It never receives audit bodies. Locally, only the SHA-256 fingerprint of the external anchor reference is retained.

Verification distinguishes a missing checkpoint, invalid local chain, rollback, fork, invalid/unverified anchor and a valid extended chain. A bounded readiness probe converts those states into non-sensitive readiness codes.

The in-memory `MemoryAuditAnchor` is a reference/test adapter only. It is not evidence of a production immutable anchor service.

## Production shape

Migration `022_audit_checkpoint_anchor.sql` adds tenant-bound append-only checkpoint evidence protected by forced RLS. Raw anchor references and audit content are not stored. Production configuration requires:

- `AUDIT_CHECKPOINT_MODE=external-immutable`
- `AUDIT_ROLLBACK_DETECTION_MODE=required`
- `AUDIT_CHECKPOINT_EVIDENCE_MODE=append-only`

Real-client-data readiness additionally requires `AUDIT_CHECKPOINT_VALIDATION_STATUS=PASS` from reviewed external evidence.

## Deliberate non-claims

V85 does not select a checkpoint cadence, external storage vendor, cloud account, retention period or alert-routing policy. Those remain deployment/firm decisions. An external anchor written before a local transaction later fails can be orphaned; implementations must treat the external store as append-only and tolerate unused anchors rather than rewriting them.
