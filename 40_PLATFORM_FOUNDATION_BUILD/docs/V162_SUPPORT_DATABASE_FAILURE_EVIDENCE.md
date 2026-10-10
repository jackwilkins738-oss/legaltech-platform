# V162 — Support authority database failure evidence

Status: synthetic integration tests; PostgreSQL CI execution required.

This batch verifies three independent durable boundaries:

- Database-owned timestamps reject already expired and future-created/approved grants without application cleanup or host-clock assumptions.
- A document grant authorizes only its original tenant, requester, request, matter, scope and exact resource hash. Revocation denies it; lifecycle evidence preserves the resource hash.
- A disposable test-only trigger rejects audit insertion for a unique synthetic trace. Request, approval and revocation each fail and leave no mutation row or misleading successful event. The trigger/function is removed in a finally block. No production migration or privilege changes.

A failed revocation transaction is not a completed revoke; this test does not claim a durable deny marker survives a failed database transaction. External audit reconciliation and final document/diagnostic handoff remain separate requirements. Issue #80 remains open, and V159 / PR #82 stays unmerged for review. No customer data or live identity-provider credentials are used. D-018, pre-TO/customer-data restrictions and V131 are preserved.

Rollback: revert the test batch. No runtime behavior changes.
