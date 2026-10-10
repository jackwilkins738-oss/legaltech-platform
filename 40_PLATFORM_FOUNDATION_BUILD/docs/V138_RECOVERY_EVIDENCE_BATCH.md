# V138 — Recovery evidence bound to restored artifacts

The SQLite reference recovery boundary previously accepted any syntactically valid
restored-content hash, and used the latest 500 display records for generation,
authorization and replay decisions. V138 matches the expected content commitment,
requires actual artifact-byte checks, uses complete tenant history for decisions,
and commits evidence and audit atomically. Every transition validates the full
stored hash chain and its tenant/id/time/trace columns first.

This is evidence tooling and a defect fix under the existing D-018 exception.
The pre-TO/customer-data gates remain; V131 writeback execution stays paused.
No migration, dependency, PostgreSQL recovery executor or deployment is added.

## Backup commitment and restore proof

A trusted backup provider constructs a `v138` inventory containing tenant ID,
backup ID, explicit object count, and entries `{artifactId, kind, size, hash}`.
Exactly one nonempty DATABASE and the declared number of OBJECT entries are
required. Object count zero is explicit. Path-free artifact IDs are unique;
SHA-256 hashes are lowercase. Bounds: 1,001 entries, 64 MiB per artifact,
256 MiB total. These bounds suit the reference drill, not arbitrary firm backups.
`restoreInventoryHash(inventory)` is the canonical aggregate committed as
`createBackupManifest({..., contentHash})`; the metadata manifest version remains v63.
Order does not change this commitment. The provider must establish that the
inventory includes every required database/object artifact; the checker cannot
discover an object omitted from the original backup inventory.

After `recordBackup`, distinct normalized human controllers authorize a target;
`beginRestore` binds the immutable authorization. Construct
`RestoredArtifactVerifier({inventory, context})`, where context contains exactly
`restoreId`, `targetEnvironment`, and `backupManifestHash`. Feed every restored
artifact through `checkArtifact({artifactId, bytes})`. Only `complete()` returns
a frozen, process-branded proof; failed, missing, unknown or duplicate checks latch
failure. The verifier copies metadata and does not retain provider buffers.

Pass this proof as `artifactEvidence` to `verifyRestore`, with explicit
`isolatedTarget: true`, matching expected manifest/content hashes and seven true
integrity observations: database, auditChain, objectReferences, tenantBoundary,
keyAccess, deletions, externalEffects. Forged/serialized proofs and proofs for a
different tenant/backup/restore/target/manifest are refused. A proof records bytes
at the time checked; protect the target against later writes before activation.

The seven observations still come from trusted operator/provider checks. Byte
matching alone does not prove key availability/decryption, deletion suppression,
current authorization, database logical consistency, or external-effect
reconciliation. This library exposes no public recovery HTTP endpoint or production
activation. Do not expose the evidence constructor to untrusted callers.

Old backup evidence without a committed content hash cannot authorize a restore.
Record a newly verified baseline with a new backup ID and advancing generation;
do not invent content evidence for legacy rows. Re-recording an identical backup
is idempotent; reusing its ID with changed metadata is refused.

## Local operator file check

From `40_PLATFORM_FOUNDATION_BUILD`:

```sh
npm run recovery:artifacts -- /path/to/plan.json /path/to/isolated-artifacts
```

The plan has exactly `{inventory, context}` as above. The directory contains
exactly `<artifactId>.bin` files, including database and document bytes. The CLI
rejects links, directories, extras, missing files, size/hash mismatches, malformed
UTF-8 and plans over 512 KiB. Reads are bounded, opened file identity is checked,
and checker-owned buffers are wiped. Output is a metadata summary with status,
content hash, artifact/object counts and total bytes; failure emits only a generic
code. Its JSON is not accepted as a branded `RecoverySafety` proof.

Use a trusted, isolated local filesystem. This is not a hostile filesystem
sandbox: ancestors and the containing directory must not be replaced during the
check. It does not implement cloud snapshot ownership, signed backup provenance,
KMS restore, live PostgreSQL restore or activation. Large/chunked production
backup manifests and streaming provider verification remain work to design.

## Validation and operating limits

61 new synthetic regressions cover corrupt/missing/duplicate/extra artifacts,
strict inventories, forged/cross-context proof, >500-record history, all integrity
observations, explicit isolation, replay, dual control, timestamp/policy bounds,
audit rollback and local file/CLI containment. A synthetic SQLite copy is reopened
and its stored row/hash chain checked alongside exact document bytes. This is
not a managed disaster-recovery drill. The original nine recovery tests pass.

Local: 2,766 platform and 140 scaffold tests pass; PostgreSQL is skipped locally.
38 security-policy tests pass; the security scanner has no findings. Full GitHub
CI, including PostgreSQL 17, must pass before merge.

Full-chain validation is linear in tenant history for each transition and SQL
state queries remain unindexed JSON scans. These operator-only reference methods
are synchronous; production adapters need measured bounded execution, indexes,
verified checkpoints and concurrency controls without weakening historical replay
or tamper checks. Audit/evidence rows roll back together; external alert delivery
cannot be undone if a later sink throws. Restore timing, achievable RPO/RTO,
independent backup credentials, actual immutability, key custody, document
completeness, deletion/reconciliation checks and isolated cloud restore evidence
remain unvalidated operating requirements.
