# V39 — Durable writeback safety

Lifecycle: **current engineering defect fix and synthetic failure tooling**.

## Reproduced defects

The V38 worker queued every external error for another write attempt. A local
failure reproduction produced two createHistory calls after an uncertain first
outcome. Its successful receipt was not persisted until read-back completed, so
read failure could resend an already-applied write. New approval keys could also
queue the same event again, and the UI reported reconciliation success regardless
of the worker result. These are defects inside the existing approved path, not
new legal workflow scope.

## Behavior and durability

- Approval, exception resolution, durable write intent, job creation, idempotency
  results and approval audit are committed together using SQLite savepoints.
- The existing local idempotency store holds a tenant-qualified command record
  with event/matter binding, original approval, immutable source classification,
  state, receipt and separate bounded write/read attempt counters. No schema
  migration or destructive reset is needed.
- Before any external call, ATTEMPTING and its audit record must commit. Failed
  intent/audit persistence prevents the call. A later receipt-storage failure
  leaves this durable marker, so recovery reads instead of resending.
- A returned external ID is persisted before read-back. SUCCEEDED means a receipt
  exists; only a unique matching history entry permits RECONCILED / COMPLETED.
- Transport errors, missing/malformed receipts and abandoned ATTEMPTING records
  remain OUTCOME_UNKNOWN. Neither a retryable flag nor an empty history result
  proves that no write occurred. Recovery for these states never calls createHistory.
- Only the trusted adapter's KnownWriteFailure contract permits another write,
  and only when it proves no external effect occurred and marks the error retryable.
  Both write and read cycles are bounded to three attempts in this synthetic model.
- Read-back checks tenant, target matter, command key, source event, classification
  and external ID when known. Multiple matching records remain ambiguous.
- Expired local worker leases (five minutes) can return a running writeback job to
  the queue without clearing durable intent. Reclaimed attempts are read-only
  unless the durable record proves the write was never attempted or failed known.
- Late worker results cannot downgrade completed reconciliation. Lifetime attempt
  history is preserved across operator recovery; legacy counts are not a claim to
  reconstruct all historical external calls.
- Fresh keys cannot approve an approved/completed/rejected event again. Approval
  replay is bound to event and matter. Resolved decisions cannot be reversed into
  another external action, and exceptions must belong to the approved event.
- HTTP dev-worker requests scope queue selection and lease recovery to the
  authenticated tenant and can select one authorized event. Background worker
  calls without a request context retain the existing multi-tenant worker behavior.

## Read-only recovery API

`POST /api/v1/inbound-events/{id}/reconcile-writeback`

Requires `integration:manage`, `inbound:read` and `Idempotency-Key`; derives tenant
and actor from the authenticated session. Another tenant's event, an unavailable
event and a denied capability return safe 404 responses. Tenant spoofing is denied.

The operation reuses a queued verification job or schedules a read-only job.
A running/abandoned write can be checked concurrently without reclaiming or
resending it. Operator requests append attributable audit records. Completed
commands return COMPLETED without adding a job. Repeating the same request key
returns its original result; input cannot force an external write.

The local dev-worker drain API now also accepts optional `eventId`. Its context
is server-derived. UI approval/recovery uses this selection so another queued job
cannot create a false success message for the chosen event.

## Operator runbook

1. Inspect the inbound event and its audit trace.
2. OUTCOME_UNKNOWN means a write may have happened; do not reapprove, resend or
   delete its durable intent. RECONCILING means a receipt awaits read-back proof.
3. Use Verify outcome to schedule/read existing target history. Recovery is
   read-only even after read attempts are exhausted or a write remains running.
4. If evidence is absent, malformed, conflicting or unavailable, leave the action
   blocked and investigate. Empty history is never treated as proof of no write.
5. WRITE_FAILED represents a known failure; it has no UI bypass for another write.
6. The UI says success only when the selected event's read-back is verified.

## Upgrade and rollback

Existing queued V38 work is upgraded lazily. A prior attempt without a durable
receipt is treated as uncertain; a retained receipt is read back rather than
rewritten. Existing completed events remain completed. Local database/object data
is preserved, including the durable intent in the existing idempotency table.

Prefer a forward fix. Do not revert to the V38 worker and drain uncertain/pending
work: that worker lacks these protections. Pause processing and preserve the
local database before any code rollback. Reverting UI alone does not authorize
another external write.

## Hard boundary

All validation uses synthetic adapters and data. The failure adapter deliberately
has no native idempotency, so it cannot hide duplicate worker calls. This does not
prove real Proclaim marker support, permissions, response guarantees, eventual
consistency or live write behavior. Real adapter capability/read-back evidence,
production queue leasing, Postgres/SSO and customer access remain gated. Security
changes still require human review before merge. D-018 and product evidence gates
remain unchanged.
