# V43 — Review request safety

Lifecycle: current engineering defect remediation; synthetic data only.

## Reproduced defect

V42 accepted a rejection with notes “Original” and returned replayed success for
the same key with notes “Changed”, retaining only “Original”. It also silently
coerced falsy malformed HTTP fields to null and discarded approval notes.
This change fixes the existing human decision boundary under D-018.

## Contract

The exception resolution route accepts only tenantId, resolution, matterId and
notes. Tenant and actor still come from authenticated context. Unknown fields and
malformed types fail before mutation. Resolution is APPROVE or REJECT; optional
matterId is null or a nonblank identifier of at most 200 characters. Notes are null
or a string of at most 4096 characters, with no NUL. Empty notes normalize to null;
other text is preserved exactly. Domain review keys and actors must be nonblank
strings of at most 200 characters without control characters. The HTTP key retains
its existing minimum length of eight.

New replay scopes use JSON tuples. The saved SHA-256 request fingerprint covers
resolution, requested matterId, normalized notes and original actor. Changing
any of these fields for a recorded key returns 409 IDEMPOTENCY_CONFLICT. A retry
from another actor conflicts rather than implying that actor made the decision.
Exact matching retries return the original job without another decision/audit.
The fingerprint is internal and is not included in the API result.

Before replay, the service verifies the owned exception, owned event, recorded
resolution/actor, and for approvals the owned matter plus original job's tenant,
event, matter and approval-key bindings. Missing/corrupt bindings return safe 404.
Results are reconstructed from these resources rather than arbitrary cache fields.
Approval notes now persist on the exception inside the approval transaction;
audit failure rolls back notes, decision, cache, intent and queue together.
No external write is requested by replay.

## Historical requests and rollout

Existing delimiter scopes remain readable only after ownership checks. A legacy
rejection can be upgraded when the stored notes and actor prove the request;
legacy rejection target metadata was not recorded, so only a null requested
matter is accepted. Legacy approvals cannot prove nonempty notes because V42 did
not retain them; those retries return 409 IDEMPOTENCY_UNVERIFIABLE. A notes-free
legacy approval requires the recorded actor and original effective matter.
No historical decision is changed or deleted and no database migration is needed.

If a replay conflicts, inspect the recorded decision and audit. Do not clear the
cache or reapprove with another key to bypass it. Fresh keys still cannot reverse
a resolved decision. Pause workers before rollback, preserve the SQLite database,
and prefer a forward fix: V42 does not enforce the new replay fingerprint.

## Boundary

This remains local synthetic SQLite/API validation. Production identity, matter
permissions, real Proclaim/Graph and customer data remain evidence-gated. Human
security review and GitHub checks are required before merge. D-018 is unchanged.
