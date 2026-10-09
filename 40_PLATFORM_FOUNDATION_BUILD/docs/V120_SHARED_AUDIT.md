# V120 shared audit persistence

STATUS: CURRENT
DOMAIN: platform_build

V120 adds an asynchronous PostgreSQL audit writer, independent reader/verifier and readiness boundary. This is an authorised security integration exception under D-018. No deployed database migration or production wiring has been performed here. The existing SQLite audit ledger and synchronous checkpoint/package services remain reference implementations; V120 does not replace their interfaces or histories automatically.

## Persistence and credentials

Migration 049 creates `audit_security.tenant_heads` and `audit_security.entries`. Both enable and force RLS. Separate safe NOLOGIN groups are `legaltech_audit_writer` and `legaltech_audit_reader`; the writer inherits read authority but receives no legal-data, identity or operational-security authority. Provision restricted direct-login users externally. Reader credentials cannot append; writer credentials cannot update/delete/truncate entries or delete heads. Head updates are limited to position/hash and checked against an actual next ledger row.

The shared role boundary checks direct login, inherited dangerous roles, schema ownership/CREATE, cross-schema access and exact grants. Existing security adapters now reject audit group membership/access, and the domain/session runtime checks reject the audit roles. These private audit policies permit global control-plane metadata access to their dedicated groups. Trusted server code must bind the authenticated tenant and authorise evidence access; these are not unauthenticated query endpoints or tenant legal-data policies.

The payload is a fixed versioned flat metadata object. It stores tenant/event UUIDs, sequence, database ingestion time, hashed actor/trace/object/matter identifiers, constrained machine action/outcome/reason codes, request digest and chain linkage. It rejects unknown input keys and free-text reasons. No email/document body, names, raw credential, legal text or arbitrary evidence object is accepted. Identifier hashes are stable SHA-256 hashes, not a promise of anonymity or an encryption boundary. Do not encode client content into an identifier or machine code.

## Append and replay

`PostgresAuditWriter.append(input)` requires a caller-created stable event UUID, real tenant UUID, opaque actor/trace identifiers, action/outcome machine codes and optional opaque object/matter identifiers and reason code. Persist the event ID with the originating operation. Do not create a new UUID when reconciling an uncertain append. Identity/operation authorisation remains the trusted producer's responsibility.

Transaction-scoped advisory locks serialize each tenant including initial head creation. A row lock protects the head; application code checks the last row and uses PostgreSQL ingestion time. PostgreSQL triggers independently validate canonical metadata bytes, request/entry hashes, predecessor, consecutive position, monotonic ingestion time and legal head advance. The row and head update commit together. An invalid entry or failed head update rolls the transaction back. Sequence is per tenant rather than a global cross-tenant counter.

The request digest covers immutable caller metadata, excluding allocated position/time. Reusing an event ID with identical metadata returns the existing validated receipt without a new row. Changed actor, binding, action, outcome or reason raises `AUDIT_EVENT_CONFLICT`. The tenant/event uniqueness constraint also enforces replay identity at the database layer. Receipts appear only after an acknowledged COMMIT. Uncertain commits return `AUDIT_APPEND_OUTCOME_UNKNOWN`; retry/reconcile only the same event ID and exact metadata. Other storage errors are generic and never return optimistic success.

Normal writer privileges and explicit row/statement triggers prohibit entry update, deletion and truncation. These are protections against runtime mistakes or credential misuse within this restricted role. A privileged database owner or restore operator can disable triggers/replace history; independent external anchors are needed to detect that class of rollback/fork. SQL functions use a fixed catalog search path; pgcrypto digest is explicitly bound to the canonical `public` extension installation from migration 001.

## Integrity and readiness

`PostgresAuditReader.verify({tenantId})` uses a read-only repeatable-read transaction selected in BEGIN, before any snapshot-producing query. It verifies all rows in a bounded snapshot, paging 1,000 at a time. It checks exact metadata/canonical bytes, request digests, positions, previous/entry hashes, monotonic time, total row count and final head. Missing rows, extra rows, invalid hashes, unsafe grants, disabled required triggers or storage errors fail closed. Without an external resolver it returns `anchorVerified:false`; that does not satisfy readiness.

Supply `resolveTrustedAnchor({tenantId,signal})` to obtain an independently authenticated descriptor `{tenantId,auditCount,headHash}` from a durable external verifier. The callback must verify authenticity and tenant binding before returning; it must not derive its supposed trusted anchor from the same mutable database. V120 does not implement a WORM service, external signature verification or anchor publication. Callback registration cannot attest to honest external wiring. Its work is covered by the bounded database transaction deadline, and the returned descriptor is copied before paging.

An anchored prefix may have later valid extensions. A database shorter than the retained anchor, or a changed hash at its position, fails integrity. A restore that removes only entries after the latest external anchor cannot be detected from that anchor alone. Anchor publication frequency, independently retained latest-anchor identity, retention and recovery procedures remain operator responsibilities. Anchors must not regress after a database restore.

Verification defaults to 10,000 entries with a configurable cap up to 100,000 and the existing transaction deadline. Exceeding the cap/time budget denies readiness; it does not silently verify a suffix. Larger histories require a reviewed checkpoint/range verification design rather than deleting audit history or loosening the guard. It does not claim unlimited-volume production verification.

`createPostgresAuditBoundary` returns the same writer/reader instances plus `auditProbe` for the required V117 `AUDIT_SINK` probe. Configure a pre-provisioned synthetic tenant and a stable synthetic probe event UUID. Bootstrap that event, publish/retain a trusted external anchor, then enable readiness. The probe checks actual roles/RLS, required triggers, a committed stable canary append/replay and independent anchored verification. A missing external anchor denies admission. Repeated probes reuse the canary and do not create unlimited rows.

This canary tests the bound sink; it does not certify every customer tenant's history. Bind the same writer to production operations, make audit failure deny the protected operation where required, schedule/customer-scope integrity verification and keep readiness/alerting wired. Domain writes and audit appends use separate transactions; V120 does not provide an atomic cross-database outbox, automatic success audit coverage or a full production composition root. Existing synchronous store/checkpoint/export code must not be pointed at this asynchronous sink as a drop-in replacement.

## Migration review: V120-AUDIT-TRUNCATE-GUARD

The existing conservative migration classifier flags every `TRUNCATE` token, including the defensive `BEFORE TRUNCATE` trigger in 049. The manifest therefore retains a destructive flag with this explicit bounded review reference. Source review: 049 creates a new schema, two new tables, restricted roles/policies and integrity trigger functions. Its only TRUNCATE syntax installs a denial trigger; it executes no truncation, deletion, dropped table/schema/column or data rewrite. Existing classifier/tests are unchanged. The flag is not permission to perform a production truncation; deployment still uses the existing controlled migration process.

## Evidence and remaining work

Unit counterexamples cover replay conflicts, privacy shape, grant/role failures, disabled triggers, uncertain commits, tampered hashes, chronology, gaps, forks, rollback and bounded external-anchor waits. The PostgreSQL CI job now executes all 49 checksum-pinned migrations and adds actual concurrent writer, replay, privilege/trigger, snapshot and synthetic external-prefix rollback tests. Its synthetic descriptor is held in memory outside the test database; it is not validation of a production immutable anchor provider.

Live PostgreSQL and the driver/service were unavailable locally; mocks and a skipped integration test do not prove SQL execution. Require `postgres-security-integration` to pass before merging. Migration 049, actual role/provider wiring, external anchoring, sink coverage, operational controls and customer-data deployment validation remain outstanding. See [PostgreSQL transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html) and [node-postgres transactions](https://node-postgres.com/features/transactions) for the underlying connection/snapshot rules.
