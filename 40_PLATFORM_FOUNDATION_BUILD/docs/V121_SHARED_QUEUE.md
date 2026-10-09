# V121 shared job queue

STATUS: CURRENT
DOMAIN: platform_build

V121 adds PostgreSQL producer, worker and authenticated reader adapters. It is an authorised security integration exception under D-018. The existing SQLite job store and worker loops remain reference implementations. This patch does not apply a deployed migration, migrate job history or silently replace their synchronous interfaces.

## Storage and authority

Migration 050 creates private `queue_security.jobs` with forced RLS and three safe NOLOGIN groups. Provision separate restricted direct-login users for `legaltech_queue_producer`, `legaltech_queue_worker` and `legaltech_queue_reader`. Producer and worker inherit reader access. Producers may enqueue, workers may update only claim/status/timing columns, and readers cannot mutate. No runtime group can delete/truncate jobs or rewrite tenant, kind, object, dedupe or retry policy. A trigger validates legal initial states and transitions, immutable bindings, monotonic update time, attempt fences, expiry and external reconciliation.

The shared role boundary rejects dangerous memberships, ownership/CREATE, cross-schema access and widened grants. The domain/session checks also reject queue-role memberships/access. The private policy intentionally grants dedicated queue credentials global queue metadata access. Trusted server authorisation must bind tenant/job/object; the queue is not a user SQL endpoint. These schemas are canonical and require separate managed pools/credentials.

Jobs contain real UUID tenant/job/object references, constrained kind, hashed trace/dedupe references and bounded policy/status metadata. They accept no arbitrary JSON payload, legal content, email text, credential or destination URL. Persist the actual work in the authorised domain store and load it by tenant-bound object reference. Stable SHA-256 identifier hashes are not encryption or an anonymity guarantee.

## Producer contract

`PostgresJobProducer` requires `authorizeEnqueue` resolving to exactly `true`. The callback receives copied normalised tenant/job/kind/object/policy metadata and a bounded transaction signal; it must verify current permission and the object's actual tenant binding. It cannot be a permissive deployment placeholder.

`enqueue` requires a stable caller-persisted job UUID and opaque idempotency key. It locks initial tenant enqueue, checks both job identity and tenant/kind dedupe identity and compares immutable policy/binding metadata. Identical requests replay their existing state; conflicts fail without overwriting it. Available time derives from PostgreSQL time plus a bounded relative delay. Commit acknowledgement precedes the receipt. An uncertain enqueue returns `QUEUE_ENQUEUE_OUTCOME_UNKNOWN`; reconcile with the same job ID, key and exact metadata, never allocate a fresh duplicate.

Initial policies: attempts 1–10; lease 5 seconds–5 minutes; maximum execution interval at least the lease and at most one hour; initial delay up to one day; retry base delay 1 second–1 hour. Defaults are five attempts, one-minute lease, fifteen-minute maximum interval and one-second retry base. Persisted policies cannot change on replay or while a job runs.

## Claims and fencing

`PostgresJobWorker` binds a configured authenticated worker UUID and a current `authorizeWorker` callback. Calls always specify a tenant and one supported kind; no global unrestricted claim is exposed. Claim/recovery authorise the tenant/kind, then each selected job/object. Renewal, settlement and execution checkpoints recheck current authority by tenant/job/kind/worker binding. The resolver must independently load/revalidate domain scope where required; possession of a token is not sufficient current authorisation.

The candidate query uses `FOR UPDATE SKIP LOCKED` within the same bounded transaction as the update. Independent workers may skip a locked job rather than wait on it. A successful claim increments the bounded attempt counter, generates a fresh 32-byte opaque token and stores only its SHA-256 digest. The token is returned only after COMMIT. Queue readers never receive the token or digest. An uncertain claim returns `QUEUE_CLAIM_OUTCOME_UNKNOWN`; it provides no executable credential. Do not execute a job after that error; its lease/reconciliation path resolves the ambiguity.

Every renewal/settlement matches tenant, job, kind, attempt, worker identity and token digest, with a database-time live-lease predicate. Reclaim increments the attempt fence and clears/replaces the old token. Old workers cannot renew, complete or fail the new claim. `assertCurrent` is an authenticated live checkpoint, including detection of a timestamp ahead of database time. It is not a distributed lock around an external effect.

Heartbeat renewal cannot exceed the original fixed `run_until`, so it cannot keep a claim alive indefinitely. Worker code must await renewal, stop issuing side effects on false/error/authority withdrawal and honour cancellation. The queue cannot force a crashed or partitioned process to stop. Completion can replay only the same succeeded claim and result code. Other stale mutations return false; they do not report successful settlement. Commit uncertainty returns `QUEUE_SETTLEMENT_OUTCOME_UNKNOWN` and requires reconciliation.

## Failure and crash recovery

Internal `PROCESS_INBOUND` / `POLICY_EVALUATION` jobs may enter QUEUED after a retryable failure or expired lease while attempts remain; at the cap they become DEAD. Delay uses bounded exponential backoff capped at one hour. These handlers must be idempotent and must not hide external side effects behind an internal kind. Fencing protects queue state; it does not by itself fence separate domain writes. Enforce current fences in domain operations or use a reviewed atomic outbox/transaction boundary.

`PROCLAIM_WRITEBACK` and `NOTIFICATION_DELIVERY` failures/expired leases enter RECONCILE even if a worker asks to retry. They are not automatic claim candidates. An expired lease cannot tell whether an external write/send committed, nor undo an already in-flight call. Require the existing current command/connector authorisation, interlock, stable external idempotency key and receipt/readback reconciliation before any later write. Exactly-once external execution is not claimed.

`recoverExpired` takes a tenant, kind and bounded batch of 1–100 jobs (default 25), skips locked rows, reauthorises each object and changes the selected rows atomically. If any authorisation/storage step fails, the batch is rolled back. Recovery preserves attempt history, clears prior claim credentials and never claims work as part of the recovery operation.

SUCCEEDED, DEAD and RECONCILE are terminal to these runtime adapters. No blind requeue, cancellation, dead-letter replay or reconciliation-release endpoint is added. A reviewed operator workflow is required for uncertain external outcomes and manual replay. Do not change the job kind to bypass reconciliation, or reset attempt counters in production.

## Readiness and deployment limits

`createPostgresQueueBoundary` returns the same producer/worker instances and `queueProbe`. This probe checks actual role/grant posture, read access, forced RLS and the transition trigger. It is a database posture probe; it does not enqueue/execute a synthetic job or prove the current authorisation provider, domain loader, worker loop or external adapter is correct. A production `QUEUE` readiness check must layer controlled functional canary validation through those actual adapters and stay within the V117 admission deadline. Do not treat this factory alone as full production readiness.

Wire producers, authorised current domain loaders, idempotent internal handlers, service identity, renewal/cancellation, interlocks and settlement into the real worker host. Avoid pointing synchronous SQLite workers at an asynchronous interface. Domain write + enqueue is not atomic here; use an actual shared transaction/outbox design to prevent lost or duplicated orchestration. Queue transition metadata does not replace the V120 audit sink or its independent external anchors.

Deploy drain/recovery controls, per-tenant scheduling, backlog/lease/reconciliation monitoring, pool capacity and controlled retention. The queue has no global fairness scheduler or backpressure policy. Database restore can lose queue state; drain admissions and reconcile domain/external command evidence before replay. A restored queue does not prove an earlier external side effect was absent.

## Validation

Unit regressions cover privacy/input shape, immutable replay, async authorisation denial, unsafe roles/grants, missing triggers, returned binding mismatches, commit ambiguity, claim token hashing, stale fences, authority withdrawal, bounded recovery and guarded settlement. Mocks are not SQL execution evidence.

The existing PostgreSQL CI job now executes all 50 checksum-pinned migrations and adds independent claims, locked-candidate skipping, stable enqueue replay, real privilege denial, heartbeat, forced crash recovery, fence replacement, expired external reconciliation, attempt caps and authorisation withdrawal. Synthetic expiry fixtures are owner-seeded only in the disposable CI database. They do not validate a production external service or a full worker host.

PostgreSQL and its driver/service were unavailable locally; the integration test is skipped here. Require `postgres-security-integration` to pass before merge. Migration 050, deployed credentials/composition, actual domain/external fencing and live operational validation remain outstanding. PostgreSQL documents the queue use of `SKIP LOCKED` in its [SELECT reference](https://www.postgresql.org/docs/17/sql-select.html); use [one checked-out client per transaction](https://node-postgres.com/features/transactions).
