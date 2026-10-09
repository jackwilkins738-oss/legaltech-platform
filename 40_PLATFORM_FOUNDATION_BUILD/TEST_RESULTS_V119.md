# V119 validation evidence

STATUS: CURRENT
DOMAIN: platform_build

Validated on Linux / Node v24.19.0 against the reconstructed supplied V118 baseline. GitHub main, Node 22 and Windows were not directly tested; user-side patch application and GitHub CI remain required.

- Full platform suite: **1,820/1,820 passed**, including **29 new V119 regressions**.
- Full production-shape scaffold: **138 passed, 1 skipped, 0 failed**. The skipped integration test requires a live disposable PostgreSQL database.
- Technical starter / reference implementation / dev-control: **7/7, 17/17, 5/5 passed**.
- Security policy suite: **38/38 passed**.
- Security regression scan: no secret/action/default/log hits or missing mandatory test concepts.
- Migration manifest: **48 checksum-pinned entries** verified by the scaffold tests.
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration. Whitespace checks passed. The patch passes `git apply --check` on a clean reconstructed V118 worktree.

Counterexamples cover asynchronous authorisation denial, unsafe role/grant posture, database failure redaction, dual-control release, replay/conflict behaviour, uncertain COMMIT, key/policy mismatch, saturated read/tenant budgets, distinct-matter denial, clock rollback, database-time rollover, forwarded IP spoofing and remote containment denial at document/credential/notification/writeback boundaries. Synchronous export cannot accept an unresolved asynchronous interlock.

The expanded `postgres-security-integration` job executes all 48 migrations and tests actual roles/RLS, shared activation/release and atomic transition history, independent pool budgets, configuration mismatches, read counts/distinct matter coverage and real window rollover, alongside V118 identity and tenant tests. **This job was not executed locally**: PostgreSQL and its driver/service are unavailable here. Unit mocks and SQL text checks do not prove PostgreSQL execution. Require the job to pass before merging; investigate any failure rather than skipping it.

Migration 048 has not been applied to a deployed database. Provision separate restricted reader/operator/limiter credentials, current operator authorisation, a common managed HMAC key/policy, explicit budget configuration bootstrap and real readiness wiring. Managed audit and other shared production adapters remain outstanding. V119 does not establish production readiness. See `docs/V119_SHARED_SECURITY_CONTROLS.md`.
