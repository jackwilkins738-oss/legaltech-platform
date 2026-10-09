# V88 — Just-in-time support access

V88 adds a workflow-agnostic, read-only support-access boundary for production diagnosis without introducing a standing support super-admin.

## Model

A support capability does not grant client-data access. A stepped-up support operator can request access only to an exact tenant/matter scope (or exact document inside that matter), and the request is bound to hashed ticket/purpose evidence plus a short expiry. A different stepped-up approver must approve the request before it becomes usable.

Effective access is bound to the authenticated requester actor, tenant, exact matter, exact scope and—when applicable—exact document. Grants expire in at most 15 minutes and can be revoked immediately. There is no write/admin scope in the V88 reference boundary.

Ticket text, support rationale and raw document identifiers are not written to support-access audit evidence. Document access uses a hash of the document reference. Every request, approval, revocation and use emits bounded evidence.

## Document delivery integration

V86 document delivery can accept a V88 support authority as an additional server-side authorization source. The support operator still receives only a V86 short-lived, actor-bound, single-use delivery grant. The document is re-resolved and integrity checked on redemption; V88 does not expose storage references or create a parallel download path.

## Production shape

Migration `025_jit_support_access.sql` provides tenant/matter-bound request, approval, revocation and usage evidence with forced RLS. Request/approval/revocation/event rows are append-only; approval is one-per-request and a database trigger refuses self-approval or approval after expiry.

Production requires:

- `SUPPORT_ACCESS_MODE=jit-dual-control`
- `SUPPORT_ACCESS_SCOPE_MODE=resource-bound`
- `SUPPORT_ACCESS_AUDIT_MODE=append-only`
- `SUPPORT_ACCESS_TTL_SECONDS` between 60 and 900

Real-client-data readiness additionally requires `SUPPORT_ACCESS_VALIDATION_STATUS=PASS`.

## Deliberate non-claims

V88 does not define a customer support process, allow support writes, create a tenant-wide support role, select a ticketing system, or claim live support operations. The in-memory registry is reference/test infrastructure; production grant/evidence persistence must use reviewed durable infrastructure.
