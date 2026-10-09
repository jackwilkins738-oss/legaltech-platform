# V121 validation evidence

STATUS: CURRENT
DOMAIN: platform_build

Validated on Linux / Node v24.19.0 against the reconstructed supplied V120 baseline. GitHub main, Node 22 and Windows were not directly tested.

- Full platform suite: **1,869/1,869 passed**, including **26 new shared-queue regressions**.
- Full production-shape scaffold: **140 passed, 1 skipped, 0 failed**. The skipped test requires actual disposable PostgreSQL.
- Technical starter / reference implementation / dev-control: **7/7, 17/17, 5/5 passed**.
- Security policy suite: **38/38 passed**.
- Security regression scan: no secret/action/default/log hits or missing mandatory concepts.
- Migration manifest: **50 checksum-pinned entries** verified by scaffold tests.
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration. Whitespace checks passed. The packaged patch passes `git apply --check` on a clean reconstructed V120 worktree.

Counterexamples cover privacy shape/policy bounds, immutable enqueue replay/conflicts, async current-authority denial, unsafe role/grant posture, disabled transition trigger, committed hashed claim credentials, returned binding mismatch, stale fences, current authorisation withdrawal, settlement replay, uncertain commits, bounded recovery and read access. Unit mocks do not establish actual PostgreSQL locking or mutation semantics.

The expanded `postgres-security-integration` job executes all 50 migrations and adds actual independent worker claims, skipped locked candidates, replay, narrow privileges, heartbeat, crash recovery/reclaim, stale-token rejection, external reconciliation, attempt caps and authority withdrawal. **This job was not executed locally**: PostgreSQL and its driver/service are unavailable here. Require it to pass before merge; do not treat the skipped local test as a replacement. Its synthetic callbacks and owner-seeded expiry records do not validate actual identity providers, domain handlers or external side effects.

Migration 050 has not been applied to a deployed database. Producer/worker probes verify database posture; production QUEUE readiness must add controlled functional canary coverage through the actual authorised loader/worker path. Domain transaction/outbox integration, idempotent handlers, cancellation/renewal, external command reconciliation, audit and deployed operational validation remain outstanding. V121 does not claim exactly-once external execution or production readiness. See `docs/V121_SHARED_QUEUE.md`.
