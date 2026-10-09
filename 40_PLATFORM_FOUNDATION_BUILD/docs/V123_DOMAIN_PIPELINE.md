# V123 — PostgreSQL domain handlers and supervised outbox relay

V123 connects concrete inbound-registration and policy-evaluation request handlers to V122's domain outbox, and composes them with the actual PostgreSQL producer/relay and an explicit relay supervisor. Command replay is now checked against durable domain records before reusing the corresponding intent.

## Domain handlers

`PostgresDomainJobHandlers({domainOutbox,authorizeDomain})` provides two asynchronous methods:

- `registerInbound({tenantId,actorId,commandId,jobId,eventId,payloadId,payloadHash,sourceSystem,externalEventId,traceId,signal})` creates a real `public.inbound_events` row, an immutable command and `PROCESS_INBOUND` intent in one transaction. Source systems are `MANUAL`, `MANUAL_UPLOAD` and `MICROSOFT_GRAPH`. Provider-event and trace identifiers are hashed before SQL persistence. The payload reference is `object:<payload UUID>`; bytes, subjects, bodies and attachments are refused by this API.
- `requestPolicyEvaluation({tenantId,actorId,commandId,jobId,matterId,policyVersionId,policyVersionHash,traceId,signal})` records an immutable policy request and `POLICY_EVALUATION` intent against a currently visible, open matter. It accepts an exact version UUID and SHA-256 digest; it does not evaluate a policy in the request transaction.

UUIDs must be valid, hashes lowercase SHA-256, and trace/provider-event identifiers bounded ASCII identifiers of 1–256 characters. Allocate command/job/object UUIDs before invoking a handler and preserve them across retries. Namespace provider-event IDs by the trusted provider/mailbox context where required. The handler serializes commands per tenant, rejects job/command reuse with changed metadata, and rejects a second inbound command for an already registered event/source. Domain objects and commands are created once. Replay still checks current authorization and object bindings; an old command is not permission to access a resource after authority is withdrawn.

The active actor and tenant are read from PostgreSQL on each invocation. `authorizeDomain` must return strict `true` for current capability, object, origin and version authorization. For inbound commands it must independently verify the managed payload ID/hash, ownership, provenance and allowed quarantine/processing state. Graph intake must be authenticated and validated before invoking this handler. For policy requests it must verify that the version ID/hash represents the exact authorized immutable published version. These callbacks are mandatory deployment dependencies, without allow-by-default fallbacks. Database actor flags are checked at the transaction's authorization decision; workers must recheck current authority at execution.

The distinct V122 `authorizeAppend` callback also runs before intent append. A new inbound event is uncommitted at that point, so authorize the transaction's trusted binding and existing payload provenance rather than trying to read that new event through another connection.

Receipts report `ACCEPTED`, which means the domain command and intent committed; they do not report execution success. `DOMAIN_COMMAND_COMMIT_OUTCOME_UNKNOWN` requires reconciliation using the same IDs and metadata. `DOMAIN_COMMAND_CONFLICT` requires investigation or a genuinely new command, not automatic ID regeneration to conceal the conflict.

## Migration and roles

Migration 052 creates forced tenant-RLS `public.domain_job_commands` with exact actor-context INSERT policy, composite tenant/actor/object foreign keys and append-only column grants. Payload and policy hashes bind the immutable content version. Two deferred foreign keys require the matching outbox intent's hash and tenant/job/kind/object binding at commit. A command cannot commit without its bound intent. This uses PostgreSQL's documented [deferred foreign-key behavior](https://www.postgresql.org/docs/17/sql-createtable.html).

Grant the reviewed direct domain login membership in `legaltech_outbox_writer` and the new NOLOGIN `legaltech_domain_commands` group. It needs SELECT on actors/tenants, SELECT/INSERT on inbound events and SELECT on matters plus the ACL relations/functions required by existing RLS. It needs no tenant/actor mutation privileges for these handlers. Command INSERT grants exclude database timestamps, and runtime UPDATE/DELETE/TRUNCATE are refused. Runtime verification now requires migration 052. Queue, relay and session broker identities must not inherit the domain command group or receive domain table access; the shared role checks reject that mixing.

## Connected composition

`createPostgresDomainPipeline` requires three distinct pools and expected direct-login roles: domain runtime, metadata relay and queue producer. It constructs the actual V122 outbox, V121 producer, V122 relay, concrete handlers and supervisor. All domain/append/enqueue/relay/scope authorization callbacks, scope provider and drain adapter are required. Construction opens no connections and starts no timer.

```js
const pipeline = createPostgresDomainPipeline({
  domainPool, expectedDomainRole,
  relayPool, expectedRelayRole,
  producerPool, expectedProducerRole,
  authorizeDomain, authorizeAppend, authorizeRelay, authorizeEnqueue,
  getScopes, authorizeScope, drain
});

// Call from a trusted, authenticated ingress application.
const accepted = await pipeline.handlers.registerInbound(command);

// Explicit service lifecycle, after deployment admission succeeds.
pipeline.supervisor.start({signal: shutdownController.signal});
// On shutdown, await and inspect drained before closing pools/exiting.
const stopped = await pipeline.supervisor.stop({timeoutMs: 5000});
```

The return value is a frozen `{handlers,supervisor,relayProbe}` composition. The application must derive tenant/actor from its validated identity boundary and supply server-approved object/version metadata; client JSON is not an authority source. Existing SQLite HTTP routes have not been switched to this pipeline. HTTP composition, shared audit coverage, actual provider bindings and execution workers still need deployment wiring and validation.

## Relay supervision

`getScopes({signal})` returns a fresh bounded array of exact `{tenantId,actorId}` objects every cycle. Duplicate tenants and malformed scopes fail closed. `authorizeScope({tenantId,actorId,operation:'OUTBOX_RELAY_CYCLE',signal})` must return strict `true` for a current active service identity and tenant, including applicable containment/lifecycle restrictions. The supervisor does not enumerate tenants using privileged database credentials.

Each cycle acquires a BACKGROUND drain lease before any work and releases it after actual effects settle. The drain adapter provides `acquire` and `release`; acquisition returns a token and positive safe-integer generation. Bind a real deployment drain adapter. The CI in-memory adapter and accepting callbacks are explicitly synthetic fixtures.

Default polling is 1 second after the previous cycle settles, cycle deadline 30 seconds, maximum 100 scopes and batch size 25 per scope. Poll/deadline bounds are 100–60,000 ms; scope count 1–1,000 and batch size 1–100. Configure these for observed database latency. There is one in-flight cycle per supervisor; concurrent processes remain safe through queue replay and immutable delivery receipts.

A cycle/dependency/authorization error changes health to `FAILED`, aborts its signal and stops polling. Diagnose it and explicitly restart after settlement. A deadline does not imply an uncooperative dependency stopped: the drain lease remains held and restart is denied until its original promise settles. Scope refresh, admissions and actual relay calls all participate in the same deadline.

`stop` immediately prevents new work, clears polling and aborts the current cycle. It waits only to its configured stop deadline. `drained:false` or `STOP_TIMEOUT` means the caller must not assume it is safe to close the pools or exit. An uncertain/failed drain acquisition or release returns undrained and prevents restart; reconcile it through the real drain service before reconstructing the host. An acquisition error is treated conservatively because a remote lease may have been created before its reply was lost. Late acquisition is still released, and pending release is included in shutdown waiting.

`status()` exposes only process state, in-flight flag, completed-cycle metrics, last successful cycle time and fixed error codes. Counts reflect completed cycles, not authoritative queue execution totals. `relayProbe` is healthy only after a fully settled successful cycle while RUNNING. Empty scopes can produce a healthy lifecycle cycle; this is not a substitute for a functional end-to-end readiness canary using the deployed providers and workers.

## Validation boundary

V123 adds 26 local regressions plus six PostgreSQL CI cases covering concrete handler/relay delivery, concurrent command replay, policy object/version binding, rollback after append denial, deferred outbox linkage, command grants/tenant isolation and disabled-service supervision/recovery. The PostgreSQL suite is syntax-checked but skipped locally because no PostgreSQL server or pg driver is available. All 52 checksum-pinned migrations and the new integration cases must pass `postgres-security-integration` before merge.

The supervisor relays metadata; it does not execute inbound/policy jobs. Worker loaders must resolve the job's command, verify payload/version digests and current domain authorization, then apply the fenced claim contract. Production HTTP adoption, workers, canaries and live deployment remain pending. Exactly-once external execution is not established by these components.
