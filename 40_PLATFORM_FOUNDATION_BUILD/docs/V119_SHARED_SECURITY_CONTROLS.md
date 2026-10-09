# V119 shared security controls

STATUS: CURRENT
DOMAIN: platform_build

V119 adds PostgreSQL-backed containment and abuse budgets using the V118 bounded transaction boundary. It also fixes ignored asynchronous containment checks in document delivery, credential acquisition, notification delivery and writeback. This is an authorised security integration/defect exception to the pre-TO freeze. It does not establish production readiness or apply a migration to a deployed database.

## Deployment boundaries

Migration 048 creates the private `operational_security` schema and three safe NOLOGIN groups. Provision dedicated restricted direct-login users externally. Never use a schema/database owner, superuser, BYPASSRLS role or shared domain/session-broker login. The domain catalog verifier and session broker now reject these security group memberships. Each adapter checks direct login, inherited dangerous roles, schema ownership/CREATE rights, access to public legal-data/identity relations and narrow grants before application queries.

| Group | Runtime authority |
| --- | --- |
| `legaltech_security_reader` | Read current interlocks and transition events; no mutations or rate/session/legal data |
| `legaltech_security_operator` | Inherits reader; activate/release interlocks and append events; no event rewrite/delete, rate/session/legal data |
| `legaltech_rate_limiter` | Shared budget/configuration tables only; no interlocks, identity or legal data |

All five new tables enable and force RLS. Policies deliberately allow these groups global **control-plane metadata** access. They are not tenant legal-data policies. Trusted server code must bind the authenticated tenant; these adapters are not endpoints for user-supplied SQL or unauthenticated tenant selection. Canonical schema names are required. Validate the complete deployed grants, function authority and managed credentials independently.

`createPostgresOperationalSecurity` constructs the actual reader and limiter instances and exposes their own readiness probes. Bind these to `SECURITY_INTERLOCK` and `RATE_LIMIT_STORE` in the 13-probe V117 readiness coordinator. It exposes no operator. Pass the same interlock to `createPostgresIdentityBoundary` for `NEW_SESSION` containment and to asynchronous egress services. Database pools and the PostgreSQL driver remain deployment dependencies; V119 does not add a production driver lock or a full application entry point.

## Containment behaviour

`PostgresSecurityInterlock.assertAllowed` reads committed state on every call without a local allow cache. An exact active control denies that operation; `ALL_EGRESS` denies the five egress operations but does not block `NEW_SESSION`. Unknown operations, storage failures and unsafe roles fail closed. Empty state permits an operation only after a successful shared transaction. Probes check read access, role/grant posture and actual forced RLS, without changing containment.

The separate `PostgresSecurityInterlockOperator` requires an asynchronous current `authorizeChange` callback that resolves to exactly `true`, with tenant/actor/control/action binding. Never supply a permissive callback in deployment. The operator requires real UUID tenant/actor identities, tenant-bound actor foreign keys and constrained trace/incident/reason/resolution codes. No administrative HTTP endpoint is introduced.

Transaction-scoped advisory locks serialize a tenant/control key, including initial creation. Active matching incident/reason replays; a conflict cannot overwrite it. A release requires a different currently authorised actor. Release replay requires fresh authorisation. Reactivation gets a new ID. PostgreSQL checks transition and dual-control invariants and appends transition metadata through a trigger in the same transaction. Trigger failure rolls the state change back. Runtime event updates/deletes are not granted. These local transition events do not replace the separately required managed audit sink or immutable audit archive.

Changes return after COMMIT. An uncertain commit returns `SECURITY_INTERLOCK_OUTCOME_UNKNOWN`; operators must reconcile state, never automatically repeat a destructive action. Readers cannot claim an allow result when their transaction is uncertain. Containment is a checkpoint: an operation admitted before activation may already be in flight. This patch does not promise atomic cancellation of external writes or a distributed lease around them.

Document issue/redemption and credential acquisition await containment, including a second check after asynchronous lookup. Acquired credential bytes are wiped if that final gate denies. Notification workers await the gate before claiming external work, and writeback waits before reserving a write. A denied external notification still permits the existing in-app fallback. The synchronous reference export registry uses `assertSynchronousInterlock` and refuses a promise with `ASYNC_SECURITY_INTERLOCK_REQUIRED`; it cannot silently bypass a remote gate. An asynchronous production export service remains deployment work.

## Shared request and read budgets

`PostgresAbuseLimiter` supplies the existing awaited HTTP `checkIp`, `checkTenant` and `checkRead` interfaces. Supply one managed random HMAC key of at least 32 bytes, the same policy on every instance and a dedicated limiter pool. The adapter copies the key and stores only keyed SHA-256 bucket/matter hashes. No raw peer IP, tenant/actor/matter identifier, legal content or HMAC key is persisted in these tables.

Run `initialize()` as an explicit controlled bootstrap step before admitting requests. It inserts an immutable singleton fingerprint of the key and all policy values, then verifies it. A wrong key/policy cannot initialise over an existing record. Both the probe and every debit require a matching fingerprint; a missing/mismatched record denies admission. Bootstrap is not performed by a readiness probe. Configuration changes and key rotation require a reviewed rollout/reset and may reset budgets; do not delete this row to troubleshoot production traffic.

Each keyed bucket is locked for the full transaction. Window start/expiry uses PostgreSQL time rather than application wall-clock time. Live windows retain counts; expiry clears old distinct-matter rows before changing their referenced window generation. Database constraints cap counters, prevent policy rewrite and reject premature window reset/counter regression. Concurrent instances sharing a configuration cannot independently allocate a full budget. Per-actor read counts and distinct matters aggregate across resources, so switching endpoints cannot reset a budget. Duplicate matter IDs count once for distinct coverage. Denied debits roll back. Serving proceeds only after an acknowledged COMMIT; an uncertain debit denies the request even if the debit persisted.

Exceeded budgets return 429 (`RATE_LIMITED` / `READ_VOLUME_LIMITED`); unavailable/unsafe/uncertain stores fail closed with 503. Validate integer policies and read volume inputs strictly. The fixed windows permit the usual burst across a window boundary; this is not a sliding-window or concurrency limiter. Trusted HTTP code must supply actual returned record counts and authorised matter IDs.

IP accounting uses the socket's direct peer and ignores `X-Forwarded-For`. Mapped IPv4 is canonicalised. At a reverse proxy, this conservatively accounts for the proxy peer; deployment must provide a separately verified trusted ingress identity strategy before claiming per-client accuracy. Do not trust arbitrary forwarded headers. No proxy-trust feature is added here.

Buckets and expired distinct rows need an operator-owned retention/capacity plan. Normal limiter credentials cannot delete buckets or rewrite shared configuration. Unbounded unique ingress identities can create storage pressure; deploy an ingress limit, alerting and controlled cleanup that excludes active buckets. Connection/statement/lock/callback deadlines bound requests, and failed/uncertain transactions discard their connections. Cross-schema SQL callbacks are trusted server code, not a SQL sandbox.

## Evidence and remaining work

The PostgreSQL CI job now executes all 48 checksum-pinned migrations and tests actual narrow roles/RLS, shared activation and release, transition history, configuration mismatches, concurrent tenant budgets, actor count/distinct coverage, IP spoof resistance and database-time rollover, in addition to V118 session/tenant tests. It must pass before merge. Live PostgreSQL execution was not available locally; skipped integration tests and unit mocks are not evidence that the SQL executed successfully.

Shared production audit, queues, operational controls, real directory authorisation, managed secrets, readiness wiring and deployed validation remain outstanding. Migration rollout requires the existing controlled migration/deployment workflow; merging this patch does not apply migration 048 or admit customer data.

PostgreSQL transaction-level advisory locks are documented in the [PostgreSQL 17 locking reference](https://www.postgresql.org/docs/17/explicit-locking.html). Use the same checked-out client for the entire transaction, as required by [node-postgres transactions](https://node-postgres.com/features/transactions).
