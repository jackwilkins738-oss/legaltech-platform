# V122 — Transactional domain outbox

V121 queue insertion used a separate transaction from domain writes. A crash after the domain commit could therefore lose the corresponding job. V122 adds a PostgreSQL domain transaction wrapper that appends a metadata-only intent on the same checked-out connection and commits both together. A relay inserts the job using V121's immutable replay contract, then appends a delivery receipt. A crash between those commits leaves the intent pending; the next relay run replays the same queue job.

## Server composition

`PostgresDomainOutbox({pool,expectedRole,authorizeAppend,timeoutMs})` uses the actual restricted domain pool. Grant its login membership in the new NOLOGIN `legaltech_outbox_writer` group, in addition to its reviewed domain grants. It must have no outbox receipt insert privileges, no UPDATE/DELETE/TRUNCATE on either outbox table, and no private control-plane access. Runtime catalog validation, forced RLS and the exact outbox grant check execute inside every wrapped transaction. Migration 051 is now required by runtime verification.

```js
const result = await domainOutbox.run({tenantId, actorId, signal}, async tx => {
  // Trusted server code must authorize and bind the actual domain object here.
  // Its mutations must be replay safe when reconciling an uncertain COMMIT.
  await tx.query(domainSql, domainParameters);
  await tx.enqueue({
    tenantId, jobId, kind: 'PROCESS_INBOUND', objectId,
    traceId, idempotencyKey
  });
  return response;
});
```

The callback is trusted server SQL, not a sandbox or a client API. All domain writes must use its `tx.query`; every `tx.enqueue` must be awaited. The wrapper rejects pending enqueue calls and poisons the transaction even if a callback catches an append error. Escaped queries/appends cannot execute after the callback. The returned enqueue receipt is provisional inside the callback; expose it to callers only after `run` resolves. Domain-only callbacks are permitted and require the application's own domain authorization.

Enqueue binds tenant UUID, stable job UUID, kind, object UUID, trace and idempotency hashes, and bounded queue policy. It stores neither arbitrary payload nor raw trace/idempotency values. Migration 051 validates the exact eleven canonical fields, types, ranges, tenant/job/object/key binding and SHA-256 digest. Timestamps come from the database. A matching stable-ID replay returns the existing intent; a changed binding fails the entire transaction. Object IDs are opaque references, so `authorizeAppend` must check the actual object and workflow permissions, existence and tenant binding. RLS enforces tenant boundaries; object-level authorization remains a server responsibility.

`OUTBOX_DOMAIN_COMMIT_OUTCOME_UNKNOWN` means the domain mutation and intent may both have committed. Reconcile using the same stable job ID and replay-safe domain command. The wrapper does not make arbitrary domain mutations idempotent.

## Relay composition and recovery

Create a dedicated direct-login relay identity inheriting only `legaltech_outbox_relay`, with a separate pool and no domain-object or queue table grants. `PostgresOutboxRelay({pool,expectedRole,authorizeRelay,jobProducer,timeoutMs})` accepts the actual V121 `PostgresJobProducer` configured with its own producer pool and current `authorizeEnqueue` callback. Queue producers cannot read the public outbox; domain and relay identities cannot access the private queue. Session and other security boundaries reject outbox group mixing.

Call `relay.relay({tenantId,actorId,limit,signal})` for an independently authorized tenant/service actor. Limits are 1–100, default 25. The relay is tenant scoped; it does not enumerate tenants, run a timer or create service identities. Current authorization is checked at scan, each enqueue and each receipt acknowledgement, under bounded PostgreSQL transactions. Queue authorization is independently checked by the producer. Signals propagate through both boundaries.

The scan selects unreceipted immutable intents in database order. Concurrent relays may select the same event: the producer serializes enqueue and checks all immutable metadata, then the receipt's primary key deduplicates acknowledgement. No lease or distributed transaction is needed for this metadata relay. The relay verifies the queue receipt's tenant/job/kind/object/trace binding before acknowledgement; receipt foreign keys bind the original event hash.

A failed or unknown queue insertion receives no receipt. `QUEUE_ENQUEUE_CONFLICT` requires investigation of the conflicting metadata; it is never auto-overwritten. `OUTBOX_ACK_OUTCOME_UNKNOWN` means a queue job exists and its receipt may have committed. Repeat the bounded scan. An error can occur after earlier jobs in a batch committed; it is not evidence that the entire batch rolled back. Pending malformed or unauthorized intents fail closed and need operator investigation. This version provides no skip/dead-letter API for outbox intents.

Receipts mean queue insertion committed, not job execution completed. The queue and outbox retain replay records; deleting them would invalidate replay safety and needs a separately reviewed retention design. This version grants no runtime mutation or purge capability.

## Validation and deployment boundary

Local regression tests cover shared-connection commit/rollback, swallowed and abandoned appends, immutable replay, malformed metadata, current-authority withdrawal, tenant isolation, queue/receipt crash windows, ambiguous commits and deadline failure. The PostgreSQL CI job runs all 51 checksum-pinned migrations and adds six V122 tests for real rollback, concurrent relays, prior queue commit, RLS/grants, SQL metadata validation and withdrawal before acknowledgement. The job is skipped locally because this environment has no PostgreSQL or pg driver; CI must pass before merge.

This is an adapter and composition API. Existing SQLite reference services/workers remain unchanged; real domain handlers must explicitly adopt the wrapper, supply current authorization and start a supervised relay. No deployment, production readiness canary or live validation has been performed. Add a functional outbox canary to the real production composition; catalog checks alone are insufficient. Queue fencing still does not provide exactly-once external effects. Proclaim and notification recovery still require downstream idempotency/readback and reconciliation.

PostgreSQL RLS behavior is grounded in the official [PostgreSQL 17 row-security documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html). Direct roles remain non-owners without BYPASSRLS; forced RLS is required, and TRUNCATE is denied by privileges.
