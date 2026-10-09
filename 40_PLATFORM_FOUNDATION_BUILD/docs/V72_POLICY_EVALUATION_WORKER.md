# V72 — Durable response-policy evaluation worker

V72 adds a bounded background evaluation boundary for the generic V68 response-target policies. It makes policy evaluation schedulable and recoverable without inventing a firm-specific SLA, polling cadence, escalation route or external notification behavior before TO evidence exists.

## Boundary

- Evaluation jobs pin the exact published policy version and definition hash when scheduled.
- Scheduling is tenant-bound and idempotent; reuse of an idempotency key with different policy inputs is rejected.
- `schedulePublished` can enqueue the latest published version of each configured policy for an explicit run key, but installs no automatic cadence.
- Each worker claim scans at most 200 work items and emits a continuation job for the next bounded page.
- Policy materialisation remains deduplicated by policy/version/source-work identity, so replaying a page cannot create duplicate escalation intents.
- A single malformed or failing eligible work item is isolated from the rest of the page and produces only bounded failure evidence.
- Expired RUNNING evaluation jobs can be safely recovered after a bounded worker lease.
- A policy retired or changed after scheduling cannot be silently substituted for the pinned policy.
- Tenant-scoped workers claim only their tenant's evaluation jobs.
- Notification actions create V65 notification intents only. V72 does not send Teams messages, email or any other external communication.
- Escalation actions create separate generic escalation work; source work ownership is not automatically changed.

Security regression concepts: **policy evaluation version pinning**, **policy evaluation bounded scan**, **policy evaluation lease recovery**, **policy evaluation failure isolation**.

## Deliberately not included

No Co-op-specific response target, SLA, poll frequency, manager hierarchy, case-manager routing or notification channel is configured. A scheduler may explicitly invoke this worker later, but the cadence and policies must come from operating evidence and approved configuration.
