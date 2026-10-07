# V45 — Worker and recovery safety batch

Lifecycle: current synthetic defect remediation under D-018.

This batch combines related queue, recovery, durability and operator fixes into
one update/PR. It builds on V44; no new legal workflow or live connector is added.

## Reproduced defects

A V44 reproduction held two read-back calls around lease expiry. When the first
worker returned an empty result, it changed the reclaimed job from RUNNING back
to QUEUED while the replacement was still running. A second reproduction opened
a new recovery cycle while an older read was pending: the older empty result
consumed one attempt from the new cycle and requeued the old job.

Successful read-back, audit and job completion also previously used separate
transactions. Injected job-completion failure could leave a completed event and
successful audit despite a failed queue update. The new tests exercise this
failure at the persistence boundary rather than only checking function calls.

## 1. Claim ownership and worker fencing

A claim is identified by job ID, tenant, type and monotonically incremented
attempt number. Only that current RUNNING claim may update command/event state
or finalize/requeue the job. Guards run inside the same SQLite transaction as
state persistence. Queue completion/failure uses conditional SQL with all these
fields; a stale attempt cannot overwrite a replacement's status or error.

A reclaimed worker returns SUPERSEDED without publishing a receipt, error,
read-back result or audit from that stale claim. Its external call is not cancelled;
the durable intent remains, and the replacement performs read-only reconciliation.
A late KnownWriteFailure from a reclaimed claim cannot authorize another write.
This may retain uncertainty longer; it favors avoiding duplicate external effects.

## 2. Old recovery-cycle results and positive evidence

An older cycle whose original job is still legitimately owned is distinct from
a reclaimed claim. Older failures/empty/malformed responses cannot consume the
new cycle's read budget, alter its job pointer or replace its state. That old job
is retired and its worker returns SUPERSEDED.

Valid bound late receipts may be retained on the newer command while preserving
its cycle/job/counters. A receipt alone remains unverified and is audited as
PROCLAIM_LATE_RECEIPT_CAPTURED. A unique, correctly bound late read-back may prove
RECONCILED, with one PROCLAIM_WRITE_RECONCILED audit, while retaining the newer
cycle's counters. Conflicting external IDs never replace current receipt evidence.
Already-reconciled commands never downgrade or duplicate their success audit.

## 3. Shared durable read reservations

The worker reloads the current command and reserves a read inside a transaction
before calling the adapter. Reservations increment current-cycle and lifetime
read counters together; failed reservation persistence prevents the external call.
Legacy overlapping jobs share the same three-read cycle budget. No fourth read
starts after three reservations; explicit later recovery remains a separate,
audited bounded cycle. Uncertain writes remain read-only; no empty or failed
read-back is treated as proof that a write did not occur.

## 4. Atomic successful completion

Read-back proof, event/command completion, success audit and completion of the
owned job now commit together. A failure in any of those writes rolls back the
whole completion. The earlier durable receipt/intent and read reservation remain
available for conservative retry; the external write is not repeated. Internal
adapter/database error text remains excluded from worker responses and job errors.

## 5. Operator behavior

The existing dev-worker HTTP response may now contain a result with status
SUPERSEDED and the original job/event IDs. It conveys no verified success result.
The UI directs the operator to the latest inbound outcome and does not report
success from a retired result, including a malformed retired response containing
verified:true. Refresh and inspect the latest event/audit rather than reapproving.
Positive selected-event read-back evidence is still required for success notices.
Existing approval/recovery API permissions and tenant derivation are unchanged.

## 6. Repository publication safety

Root downloads with version-prefixed filenames such as APPLY_V42_PR_CONFLICT_FIX
now stay out of the Git/archived inventory, alongside existing suffix-versioned
installers. Explicitly tracked source remains included even when its filename
matches an ignore rule. Download files are preserved; none are deleted/untracked.

The installer refuses unrelated staged, unstaged tracked or untracked non-batch
work before mutation/publication. This also applies when source is already
installed: an unrelated local file cannot silently enter a committed catalog.
Ignored runtime/secret files remain untouched. Versioned root downloads are
allowed while their ignore fix is applied. Before staging, source hashes are
verified again so edits made during checks cannot be published as tested code.
The updater requires V44 on main (0.9.2), avoiding another missing-base patch cycle.

## Upgrade, rollback and limits

No database migration, runtime reset, new dependency or data deletion is needed.
Existing jobs/commands retain their records and lifetime counts. V44 request-level
probe reuse remains intact. Expired claims retain the existing five-minute lease;
request inputs cannot shorten it. Already-running external I/O is not cancelled.

Prefer a forward fix. Pause workers and preserve the local SQLite database before
rollback; older workers do not honor this attempt fence or cycle-result policy.
Do not remove uncertain intent, clear receipts or reapprove to force another write.

Tests use synthetic adapters without native write deduplication, multiple SQLite
connections and injected persistence failures. They do not validate production
multi-process queue performance, Postgres/RLS, SSO or real Graph/Proclaim behavior.
Customer data/access and product workflow expansion remain evidence-gated. Human
security review and required GitHub checks must pass before merging this batch.
