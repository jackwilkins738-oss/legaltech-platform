# V141 — Exact emergency-stop release fencing

Both the reference and PostgreSQL operator previously released whichever stop was
currently active for a tenant/control. A delayed request from incident A could
therefore release a newly activated stop for incident B, or a later activation of
incident A. Release replay also returned another actor's prior release without
checking that its resolution matched the retried operation.

## Required operator pins

`SecurityInterlockRegistry.release` and `PostgresSecurityInterlockOperator.release`
now require exactly:

```js
{
  tenantId, control, interlockId, incidentId,
  actorId, traceId, resolutionCode
}
```

Capture `interlockId` from the reviewed activation receipt's `id`, together with
its `incidentId`. The reference `releaseBinding({tenantId, control})` returns a
frozen observation for an operator to review. It grants no release authority.
PostgreSQL operators can use the exact activation receipt or a separately approved
operator review of the stored row; the public reader status stays metadata-minimal.
Never silently fetch fresh pins to retry an old request. A stale pin requires a
new review of the new stop and a separately authorized release decision.

Missing pins, accessors, inherited fields, symbols and extra mutation fields are
refused. Existing release callers must adopt the new required fields; there is no
unfenced compatibility fallback. The old/reference integration fixtures now
capture the exact activation they intend to release.

The registry compares activation ID and incident before mutation. Rearming creates
a new ID even for the same incident. Current release authorization receives the
exact activation/incident and requested resolution, and still requires an actor
different from the activator. Successful replies explicitly return `replayed:
false`. Only an exact same-ID/incident/actor/resolution retry can return `replayed:
true`; it still requires current authorization and creates no additional event.
A changed trace is allowed for a retry, but does not fabricate a new release event.

## PostgreSQL transaction boundary

The existing operator-only pool, role checks, advisory transaction lock and
`FOR UPDATE` read serialize the current tenant/control state. The locked row is
read and compared to the reviewed pins before the authorization callback. The
callback receives the transaction cancellation signal and exact pins/resolution.

The release UPDATE additionally predicates on tenant, control, activation UUID,
incident ID and ACTIVE state. Exactly one returned row must match the requested
identity, released actor and resolution. Malformed/unexpected receipts fail closed
and destroy the transaction backend rather than returning it to another caller.
Database triggers still record release evidence in the same transaction. No new
migration, privilege or dependency is needed; existing SQL rearm constraints
require a distinct activation ID.

`SECURITY_INTERLOCK_RELEASE_STALE` means the observed activation/incident no longer
matches; `SECURITY_INTERLOCK_RELEASE_REPLAY_MISMATCH` means an existing release
belongs to another actor or resolution. The existing `SECURITY_INTERLOCK_OUTCOME_UNKNOWN`
remains distinct when COMMIT cannot be confirmed. Retry must retain original pins;
an uncertain commit is never reported as a confirmed release.

## Validation and limits

50 new local regressions cover stale rearm for same/different incidents,
missing/substituted pins, exact/mismatched replay, current authorization,
strict request shapes, dual control, locked SQL predicates, unexpected database
receipts, callback mutation of the caller object, and uncertain COMMIT. Two real
PostgreSQL cases use independent pools to check stale pins, same-stop concurrent
release/replay, authorization context and one atomic release event.

Local: 2,997 platform tests, 140 scaffold tests and 38 security-policy tests pass.
Security scanner is clear; knowledge lint has zero errors/warnings. Native
PostgreSQL cannot run locally; both new cases and the full PostgreSQL 17 GitHub CI
suite must pass before merge.

This hardens the existing durable operator and reference API. It does not add a
public emergency administration endpoint, operator UI or deployment. Direct SQL
operator credentials remain trusted; a database superuser or direct UPDATE can
bypass this application request-review contract. Provider/operator current authority,
deployment-wide emergency drills, approval provenance, incident adapter adoption
and reconciliation of uncertain outcomes remain operating requirements. Reference
Maps still do not persist or coordinate across processes. The D-018/pre-TO/customer-
data gates and the V131 writeback execution pause remain in force.
