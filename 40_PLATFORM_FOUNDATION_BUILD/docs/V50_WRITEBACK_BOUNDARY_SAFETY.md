# V50 combined writeback boundary safety batch

Defect fixes in the existing synthetic writeback/reconciliation path, based on V49.
D-018, pre-TO scope, live integration evidence gates and human security review remain.

## Operator receipts and owned proof

Reconciliation uses the existing tenant/key tuple scope. New receipts retain the
original operator, a fingerprint of immutable command/approval fields and the
operator/request key, and a fingerprint of the original event/job/status/read-only receipt.
Replay reconstructs the public fields, never echoes additional cached values, and
checks the current owned event, matter, original reviewer, classification, trace,
external matter and command. A different operator receives 409 IDEMPOTENCY_CONFLICT.
The queued job must still bind the command/trace and be explicitly read-only.
Original QUEUED receipts remain QUEUED on replay even if that job has finished;
current verification state belongs to the event view, not the request receipt.

Historical reconciliation receipts without operator/fingerprint proof return
409 IDEMPOTENCY_UNVERIFIABLE. Keep existing jobs and use a fresh operator key:
the existing active probe is reused without resetting its read budget or sending
another write. Malformed/foreign cache/job evidence remains unavailable. Fingerprints
are consistency evidence in this trusted local database, not cryptographic database
authentication or protection against an attacker who can rewrite all database rows.

## Missing command evidence and dispatch

Losing a durable command record cannot erase a recorded event write attempt. A
non-pending event receipt, prior attempt, reconciliation-only job or advanced event
state reconstructs read-only uncertainty, never a fresh write. An owned legacy
external identifier is an unverified receipt: even a historical COMPLETED/verified
flag needs a fresh matching synthetic history read before RECONCILED can be recorded.
Finite event counters are retained where available. Missing/unprovable counters do
not prove that no prior external send occurred. Exhausted retained read cycles
still require the existing explicit operator recovery flow.

A pending command can send only on an APPROVED event with zero previous attempts,
no uncertainty and no external receipt. A trusted known-not-applied retry still
requires its explicit boolean retry flag, no uncertainty, no receipt and the
bounded write budget. Inconsistent evidence fails closed; no reset or automatic
repair of existing records is attempted.

## Counter, claim and completion checks

All durable write/read/recovery counters must be nonnegative safe integers; lifetime
read count cannot be below the cycle count. Flags must be booleans, states and error
codes recognized, identifiers typed/bounded/control-free, and RECONCILED requires a
valid receipt without uncertainty. Worker read/write budgets are integers from 1
to 100 (defaults remain 3). Lifetime read and recovery increments refuse overflow.

Before every reservation and result commit, the worker rechecks current approval,
command and owned matter bindings. Claimed jobs also retain the original event,
matter, approval key and trace. Changes while an adapter call is pending cannot be
overwritten by its late receipt/read-back. A conflicting stored external receipt
cannot be replaced with another same-cycle result. Existing V45 expired-claim and
older-cycle fences remain, including conservative capture of valid late evidence.
Completion/audit/job transactions and recovery audit rollback remain atomic.

## Adapter boundary

Receipts and history evidence must be plain records rather than arrays; IDs reject
ASCII control characters. Matching history also requires a record payload and exact
tenant, external matter, key, event and classification. Foreign/nonmatching rows do
not confirm a write. Invalid evidence retains the existing bounded read retry flow.
Trusted KnownWriteFailure codes are normalized again at the worker boundary and
retryable must equal true; later mutation cannot leak arbitrary provider text or
turn a nonboolean flag into retry permission. This trusted synthetic error type
still requires evidence that no write occurred; a live adapter must prove its own
protocol and failure semantics before being authorized.

## Delivery and limitations

App 0.10.5 / badge V50; branch feat/writeback-boundary-safety-v50. Apply only to
clean updated V49 main (0.10.4), after that batch's review/merge. The installer
checks the full applicable patch before branch creation, then tests/catalog/security
and source hashes before scoped optional commit/push. Repeat runs verify installed
source; unrelated local work is preserved and blocks publication. No force push,
reset or automatic merge occurs.

80 new synthetic boundary cases join 409 earlier platform cases. Earlier Node
regressions and Python security/catalog checks remain required. Tests use synthetic
adapters, loopback HTTP and temporary local SQLite/Git fixtures. Native PowerShell,
GitHub CI, human review and all live provider evidence remain pending; Linux fixtures
with Windows checkout endings are not native Windows execution proof.
