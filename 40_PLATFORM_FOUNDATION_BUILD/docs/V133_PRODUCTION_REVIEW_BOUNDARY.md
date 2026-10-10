# V133 production review boundary

V133 connects V130 durable human decisions to the optional production HTTP service. This continues the authorized D-018 integration exception. The pre-TO freeze and customer-data deployment gate remain in force. V131 writeback execution stays paused pending partner approval-wait evidence; approval queues the existing immutable intent and does not execute a Proclaim write.

## HTTP and exact reviewed results

`POST /api/v1/processing/review-decisions` requires a verified OIDC/server session with `inbound:review`, current request authorization, the existing IP/tenant admission controls and a registered managed review adapter. Tenant and actor come exclusively from the session. The exact JSON body is `{eventId, decision, matterId, decisionKey, expectedResultJobId, expectedResultHash}`. The `idempotency-key` header must equal `decisionKey`. Decision is `APPROVE` with an open matter UUID or `REJECT` with null matter. UUIDs and the SHA-256 result hash use lowercase canonical form. Caller actor/tenant, notes, query parameters, trace IDs and additional fields are rejected. The route is unavailable without review configuration.

The supplied job/hash must equal the immutable adopted PROCESS_INBOUND result before any decision or outbox mutation. A stale result or different replay returns 409. Identity/scope denials use opaque 404 responses. A successful 200 includes event, decision, matter, adopted result job/hash, stable writeback job ID or null, DECIDED status and replay flag; it omits the tenant and confidential content. It proves the durable decision, not external execution. The decision key produces a stable server trace so an exact HTTP retry matches the durable request. No result-list or review UI is delivered here; deployments must obtain the exact reviewed result through a separately authorized read path.

## Database boundary and revocation

Migration 058 revokes PUBLIC execution of the two existing review trigger functions. The adapter attests their exact reviewed source hashes, signatures, ownership, invoker status and search path, plus exact enabled trigger events, columns, schema and absence of conditions. Decision RLS must have precisely the tenant read and tenant/actor append policies. Reviewer permissions permit decision-column append and inbound status update only; wider inbound or other business-table writes fail verification.

A PostgreSQL row lock requires write privileges even when no row is changed. To retain read-only actor/tenant/matter grants, migration 058 adds the narrowly scoped `review_security.lock_scope(uuid,uuid,uuid)` SECURITY DEFINER helper. Only the reviewer group can execute it. It checks session-group membership and exact transaction tenant/actor context, locks the active USER and active tenant, and optionally locks an OPEN matter in the same tenant. It performs no mutations, accepts no SQL or resource locator and returns only a boolean. PUBLIC schema/function rights are revoked. Its exact body hash, UUID signature, boolean return type, ownership, execute ACL, search path and row-security configuration are attested before use. Other session, runtime, shared-security and drain credentials reject leaked review-helper execution.

Event advisory/row locks serialize identical approvals. Actor/tenant/matter locks remain owned until transaction completion, so revocation and matter closure serialize against acknowledged decisions. Current decision authorization runs after admission locks and again before commit, including replays. Withdrawn final authority rolls back the decision, inbound transition and writeback intent together. Approval replay rechecks the open matter and exact immutable intent; rejection produces no writeback. Direct V130 callers may omit both result pins for compatibility; the managed production route requires both.

## Service configuration and ownership

Pass optional `review` to `createDurablePostgresProcessingService` or `createPostgresProcessingService`:

- `pool`, `expectedRole`: a dedicated direct-login reviewer principal and pool, separate from every processing, drain and optional Graph credential.
- `authorizeAppend`, `authorizeDecision`: current authoritative transaction/outbox and human object/result/matter authorization. `authorizeDecision` receives ADMIT and COMMIT phases.
- `authorizeReview`, `audit`, `probeReview`: mandatory deployment providers. Managed authorization receives ADMIT and DISPATCH phases. Audit receives ATTEMPT and ACCEPTED metadata with a hashed server trace, no plaintext decision key or document content. Audit acknowledgement must represent the deployment's durable audit policy.
- Optional `transactionTimeoutMs` (default 5000), `timeoutMs` (default 10000, 100–60000), `maxPending` (default 16, 1–100).

The durable root requires ten distinct pools/roles with review alone, or thirteen when Graph intake is also enabled. Caller configuration cannot replace the bound review store, domain outbox, drain, readiness or HTTP review intake. Constructors do not connect or start timers. Mandatory WORKER_AUTHORIZATION readiness includes the actual review store posture and the trusted review-provider probe, alongside the existing processing authorization/canary checks.

Managed tasks retain local capacity and global INGRESS drain ownership through real callback completion. Acquisition waits for its actual acknowledgement before cancellation/release. Stop aborts business callbacks and awaits tasks and active probes; provider probes retain ownership through cancellation and failed sibling probes. Missing acquisition/release acknowledgements latch uncertainty and block optimistic health/restart. A lost acknowledgement after durable decision/audit initiation returns unavailable/unknown; the exact immutable request can be retried once ownership settles. A timeout never authorizes a duplicate external effect. Review execution has no external business effect beyond the existing queued intent.

## Verification and remaining work

The batch adds 76 platform regressions and ten connected PostgreSQL cases for actual function/policy/trigger/grant verification, helper scope isolation, ten-pool HTTP/readiness/shutdown, lost acknowledgement replay, stale pins, final-authorization rollback, concurrent approvals, closed-matter replay, catalog tampering and actor revocation serialization. Mock cases are boundary fixtures; actual database validation must pass in PostgreSQL 17 CI before merge. Local PostgreSQL is unavailable in this runtime.

All identity, storage, permission/evidence and audit providers in tests are synthetic. Real endpoint hosting, reviewer entitlement provisioning, durable audit providers, authorized result browsing/UI, source permissions, operating/reconciliation evidence and customer-data release remain outstanding. This batch adds no dependency, external subprocessor or writeback executor.
