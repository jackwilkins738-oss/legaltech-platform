# V124 — Verified worker execution and lifecycle batch

This authorised D-018 security integration batch connects immutable V123 commands to V121 claims, exact artifact verification, supervised internal processing and atomic result receipts. It requires migration 053 and retains the pre-TO freeze and customer-data deployment gate. It does not switch the existing HTTP application to PostgreSQL.

## Execution boundary

`PostgresWorkerDomainLoader` uses a separate direct-login read-only principal inheriting `legaltech_job_domain_reader`. Each load verifies its exact grants and active forced RLS on eight domain relations, uses a tenant/service-actor repeatable-read transaction, and checks active tenant, active SERVICE actor and active original author. Policy matters must remain visible to the service actor and OPEN. Inbound events must remain RECEIVED with the exact source, trace and payload reference. Command hash, canonical outbox intent, intent hash, job kind/object and command deduplication key all bind together. The existing tenants metadata table has no tenant RLS; identity joins explicitly restrict its tenant ID. The reader has no queue, receipt-write, domain-write or other private-control privileges.

`PostgresWorkerRuntime` handles only PROCESS_INBOUND and POLICY_EVALUATION. Required callbacks provide current execution authorization, payload loading, policy-version loading and processing. It rechecks the live claim and current domain/permission binding before processing, at processor-requested checkpoints and immediately before completion. Authorization must return strict true. Authorization providers must check both the service identity and the original author's **current capability and object access**, tenant lifecycle, containment, residency and any required handling gates; an active actor row alone is insufficient.

Artifact providers return exactly `{tenantId,id,hash,state,bytes}`. Payload state must be PROCESSING_ALLOWED; policy state must be PUBLISHED. ID, tenant and pinned digest must match the command, and the actual bytes must hash to that digest. Payload/policy limits default to 15 MiB/1 MiB. The runtime rejects accessors and makes its own snapshot. Processor callbacks receive a separate byte copy, a frozen command, its stable command ID as idempotency key, an AbortSignal and an awaitable checkpoint; they receive no queue token or pool. Owned byte copies are wiped after actual settlement. JavaScript wiping cannot promise elimination of engine, provider or processor copies.

Processors return exactly `{resultCode,resultHash}` with a bounded machine code and SHA-256 digest. This batch records evidence of the callback result, not the raw output or an application-specific disposition. Production processors must be pure computation or implement explicit command-ID idempotency and reconciliation for every effect. The runtime does not implement Proclaim/notification delivery, legal decision logic or inbound domain-state changes. A succeeded receipt must not be displayed as evidence of those effects.

## Fencing, deadlines and result receipts

Heartbeat renewals are serialized. Runtime configuration must fit each claimed job's lease/run policy; execution timeout cannot exceed maxRunMs, and heartbeat interval must be at most one third of leaseMs. Loss or uncertainty aborts execution. An uncooperative provider, processor, checkpoint or renewal remains admitted until it actually settles. A late checkpoint is rejected; an abandoned checkpoint prevents completion and is awaited before the runtime becomes available again. No deadline is treated as proof that an external effect stopped.

`PostgresJobWorker.completeWithResult` locks the exact tenant/job/object/request-hash/attempt/worker/token binding, appends a metadata-only `queue_security.job_results` row and completes the queue job in one transaction. Migration 053 requires a current live claim at receipt insertion and uses a deferred constraint trigger to require matching SUCCEEDED status at commit. Receipt updates/deletes/truncation and caller-supplied completion timestamps are forbidden. Identical committed results replay; changed results and stale claims cannot succeed. `PostgresJobReader.getResult` requires current tenant/object authorization and returns no claim token or token digest.

Every queue operation and posture probe now requires both result triggers enabled and the completion trigger initially deferred. Apply migration 053 before enabling the updated application. Losing a completion response reports OUTCOME_UNKNOWN and never initiates failure/retry. Reconciliation reads the queue and result receipt using independent current authorization. Fixed `WorkerRetryableError` codes can request bounded dependency retries; arbitrary errors cannot request them. Abort leaves an unsettled claim for expiry/recovery. Exactly-once processing or external execution is not guaranteed.

## Composition and lifecycle

`createPostgresWorkerPipeline` requires separate queue-worker and domain-reader pools/principals. `WorkerSupervisor` refreshes authorized explicit tenant/service scopes each cycle, obtains a shared deployment drain BACKGROUND lease, performs bounded recovery for both internal kinds and alternates their claims up to the batch limit. No tenant enumeration, timers or database work occurs at construction. Unknown, aborted and stale outcomes stop polling. Counts indicate settled attempts, including failures; empty queues indicate a completed cycle, not successful functional processing.

`createPostgresProcessingPipeline({domain,worker})` composes all five distinct pools/principals with the same drain adapter: domain writer, outbox relay, queue producer, queue worker and domain reader. `start()` is explicit after deployment admission. Failed starts stop both lifecycles; `stop()` aborts both and reports drained only after both settle and their drain leases release. Caller-owned pools must remain open while undrained; the factory never closes them. Supervisors reuse the tested V123 non-overlap and unknown-drain-outcome protections.

Deployment must supply real current authorization, an approved bounded object/version provider, processors, managed shared drain, operational recovery and end-to-end readiness canaries. The synthetic accepting callbacks in CI are test fixtures, not production adapters. Structural posture and successful polling are insufficient production admission evidence.

## Validation

See `TEST_RESULTS_V124.md`. The optional PostgreSQL suite now includes ten V124 connected cases. All CI, including `postgres-security-integration`, must pass before merge. Local execution does not validate PostgreSQL, deployed identities, actual providers or customer data.

The deferred completion check follows PostgreSQL 17 constraint-trigger semantics: https://www.postgresql.org/docs/17/sql-createtrigger.html.
