# V118 — Shared PostgreSQL identity boundary

STATUS: CURRENT
DOMAIN: platform_build / security_privacy

V118 replaces the process-local session path with a composable PostgreSQL session/revocation adapter and supplies a tenant transaction boundary for production domain adapters. It wires asynchronous issuance, revocation and containment into the existing cookie service, and adds a real PostgreSQL CI integration job. This is an authorised security/integration exception under D-018. The complete production application, shared containment/rate/grant adapters and live deployment verification remain outstanding.

## What is composed

`createPostgresIdentityBoundary` returns one PostgreSQL session store, its cookie authentication provider, its session exchange/logout service and the matching `sessionProbe`. Use that probe for the mandatory SESSION_STORE registration; pass the returned authProvider and identitySessionService to the API root. Supply a verified ProductionOidcAuthProvider, a current authoritative identity resolver, a dedicated broker pool/login, an issuer namespace matching that verifier, an HTTPS origin and a real securityInterlock adapter. The factory rejects an absent interlock or a static OIDC substitute. Coverage registration still does not attest that supplied providers are honestly bound or deployed.

IdentitySessionService now awaits the interlock, session issue and logout revocation. A rejected asynchronous interlock cannot mint a cookie; a failed or uncertain shared commit cannot produce successful sign-out. Its `logout` method is now asynchronous and must be awaited. The HTTP route and existing tests were updated. Production startup also rejects cookie/exchange services hiding the built-in in-memory store. Synthetic in-memory use remains supported outside production.

## Separate security roles

Migration 047 creates a NOLOGIN `legaltech_session_broker` group, the private `identity_security` schema, hashed session records and provider-session revocation tombstones. Provision a dedicated restricted login with that membership; do not give it database/schema ownership, administrator/bypass roles or legal-data table privileges. The migration identity must have controlled role-provisioning authority or the safe group must already exist.

The API's **domain runtime pool** uses a different direct restricted login. Its V117 DATABASE_RUNTIME check now rejects session-broker membership. The **identity broker pool** authenticates opaque credentials before a tenant context exists. Broker-only global lookup is intentional and restricted to authentication metadata; it is not a tenant-filtered legal-data query. Both private tables force RLS with explicit broker-role policies. Domain logins cannot use that schema. The broker rejects privileged role membership, ownership/CREATE authority and any table/column DML/read authority on canonical public domain relations.

The schema and adapter use the canonical public domain schema. Do not assume alternate application schemas are checked by the broker privilege guard. A different layout needs a reviewed implementation change. Configure finite pool size/connect/acquisition deadlines and verified TLS/workload credentials in the deployment root. The adapter accepts an existing driver-compatible pool; it does not create, log or retrieve production credentials.

## Session behaviour

- Tokens contain 32 random bytes; only SHA-256 token hashes are stored. Provider session IDs are hashed together with the configured issuer namespace. Legal content, bearer tokens, capabilities, memberships and raw provider IDs are not persisted in these tables.
- Session records retain the actor/tenant binding and verified MFA/authentication/expiry metadata. Every successful read re-resolves current identity/permissions; an unavailable, disabled or differently bound identity denies access. The resolver must explicitly reject inactive accounts and be bound to an authoritative source.
- Database time enforces absolute and idle expiry. Absolute lifetime is capped at the earlier of configured lifetime and verified OIDC expiry. Configured absolute bounds are 5 minutes–24 hours; idle bounds are 1 minute–2 hours and cannot exceed absolute lifetime.
- After an asynchronous identity lookup, an atomic conditional UPDATE rechecks expiry, individual revocation and provider revocation before authenticating. Concurrent instances share that state. Requests already authorized before a later revocation may finish; operation-level checks remain required.
- Provider revocation commits a persistent issuer-scoped tombstone and revokes matching existing records in the same transaction. Later issuance for the same provider session is denied. Invoke this server-only operation from an authenticated provider/admin path; no public revocation endpoint is introduced. Provider session-ID reuse and tombstone retention must be reviewed for the actual issuer.
- Readiness checks the direct broker identity, RLS state and narrow read/issue/touch/revoke privileges, rejecting expiry rewrite or deletion/truncation authority. It is a bounded posture check, not an account-level mutation test or full policy/body attestation.

Record and expire identity metadata through an approved retention process. The broker has no DELETE/TRUNCATE grants; V118 does not introduce automatic purging, a revocation override or a local-store fallback. Database encryption, backups, audit export and provider outage operations still require deployment evidence.

## Tenant transactions

`PostgresTenantTransactions.run({tenantId, actorId, readOnly, signal}, work)` accepts UUID scope derived from a trusted authenticated/worker resolver. It checks direct runtime login and empty initial context, keeps all queries on one checked-out connection, sets transaction-local tenant/actor parameters, applies bounded statement/lock deadlines, and verifies context cleared after COMMIT before returning the connection.

Callbacks receive only a query facade and abort signal. They are trusted server code containing fixed SQL and bound values, not a sandbox for arbitrary client SQL. Await every query. Forgotten pending queries, SQL/callback errors, cancellation, timeouts or stale context destroy the backend. The callback cannot send queries after completion or timeout, including after late pool acquisition. A failure during/after COMMIT is POSTGRES_TRANSACTION_OUTCOME_UNKNOWN; do not blindly retry mutations. External effects are not made transactional by this helper.

The current domain/store implementations remain synchronous reference APIs. This transaction wrapper is a foundation for actual asynchronous domain adapters; do not replace their methods with raw asynchronous driver calls and assume they are composed. Shared worker/document/export one-use claims, audit transactions, rate admission, containment and operational provider bindings remain separate work.

## Verification and deployment

The local regression suites exercise adapter orchestration with fake drivers. The new `postgres-security-integration` CI job uses a disposable PostgreSQL 17 database and node-postgres 8.23.0, executes all 47 checksum-pinned migrations, provisions separate restricted test logins and checks actual role separation, RLS reads/writes, concurrent tenant transactions, rollback/timeout cleanup, cross-instance session issuance/revocation, provider tombstones, revocation during directory lookup and database-time expiry.

The integration test refuses any database name except `legaltech_security_ci` and refuses a populated schema. It is disabled in normal local tests unless LEGALTECH_RUN_POSTGRES_TESTS=true, avoiding accidental database writes. Its CI service/credentials are synthetic and must never be reused for deployment. The test driver is installed only for that job with lifecycle scripts disabled; the production build still needs its own locked dependencies, image digest and verified release evidence.

PostgreSQL is unavailable in the current review environment, so the real integration job has not been executed here. Require that specific PR check to pass before merging; then separately execute V117 runtime/isolation verification and actual provider/role/pool checks against controlled deployed environments. A green synthetic CI job is not live production validation. Git application/merge does not execute migration 047, provision logins or compose the remaining production services.

Primary driver contract: [node-postgres transactions](https://node-postgres.com/features/transactions), [pool release/deadlines](https://node-postgres.com/apis/pool) and [parameterized queries](https://node-postgres.com/features/queries). Driver release version: [upstream changelog](https://github.com/brianc/node-postgres/blob/master/CHANGELOG.md).
