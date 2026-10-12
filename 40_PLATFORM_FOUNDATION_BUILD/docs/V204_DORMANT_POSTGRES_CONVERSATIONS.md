# V204 — Dormant PostgreSQL conversation schema (default-deny)

This migration lays out the first **durable storage foundation**, not a live messaging feature. It creates four PostgreSQL tables: threads, participants, messages, and append-oriented audit evidence. Tables carry explicit tenant identifiers, tenant/thread foreign keys, bounded text fields, revision uniqueness, actor-scoped retry uniqueness, and indexes for matter and thread queries.

All four tables have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. **Explicit always-false RLS policies and no application role grants** are introduced. The policies satisfy the runtime catalog requirement that every tenant table has an RLS policy, while still denying all row access. The migration revokes PUBLIC access to these tables and the generated audit sequence. This intentionally blocks application access until a later implementation proves correct authorization and transaction fencing.

## Security gates before any operational use

1. Establish tenant-consistent matter/actor foreign key constraints and trusted directory membership validation. Current foreign keys validate record existence but **do not validate that a referenced matter or actor belongs to the same tenant**. This omission is safe only while default-deny remains in place; it must be fixed before granting any DML privileges.
2. Add a dedicated least-privilege database role and restrictive RLS policies for active actor, tenant, matter membership/security zone, and live conversation participant.
3. Use a trusted, pinned-identity transaction to authorize creation, posting, recipient changes, and auditing. Ensure revocation and message delivery serialize across all servers under a common transaction-held lock or row lock. A service-side precheck alone is insufficient.
4. In the **same** database transaction, modify the conversation revision, persist the message/participants and append metadata-only audit evidence; roll back all writes if any step fails.
5. Implement durable retry receipts that reject reuse with different payloads and do not duplicate audit entries. The database unique constraint is necessary but insufficient by itself to prove payload equivalence.
6. Provide paging, operational limits, retention/legal hold policy, encryption and attachment classification, record recovery and read/delivery semantics.
7. Validate the permissions and revocation race under real PostgreSQL CI with two independent authenticated servers. Preserve production admission denial until all gates pass and governance explicitly permits activation.

This migration does **not** add PostgreSQL application adapters or routes, does not introduce client data, and leaves D-018, V131 and partner TO research restrictions unchanged. The synthetic messaging demonstration merged in V202/V203 remains limited to local development.
