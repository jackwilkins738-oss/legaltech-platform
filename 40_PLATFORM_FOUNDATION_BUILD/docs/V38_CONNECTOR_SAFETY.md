# V38 — Connector safety fixes

Lifecycle: **current engineering defect fix; synthetic integration tooling only**.

The V37 integration harness passed 33 tests but permitted cross-tenant access when
another tenant held integration capabilities, accepted unapproved mailboxes,
and checked duplicate identity before rejecting invalid simulated client state.
This increment repairs those paths under D-018 without changing product scope.

## Changed behavior

- Every integration route verifies the authenticated tenant against the bound
  harness and connection registry before reading or changing state. Unauthorized,
  foreign-tenant and missing resources use the same safe 404 envelope.
- Subscriptions, checkpoints, renewal and delivery recovery enforce configured
  mailbox scope and MAIL_READ. Expired, removed, missed, revoked and out-of-scope
  subscriptions cannot accept notifications or retry deliveries.
- Renew repairs ACTIVE, EXPIRED or MISSED subscriptions. REMOVED requires a new
  subscription; AUTHORIZATION_REQUIRED needs a separately authorized configuration
  change. Lifecycle flags cannot bypass these states, including via MISSED.
- Rejected simulated client-state notifications never enter accepted deduplication
  state or become retryable. Valid notifications arriving afterward remain accepted.
- A JSON tuple including tenant, subscription, explicit synthetic notification ID,
  resource and change type avoids delimiter collisions. Without a synthetic ID,
  repeated updates are retained independently. This does not assert that live Graph
  supplies a notification ID with these guarantees.
- Only ACCEPTED deliveries can fail. Scheduled retry resumes the same attempt
  budget; explicit dead-letter recovery starts a new bounded cycle while retaining
  totalAttempts and recoveryCount. Pending retries degrade health.
- JSON bodies must be objects. Invalid values return 400; forbidden transitions
  return 409; missing/out-of-scope resources return 404, rather than accidental 500s.
- All HTTP connector mutations append ATTEMPT then SUCCESS/FAILED audit records
  with server-derived tenant/actor and request trace. Audit unavailability blocks
  mutation before it starts. Audit entries omit checkpoint tokens, mailbox content,
  caller error text and unvalidated identifiers. Generated delivery/subscription IDs
  link successful actions to their objects.
- Knowledge catalog generation/lint exclude local `.dev-data` runtime state.
- UI reflects effective expiry/scope state, rejected notification count and cycle
  versus lifetime attempts, and labels dead-letter recovery distinctly.

## Recovery runbook

1. Check the Integrations workspace and audit trace.
2. Renew expired/missed synthetic subscriptions before retrying deliveries.
3. Replace removed subscriptions; do not treat renewal as reauthorization.
4. Retry RETRY_SCHEDULED items, or explicitly Recover DEAD_LETTER items.
5. A rejected client-state notification cannot be recovered; fix the simulated
   input and submit a valid notification instead.
6. If audit writes fail, restore the local audit store before trying a mutation.

## Limits and review

This remains an authenticated simulation endpoint, not a public Graph webhook or
verification implementation. Connector state is in memory and resets on process
restart; audit records use the existing durable local store. ATTEMPT and outcome
records are not an atomic transaction with in-memory state; an ATTEMPT without an
outcome requires inspection rather than an assumption that nothing happened.
Production persistence, live Graph/Proclaim, full identity verification and
customer access remain unproven and evidence-gated. Security-sensitive changes
require human review before merge under the existing engineering policy.

Rollback: revert this isolated change through Git on the feature branch. There is
no schema migration or destructive local-data operation.
