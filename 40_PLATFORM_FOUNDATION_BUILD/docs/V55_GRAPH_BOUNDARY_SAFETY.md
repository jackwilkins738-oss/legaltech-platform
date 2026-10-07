# V55 — Synthetic Graph boundary safety

Status: bounded defect remediation under D-018. Requires merged V54 (0.10.9);
produces V55 / 0.10.10. This is an in-memory synthetic reliability harness, not
an implementation or validation of live Microsoft Graph semantics.

## Reproduced defects and resulting behavior

Public harness fields previously allowed changing the tenant used by HTTP ownership
checks, changing the retry budget and editing subscription/delivery records or opaque
checkpoint maps directly. A caller could therefore change the harness's original
ownership or bypass its lifecycle history without using its explicit operations.

The tenant and retry budget are now non-writable, non-configurable own properties.
Registry methods and the clock dependency are captured at construction. Internal
subscription, delivery, delta and deduplication maps use private fields. Public
shadow maps or dependency properties do not affect internal authority. Legitimate
registry updates still revoke mailbox access because captured methods read the same
current registry. Returned records and snapshots remain independent copies.

Clock exceptions previously occurred after lifecycle flags, delta maps, duplicate
counts or retry/attempt counters had already changed. Each operation now validates
one clock observation before those writes. Non-integer, negative, nonfinite, coerced
or out-of-range milliseconds fail with a fixed internal clock error; enough range
must remain for the existing 55-minute synthetic lease. Clock exceptions are never
retained or returned. Subscription expiry and health share the snapshot's one time,
so they cannot disagree merely because the clock crossed expiry during projection.

The direct harness error is INTEGRATION_CLOCK_UNAVAILABLE / 503. HTTP retains the
existing server-error minimization policy: 503 with INTERNAL_ERROR and a fixed safe
message. Mutation audit records ATTEMPT then FAILED using that public code. No
SUCCESS is recorded for a clock-denied operation. Foreign-tenant authorization
occurs before clock evaluation or connector state retrieval.

Constructor, configuration and notification option records must be ordinary or
null-prototype objects with own data fields. Accessor and inherited records are
rejected without executing their getters. Configuration validates a dense typed
mailbox array and copies it before persistence. Existing defaults and explicit false
reader/client-state values retain their previous meaning.

## Compatibility and investigation

Existing HTTP routes, subscription/delivery payloads, deduplication fingerprints,
three-attempt default, terminal recovery lifetime counts, fixed synthetic lease,
lifecycle restrictions, mailbox revocation and checkpoint-presence projections
remain. There is no migration, reset or automatic history repair.

Public internal maps and mutable authority/dependency properties are intentionally
removed as mutation/inspection interfaces. Use snapshot/health and explicit harness
operations. Opaque delta tokens have no public readback interface; visible checkpoint
presence and scope remain. Existing tests that inspected the old delta map now check
these public boundaries without retrieving its private token.

If the clock fails, investigate its injected dependency and retry the original
operation only after restoring a valid clock. The failed clock observation itself
makes no connector-state mutation; later ordinary retry/deduplication behavior remains.
This is not a promise of rollback for every external dependency or post-mutation
audit failure. No new database transaction around the in-memory connector is added.

## Limits and review

Registry/clock dependencies are trusted injected infrastructure. Capturing references
and rejecting ordinary accessors is not a sandbox against arbitrary same-process
JavaScript, proxy traps, prototype tampering, or a malicious registry/clock callback.
This batch does not establish production clock synchronization, durable Graph queues,
real webhook verification, provider admission or production readiness.

Complete GitHub checks and human security review before merge as required by
`21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md`. Review HTTP tenant
binding, private history, clock failure ordering, safe error/audit projection and
compatibility with synthetic lifecycle/deduplication operations. Native Windows and
remote CI remain user-environment checks. See `../TEST_RESULTS_V55.md`.
