# V140 — Confirmed containment and safe emergency-stop release

V140 repairs the V82/V93 reference emergency-control boundary. Incident containment
previously accepted any activation result with a `control` property, including an
unsettled promise or a receipt for another incident. Provider status was not bound
to its tenant, and incident audit callbacks could fail after lifecycle mutation or
return a promise that was ignored. Interlock release could mark a stop RELEASED
before a later clock/event creation failure.

## Emergency-stop transitions

Reference interlock activation/release now change metadata and local events
together using copy-on-write rollback and one validated clock observation.
A failed release leaves an ACTIVE stop ACTIVE. Its existing operation checks
continue to block writeback, export, notification, connector and document delivery.
Read/recovery exceptions and separately authorized release actors remain.
Requests must have exact own data fields; accessors, inherited/extra/symbol fields
are rejected. Clock and authorization callback recursion invalidates the enclosing
change, even if its nested error is caught. Native asynchronous authorization
rejection is consumed and cannot grant authority.

## Incident confirmation and uncertain effects

Containment prevalidates all requested canonical controls before making provider
calls. Successful receipts must be synchronous own-data metadata matching the
tenant, control, incident, reason and ACTIVE state. A status readback must be an
exact `{tenantId, activeControls}` result for the same tenant, with a dense unique
array of canonical controls. Every requested stop must appear before CONTAINED
can be recorded. Promise/malformed/cross-tenant status and receipt outcomes fail
closed. Provider exceptions use generic codes rather than raw messages.

Once provider activation begins, the incident retains a pinned sorted control
plan and reason. Any later failure leaves CONTAINING, `containmentUncertain: true`,
`containmentFailureCode: INCIDENT_CONTAINMENT_UNCERTAIN`, and no successful local
CONTAINED event. This is deliberately different from ordinary metadata rollback:
an external stop may already be active even if its receipt or audit failed.
The safe uncertainty marker is retained even if external auditing is unavailable.
It is not a claim that a partial/failed operation has a durable external audit.

Retry must use the complete identical plan and reason. Same-incident interlock
receipts may replay existing stops; a narrower plan or changed reason is refused.
Recovery cannot begin from CONTAINING or while any required stop is missing.
Closure requires recovery state, an actor different from the opener, and a current
same-tenant status with no active controls, including stops for other incidents.
Incident closure never releases stops itself.

## Evidence and callback contract

Open/evidence/recovery/close failures restore their prior local state, evidence and
events. Each incident transition uses one bounded monotonic clock observation;
interlock provider transitions use their own clocks. Incident audit callbacks must
complete synchronously. Thrown/rejected/thenable audit outcomes cannot commit a
successful local event. Native rejected promises are consumed. Audit callbacks
receive detached frozen event/evidence records. Evidence timestamps require
canonical UTC strings and are checked against the transition clock.

Authorization, provider and audit callbacks may observe only and must not mutate
the same incident registry recursively. Recursion before activation restores
ordinary state; recursion after activation preserves uncertain containment.
External provider effects or audit messages cannot be undone by local rollback.
A sink that emits and then fails may leave external evidence requiring
reconciliation. Production therefore needs a durable operation/receipt protocol;
these reference guarantees do not create a distributed transaction.

## Validation and limits

87 new adversarial regressions cover failed stop release, partial activation,
exact-plan retry, malformed/asynchronous/cross-context receipts and status,
missing containment, thrown/promised audit failures, strict request/control shape,
clock regression, callback recursion, and event-ID failures after mutation.
The 24 previous incident/interlock tests and connected reference export,
credential, session, notification and writeback consumers continue to pass.

Local: 2,947 platform tests, 140 scaffold tests and 38 security-policy tests pass.
Security scanner is clear and knowledge lint has zero errors/warnings. Native
PostgreSQL is unavailable locally; the full PostgreSQL 17 GitHub CI suite must
pass before merge. No migration/dependency is added.

These registries remain process-local metadata references, with synchronous
provider callbacks and copy-on-write cost proportional to registry history.
Their guarantees do not survive restart or provide multi-process enforcement;
existing production SQL control-plane tables and adapters are unchanged. Trusted
providers must return current truthful state; shape/identity checks cannot prove
that a cloud control actually takes effect. Stale release-request fencing, durable
incident adoption, externally audited reconciliation, deployment-wide stops,
managed SIEM/KMS/restore evidence and actual response drills remain outstanding.
No customer data, external notifications, production restore or deployment is
introduced. D-018/pre-TO/customer-data gates and the V131 execution pause remain.
