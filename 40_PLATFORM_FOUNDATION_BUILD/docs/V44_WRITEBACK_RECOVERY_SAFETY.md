# V44 — Writeback recovery scheduling safety

Lifecycle: current synthetic engineering defect remediation under D-018.

## Reproduced defect

In V43, while an original write remained RUNNING, an operator could create a
read-only recovery job. After that probe was claimed, a fresh verification key
created a third job and reset reconciliationAttempts from two to zero. Repeating
this pattern could stack verification work and bypass the per-cycle read budget.
This was reproduced against the committed V43 baseline using synthetic state.

## Changed behavior

Verification scans only the authenticated tenant/event's PROCLAIM_WRITEBACK jobs
and validates tenant, type, event, target matter and command-key binding. A queued
or running read-only probe is reused even if the command's job pointer references
older work. Reuse preserves the existing recoveryCount, reconciliationAttempts
and lifetime counters. The original running external write still permits one
separate read-only probe, retaining V39's uncertain-outcome recovery behavior.

A fresh key appends an attributable verification-request audit but does not queue
another job while that probe is active. Repeating the same key returns the
original scheduling result without another audit. A result of QUEUED means a
verification job was scheduled or reused; it is not proof that external read-back
succeeded or that the job is still queued now. The UI still requires positive
selected-event read-back evidence before reporting success.

Once the prior verification cycle is exhausted, another explicit operator
request may create a new bounded read-only cycle. Lifetime counts are retained.
Completed commands return COMPLETED with no additional job. No recovery path
calls createHistory or authorizes another external write.

Keys and actors must be nonblank strings of at most 200 characters without control
characters. Cached requests now verify the owned command and original job binding
before replay; malformed/missing/foreign job records return safe 404. Replay
responses are reconstructed from validated fields rather than echoing arbitrary
cached values. Existing valid V39–V43 request records remain readable.

## Operations, compatibility and rollback

No schema migration, data deletion, lease change or runtime reset is required.
Already-existing duplicate jobs are preserved rather than cancelled; the fix
prevents new jobs while a valid read-only probe is active. An expired RUNNING probe
is reused by the request path; normal worker lease recovery reclaims it through
the existing five-minute mechanism. Request inputs cannot shorten that lease.

Inspect the event/audit if verification remains unconfirmed. Preserve durable
write intent and never reapprove or clear receipts to force another write. Pause
workers before rolling back to code that lacks this scheduling guard; prefer a
forward fix. Human security review and GitHub checks are required before merge.
Real Proclaim behavior, production queue leases, customer access and production
identity remain unverified and evidence-gated. D-018 is unchanged.
