# V143 — Durable support authority implementation contract

Status: DESIGN / NOT IMPLEMENTED. This document does not authorize client-data or production use.

## Observed V142 limitation
`JitSupportAccessRegistry` uses process-local maps for requests, approvals and revocations, synchronous local audit callbacks, and current process clock. Restarting or using multiple API instances loses the grant and revocation truth. The existing synchronous `assertGrantCurrent` is not a distributed authorization guarantee.

## Security invariants
1. Every support operation is tenant- and request-ID bound, with an exact scope, matter, and optional document reference; replacements never inherit rights.
2. Request, approval, revocation, and read proof must use a trusted transactional PostgreSQL authority. No stale instance-local cache grants permission.
3. Access expires even if cleanup never runs; revocation denies reads as soon as its transaction commits. Audit failure cannot silently restore access.
4. Approval requires a separate authorized actor and fresh session/MFA authority at the operation time. Upstream live session validation must be injectable, fail closed, and cannot trust static claims alone.
5. Writes use idempotency keys and version fencing; concurrent approval/revocation cannot reanimate a grant. Audit metadata contains no document bytes, personal case data, ticket text, or purpose text.
6. Final diagnostic and document handoff must re-read current authority *after* awaiting provider/storage calls, before bytes or snapshots leave the service.
7. PostgreSQL/network unavailability is DENY, not fallback to process-local authority.
8. All cross-tenant reads and mutations are rejected by database policies and independent tests.

## Execution slices (separate reviewable changes)
**A. Database boundary:** Introduce append-only support access events and transactional tenant-scoped request/grant/revocation rows; forced RLS, restricted security reader/operator roles, indexes and migrations with corresponding manifest and safety tests. Define expiry and revocation fencing invariants as constraints and conditional writes.

**B. Durable authority:** Implement an async `PostgresJitSupportAccess` reader and operator using existing `postgresSecurityBoundary.js` primitives. Use a database-owned clock for expiry. Revalidate live server-session authority for request, approve, revoke, and read. Make revocation a durable deny before externally retryable audit delivery; unresolved external audit must remain explicitly visible and fail closed.

**C. Consumers:** Migrate `SupportDiagnosticService` and document delivery reference consumers to async exact-grant checks. Check after each awaited step and directly before handoff; reject stale or replacement grant identity and treat uncertain audit outcomes as denial. Do not silently adapt `JitSupportAccessRegistry` to pretend durability.

**D. Verification:** PostgreSQL 17 integration coverage with two independent registry/worker processes, restart recovery, concurrent approve/revoke, expired grants, stalled provider, session revocation, unavailable DB, RLS cross-tenant probes, immutable bounded evidence, and full security regression suites. Test real process separation, not merely two instances sharing one map.

## Release gates
- Exact migrations/manifest and CI PostgreSQL 17 suite green; all existing security/knowledge checks green.
- No customer data and no TO-derived workflow behavior before existing gates are met.
- Production adoption requires configured secrets, network isolation, trusted clock and live session provider, audit reconciliation, operational drills and rollback evidence.
- Preserve D-018, pre-TO/customer-data gates, and V131 writeback execution pause.

Do not merge this design-only PR as if V143 implementation were complete.
