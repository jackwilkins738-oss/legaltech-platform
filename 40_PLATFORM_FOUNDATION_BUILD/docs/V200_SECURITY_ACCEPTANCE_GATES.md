# V200 security consolidation — acceptance gates

Status: in progress; **not production-ready**. All probes use synthetic data. D-018, V131 and pre-TO/client-data restrictions remain in force.

## Evidence reconciliation
- Issue #80 / draft PR #82 demonstrated that four support INSERT tables accepted same-tenant, different-actor rows while earlier permissive policies were in effect.
- Current migration manifest includes **062_support_actor_restrictive_rls.sql** with RESTRICTIVE INSERT policies on requests (requester_id), approvals (approver_id), revocations (revoked_by), and events (actor_id), bound to app_current_actor_id() and tenant.
- Manifest also includes **063_support_revocation_serialization.sql**, a revocation advisory-lock trigger. These are *candidate remedies*, not proof of effective policy under every runtime role.
- The historical V159 failure must not be described as a current failure without rerunning the direct-SQL regression against the latest schema.

## Hard security acceptance criteria (blocking)
1. Execute **negative** same-tenant actor spoof INSERT probes for all four support tables using restricted operator credentials after applying the whole manifest; each must fail at the database boundary, not just the application.
2. Execute **positive** legitimate-actor INSERT probes under the same credentials; reject a false green caused by denying all writes. Roll back probes and isolate fixtures.
3. Cross-tenant INSERT, UPDATE, DELETE and SELECT tests for support credentials; verify grants and policy composition, including PUBLIC permissive policies and runtime roles.
4. Verify migration 062 restrictive policy presence and force-RLS status using PostgreSQL catalogs on *actual* migrated PostgreSQL 17, not SQL-file string inspection.
5. Verify approver/requester separation and revocation authorization; failure must not erase audit/denial evidence.
6. Cross-connection and independent-process tests: revoke access while a document transfer holds its fence, require serialization and later denial on a different server.
7. Test transaction rollback and uncertain commit, cancellation, timeout, connection loss, and retry/idempotency; none may produce a fabricated success receipt.
8. Negative tests for identity mutability, wrong actor, wrong tenant, wrong matter, expired session, forged binding, altered document hash, and mismatched transfer scope.
9. Audit append-only evidence and externally observable state must agree after success, failure, rollback and interrupted handoff.
10. Check manifests, migration hashes, privileges, security regression, dependency audit, complete CI, PostgreSQL integration, and review approvals before merge.

## Deployment gates
No real client or matter data; no production routes or live support-consumer adoption; no reactivation of V131 writeback; no relaxation of D-018/pre-TO controls. A green CI result does not grant these approvals.

## Development handoff to V201+
Only reusable interfaces backed by proven tenant and actor enforcement may be used. Matter, communication, task and approval UI should run against synthetic providers until governed partner evidence authorizes specific workflow semantics. Release readiness requires separate deploy, recovery and operating evidence.

## Open questions
- Are the catalog-level effective policies restrictive for every intended service credential?
- Do separate-role positive-path tests demonstrate necessary functionality without privilege escalation?
- Are V159 / issue #80 now obsolete and ready for a *documented* resolution, or does a different policy path remain vulnerable?
- Does cross-server revocation serialize with the actual document-transfer fence in a real PostgreSQL multi-session test?

## Existing checked coverage, verified in repository
The integrated PostgreSQL suite already includes V163 four-table spoof denials, V164 positive legitimate operator inserts plus concurrent impersonation denial, V165 cross-tenant denial, V166 independent-reader revocation, V176 direct-SQL revocation lock serialization and V180 fenced document consumption. V200 adds **catalog-level policy assertions**, not duplicate cases. Current CI passing is integration evidence for the exercised synthetic paths, but does not establish operating deployment evidence or authorize live consumer adoption.
