# V54 — Inbound recovery boundary

This batch remedies reproduced defects in the existing synthetic inbound recovery
path under D-018. It requires merged V53 (0.10.8) and produces 0.10.9 / V54.
It adds no legal workflow, automatic decision threshold, live provider or schema migration.

## Evidence before recovery

Job evidence must be owned by the event tenant, trace, type and event ID. Identifiers,
statuses, safe nonnegative counters and canonical UTC timestamps are validated
without coercion. The original job must remain present. Recovery cycles must be
complete and agree with the event count and current job pointer. Aggregate attempts
must remain safely representable. New actor/fingerprint fields must form a complete
bound pair; fingerprints retain the previous format.

Missing, contradictory or unreadable evidence on a queued event is projected as
PROCESSING_UNAVAILABLE with processing state UNAVAILABLE, a fixed error code and
null counts. This is a read-only projection: it does not reset decisions, backfill
jobs, normalize counters or repair persisted records. Other recorded human statuses
remain visible. The UI includes unavailable work in critical queues, shows counts
as Unavailable and offers no automatic Retry action for this state.

Approval/rejection/classification/match and completed-source evidence prevent a
QUEUED status reset from authorizing recovery. Presence checks include falsy values.
Private store errors and foreign job descriptors are not exposed in projections.

## Conditional retirement and scheduling

Recovery uses the fixed server lease. Fresh claims cannot be retired. An expired
RUNNING job is cancelled only against its original full claim snapshot, including
attempts, trace, payload and timestamps. Recovery verifies both the returned and
persisted new job. The event update compares the complete original event snapshot.
Any loss of those conditions rolls back retirement, new queue work, event changes,
audit and idempotency state together. Changed or missing evidence returns a fixed
conflict rather than acknowledging work that was not durably scheduled.

## Worker fencing

Inbound claiming skips invalid SQLite counters and noncanonical queued timestamps,
preserving invalid records while allowing healthy jobs behind them to run. SQLite
INTEGER reads use BigInt before safe conversion; text, fractional and out-of-range
values cannot become trusted counters. Existing node:sqlite runtime requirements
remain; setReadBigInts is available in Node 22.5.0 and later.

Workers validate ownership, original history, active recovery cycle and undecided
source before classification and again before commit. Invalid owned evidence and
exhausted attempt budgets become terminal without classifier calls or automatic
retry. Actual retired or malformed current claims are superseded without replacing
changed history. Valid transient classifier failures retain the existing three-attempt
policy. Completed replay remains read-only and does not rerun classification.

## Historical compatibility and limits

Historical recovery jobs lacking both actor and fingerprint remain readable when
owned cycle/history evidence is complete. A missing historical current-job pointer
is accepted only when the current recovery cycle is unambiguous; no field is backfilled.
Completed accepted-intent idempotency replay returns the original acceptance without
creating another job. Restart and ordinary valid recovery retain lifetime counts.
Malformed evidence requires human investigation; there is no automatic repair tool.

These checks protect consistency in the trusted synthetic store. They are not a
cryptographic defense against a database administrator rewriting all evidence, nor
a sandbox for hostile JavaScript proxies. Provider admission, production identity,
legal rules and live readiness remain separately gated.

## Required review

Before merge, complete GitHub checks and human security review required by
`21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md`. Review job ownership,
lease retirement CAS, full-row event CAS, transaction rollback, historical replay,
claim budgets and unavailable UI behavior. Native Windows/PowerShell and remote CI
must be checked in the user's environment; Linux checkout-ending fixtures do not
claim native Windows execution. See `../TEST_RESULTS_V54.md` for local evidence.
