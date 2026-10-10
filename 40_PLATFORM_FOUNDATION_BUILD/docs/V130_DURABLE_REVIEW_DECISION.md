# V130 — Durable human review decision

**Lifecycle:** current engineering foundation, under the authorised D-018 integration exception. Product workflow remains evidence-gated.

V129 made the production-shape PostgreSQL path run from an approved source to an adopted, verified PROCESS_INBOUND result. V130 adds the next step on that same path: a durable human review decision on that adopted result. It does not execute a Proclaim write, reconcile one, or claim any legal outcome. An approval only queues a writeback job; executing and reconciling that job against the mock (and later an authorised) Proclaim adapter is separate work.

## Decision record (migration 056)

`public.domain_review_decisions` holds one immutable decision per inbound event:

- `APPROVE` names an open matter in the same tenant and carries the writeback job ID; `REJECT` names neither. A table check enforces this shape.
- The decision is bound to the exact adopted result by a composite foreign key on `(tenant_id, result_job_id, 'PROCESS_INBOUND', event_id, result_hash)` against a new unique constraint on `domain_job_results`. A decision cannot name a result that was never adopted, a different event's result, or a forged hash.
- `decided_by` must be an active `USER` in an active tenant. Service identities cannot decide. The RLS insert policy also requires `decided_by` to be the transaction's current actor.
- `decision_key_hash` (tenant-scoped SHA-256 of the caller's decision key) and `request_hash` (SHA-256 of the canonical decision, including the result hash, the writeback job and the trace) are unique and immutable.
- An approval's writeback job is a deferred foreign key into `domain_outbox_events` with kind `PROCLAIM_WRITEBACK` and the event as object, so the decision and its single writeback intent commit together or not at all.

A deferred constraint trigger checks identity, open-matter and event state at commit. A `BEFORE UPDATE OF status` trigger on `inbound_events` lets a reviewer move an event only from `PROCESSED` to `APPROVED` or `REJECTED`, and only when that same actor's matching decision exists. A decision without its transition, a transition without a decision, and a decision against a forged result all fail in the database, not only in the handler.

The table is append-only: reviewers have SELECT and column-exact INSERT, never UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER. Row level security is enabled and forced. The new runtime catalog check lists the table as required.

## Separation of duties

`legaltech_domain_reviewer` is a new NOLOGIN group. The handler refuses to run unless the session holds it and holds neither `legaltech_domain_result_writer` nor `legaltech_domain_commands`. The identity that adopts a machine result, or authors the processing command, is never the identity that approves it. The reviewer may read adopted results (new tenant-scoped read policy) but can never write one. Deployments should give reviewers their own login and pool.

## Handler

`PostgresReviewDecisions({domainOutbox, authorizeDecision}).decide({tenantId, actorId, eventId, decision, matterId, decisionKey, traceId, signal})`:

1. Rejects malformed input before opening a transaction. Approvals require a matter; rejections refuse one.
2. In one outbox transaction: verifies its grant/RLS/trigger posture and the separation of duties, then takes a per-event advisory lock.
3. Loads the actor (active USER, active tenant), the event (row-locked, INBOUND_DOCUMENT) and exactly one adopted PROCESS_INBOUND result for it.
4. Asks `authorizeDecision` with the exact binding, including the result hash. Anything but `true` is FORBIDDEN, and provider errors are reported only as `REVIEW_DECISION_AUTHORIZATION_UNAVAILABLE`.
5. If the event already has a decision, or the key is already used, it is a replay only when every bound field matches. Otherwise it returns `REVIEW_DECISION_CONFLICT`.
6. A first decision requires a `PROCESSED` event and, for approval, a visible open matter. It inserts the decision, moves the event, and for approval enqueues one `PROCLAIM_WRITEBACK` intent. The job ID is derived from tenant and event, and the idempotency key names the event, so no path can queue a second write for the same document.

Results: `DECIDED` receipts (with `replayed`), or `REVIEW_DECISION_INPUT_INVALID`, `_FORBIDDEN`, `_CONFLICT`, `_AUTHORIZATION_UNAVAILABLE`, `_UNAVAILABLE` or `_COMMIT_OUTCOME_UNKNOWN`. An unknown commit is never reported as success or failure.

## Validation

13 handler regressions cover approval and rejection, replay, conflicting decisions, keys and traces, identity rules, unadopted and missing events, matter rules, current authority, unsafe posture, rollback on a failed transition or enqueue, ambiguous commits, input checks and hash/key/job derivation.

Seven real PostgreSQL cases cover:
- the atomic approval with its writeback intent, and replay;
- rejection with no writeback;
- conflict immutability;
- unadopted events, closed or cross-tenant matters, service actors and withdrawn authority;
- direct-SQL attempts (decision without transition, transition without decision, forged result hash, another actor as `decided_by`);
- append-only grants, tenant RLS and denial to every other principal, and separation of duties (a reviewer that also holds the result-writer group is refused);
- a disabled decision trigger failing closed.

These ran locally against PostgreSQL 16 (105/105 with the existing suite). CI runs them on PostgreSQL 17.

## Not proven / outstanding

- Writeback execution: claiming the `PROCLAIM_WRITEBACK` job, the mock Proclaim write, read-back reconciliation and audit of the external outcome.
- A review UI on the durable path, and the real identity provider and permission adapters behind `authorizeDecision`.
- Real Proclaim behaviour of any kind. Nothing here is evidence about Proclaim.
- The pre-TO freeze and the customer-data deployment gate remain in force.
