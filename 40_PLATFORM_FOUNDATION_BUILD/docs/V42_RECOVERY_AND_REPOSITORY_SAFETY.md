# V42 inbound recovery and repository safety

Lifecycle: bounded synthetic reliability/security work under D-018. No live customer
integration, legal workflow expansion or autonomous approval is introduced.

## Reproduced issues

After three failed inbound processing attempts, a job was dead but its event still
appeared queued forever. No controlled operator recovery was available. The catalog
scanned the filesystem without respecting Git ignores, including local `.env` files
and downloaded installers that would be absent from a clean repository checkout.

## Inbound recovery

Read APIs derive `PROCESSING_FAILED` or `PROCESSING_STALLED` from owned job state.
The raw event remains queued until classification commits; derived states do not
make it approvable. Safe processing metadata exposes cycle/lifetime attempts and
recovery count without raw provider errors. Failed/stalled items appear in work,
filters, attention and event rows with a Retry processing control. Unprocessed work
no longer inflates the analysed pipeline count.

Development-only route, enabled only when `devWorkers` is true:

`POST /api/v1/inbound-events/:id/retry-processing`

Requires `dev:workers`, `inbound:read` and an Idempotency-Key. Tenant and actor come
from the authenticated session. Body is empty or supplies a matching tenantId;
caller-supplied force/lease/budget options are rejected. The route accepts only
unapproved queued events with exhausted jobs or running jobs older than the fixed
five-minute lease. Existing queued or fresh running work blocks recovery.

Recovery retires expired jobs, enqueues a fresh bounded processing cycle, updates
recovery metadata and records actor/trace audit atomically. Old jobs and attempts
remain available; lifetime counters do not reset. Repeated request keys return the
same result without another job/audit. Foreign events and invalid cache/job linkage
remain unavailable. Approved/rejected/completed events cannot be reopened.

A retired classifier may still finish its external AI call. Its job cannot commit
stale classification or requeue itself, even if replacement processing has completed.
No cancellation of external AI transport or automatic reprocessing is claimed.
Recovery cannot request a Proclaim writeback; the human decision gate remains.

## Repository inventory

Catalog generation and knowledge lint share a Git inventory of tracked files and
untracked source files, respecting `.gitignore`. Root versioned installer downloads
are now ignored. Existing tracked files remain included even if matching an ignore
rule; existing runtime-directory exclusions remain. Local files are neither moved
nor deleted. Ghost entries for excluded local artifacts disappear on regeneration.

Exported archives without their own Git repository use a fallback that excludes
known local runtime/secret/download artifacts. It does not implement every arbitrary
Git ignore rule and does not make archives canonical. GitHub remains canonical.

## Apply/publish/rollback

No schema migration or data reset. The cumulative V40-to-V42 updater includes V41
request/replay safety when it is absent. Apply from clean updated `main`; it creates
`feat/recovery-and-repo-safety-v42` and verifies platform, legacy, catalog, security
and knowledge checks. Default mode leaves changes uncommitted. Optional
`-CommitAndPush` stages only the update manifest/catalog, rejects unrelated staged
files, commits if needed and always pushes the feature branch, including repeat runs
where the commit already exists. It does not create, approve or merge a PR.

Human security review and required GitHub checks remain necessary before merge.
Publishing errors preserve local changes/history for inspection. No force-push,
reset, branch deletion or remote merge is performed.

Pause inbound workers before rollback if recovery has retired jobs. An older worker
does not enforce the retirement guard; prefer a forward fix and retain the database.
Read-time job aggregation is a local SQLite prototype, not a production-scale queue
or distributed lease system. Production identity/storage and real Graph/Proclaim
behavior remain unproven.
