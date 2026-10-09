# V94 — Tenant configuration versioning and rollout safety

V94 introduces immutable, hash-bound configuration bundles composed only of references to already server-validated workflow/policy/flag components. Drafts are tenant-validated, versioned and cannot be activated without an exact V83 production-change approval.

Activation is atomic at the bundle pointer: a newer version is an activation and selecting an older already-published bundle is an explicit rollback event. Published bundle identity/components are immutable and activation history is append-only in the production shape.

This deliberately does not define any Co-op workflow, role hierarchy, response target or product UI. It is the rollout mechanism that future TO-derived configuration can use safely.
