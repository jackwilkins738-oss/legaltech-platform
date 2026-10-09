# V118 validation evidence

STATUS: CURRENT
DOMAIN: platform_build

Validated on Linux against the reconstructed supplied V117 baseline. GitHub main and Windows were not directly tested.

- Full platform suite: **1,791/1,791 passed**, including 15 new shared-session regressions.
- Full production-shape scaffold: **138 passed, 1 skipped, 0 failed**, including 12 new transaction-boundary regressions. The skipped test requires a real PostgreSQL service.
- The 27 new unit regressions were repeated after final transaction/session changes: **27/27 passed**.
- Technical starter / reference implementation / dev-control: **7/7, 17/17, 5/5 passed**.
- Security policy suite: **38/38 passed**. Security regression scan: no secret/action/default/log hits or missing required test concepts.
- Migration manifest: 47 checksum-pinned entries verified by scaffold tests.
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration. Whitespace checks passed. The packaged patch passes `git apply --check` on a clean reconstructed V117 worktree.

The new `postgres-security-integration` CI job executes all 47 migrations against an empty synthetic PostgreSQL database, then exercises actual privileges, tenant isolation, cross-instance session revocation, permission refresh, pool cleanup and database-time expiry. **This job was not executed locally:** PostgreSQL, its driver and a live service are unavailable here. Unit mocks and SQL text checks do not establish PostgreSQL correctness. Require this job to pass before merging.

Migration 047 has not been applied to a deployed database. Deployment must provision separate restricted domain and identity-broker login roles and wire a current directory resolver. Shared interlock, rate-limit, audit and other production adapters remain separate deployment work. V118 does not establish production readiness. See `docs/V118_SHARED_IDENTITY.md`.
