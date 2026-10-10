# V161 — Support request admission contracts

Status: current defect-fix implementation; CI required before merge.

The request, approval, revocation and durable-reader entry points previously destructured caller fields before validation. Hash regular expressions could also coerce objects/arrays, invoking caller code or accepting a non-string value. This batch copies only own enumerable data properties before validation and requires primitive hash strings across mutations and both durable grant read layers. Accessors are rejected without evaluation and malformed input cannot contact session or database providers.

Existing UUID, trace, scope, exact document hash, expiry, tenant, dual-control, revocation and audit checks remain in place. The minimal frozen session from V157 remains unchanged. No public support endpoint, privilege, database schema, dependency or workflow is added. Unused extra request metadata continues to be ignored for compatibility; it is never forwarded as authority.

29 adversarial regressions cover field getters on all mutation operations, grant-reader getters, hash coercion across all hash fields, and both grant read boundaries. Existing positive-path and identity-pinning suites run alongside them.

Issue #80 remains a confirmed independent database policy blocker, with V159 / PR #82 held for review. These application checks do not resolve that database concern or prove final handoff revocation fencing. D-018, pre-TO/customer-data restrictions and V131 remain unchanged. Rollback: revert this batch; do not deploy customer data while the blocker remains.
