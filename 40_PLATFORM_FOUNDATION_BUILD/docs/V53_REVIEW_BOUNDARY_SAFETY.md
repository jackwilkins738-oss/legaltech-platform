# V53 — Review boundary safety

Status: current synthetic defect remediation under D-018.

## Reproduced failures and fixes

- Rejection could consume a second open exception for an event while ignoring the
  processed exception link. Both decision paths now validate exact owned identities
  and the current processing link. Historical events without a link require one
  unambiguous open exception; no automatic link repair occurs.
- Editable READY_FOR_APPROVAL/REVIEW_REQUIRED or OPEN statuses could overwrite
  durable approval/rejection evidence. First decisions reject non-null prior actor,
  target, exception, writeback or rejection-note evidence, and resolved exception
  evidence. Legitimate same-key replay is handled before the first-decision guard.
- Unconditional review persistence could acknowledge a write against a missing or
  changed row. Event/exception review writes now compare original owned relational
  bindings, status and complete JSON snapshots. JSON whitespace is normalized by
  SQLite. A lost write produces 409 INVALID_REVIEW_STATE; the existing savepoint
  rolls back notes, exceptions, event changes, queue, commands, cache and audit.
- New rejections bind rejectedExceptionId to the exact reviewed exception. Replay
  validates that binding and any processing link, and refuses approval/writeback
  evidence. Historical rows lacking both links require one resolved owned rejection;
  ambiguous history returns 409 IDEMPOTENCY_UNVERIFIABLE. No historical backfill.
- Free-text rejection notes were copied into the audit ledger. New audit writes use
  human_rejection while event/exception records retain the original notes. Audit
  views also project historical rejection reasons to the fixed code without changing
  the append-only ledger. Historical raw database notes remain subject to retention
  and administrative access controls; this is not a purge/migration.
- Bulk rejection could leave already rejected selections and stale views after the
  next item failed. Each confirmed response removes that selection, preserves the
  remaining selection and reports its confirmed count. The view refreshes on success
  or failure. Successful refresh also removes closed/stale selections; failed refresh
  retains unconfirmed selections. A timeout cannot prove whether that particular decision committed;
  existing idempotency/replay and refreshed state remain the recovery path.
- A recorded approval followed by worker API failure left the view stale. Review
  now always refreshes and explicitly says the approval is recorded but writeback
  unverified. No worker retry, new approval or external resend is automated.

## Existing behavior preserved

Human rejection remains available for quarantined files and blocked synthetic
classifications; rejection does not require parser/classifier success. Existing
notes validation, actor attribution, request fingerprints, review capabilities,
resource concealment, approval/writeback proof and unknown-outcome controls remain.
No legal decision rule, auto-action threshold, database schema or external contract
changes. Null/absent historical evidence fields remain compatible; contradictory
records fail closed and need reviewed investigation, not automatic repair.

Only review writes use the new conditional store methods. Generic worker/store
methods retain their existing behavior. These checks provide consistency within the
trusted SQLite store, not cryptographic protection against a database administrator.
The approval persistence fault test now targets updateReviewEvent while retaining
its rollback and retry assertions.

## Validation and release

84 synthetic cases cover record identities, current/legacy exception bindings,
prior decision evidence, restart replay, conditional lost writes, atomic rollback,
notes minimization, actual HTTP audit-only permissions and wrong-exception handling,
and partial UI failures. All previous suites remain required.

Installer requires merged V52 main (0.10.7). It protects unrelated local work,
optionally commits/pushes only the feature and cannot merge/reset/force-push.
Node verification prints compact summaries. A failed suite saves its full TAP report
in an owned temporary directory and prints the failing assertion context and report
path. A failed verification still stops publication; checks are not skipped.
Review security changes and GitHub checks before merging, as required by
21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md. Revert the PR through
normal review if necessary; no schema rollback is needed.
