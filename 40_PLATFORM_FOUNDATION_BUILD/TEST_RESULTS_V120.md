# V120 validation evidence

STATUS: CURRENT
DOMAIN: platform_build

Validated on Linux / Node v24.19.0 against the reconstructed supplied V119 baseline. GitHub main, Node 22 and Windows were not directly tested.

- Full platform suite: **1,843/1,843 passed**, including **23 new shared-audit regressions**.
- Full production-shape scaffold: **140 passed, 1 skipped, 0 failed**, including two new repeatable-read/invalid-isolation boundary regressions. The skipped integration test requires real disposable PostgreSQL.
- Technical starter / reference implementation / dev-control: **7/7, 17/17, 5/5 passed**.
- Security policy suite: **38/38 passed**.
- Security regression scan: no secret/action/default/log hits or missing required concepts.
- Migration manifest: **49 checksum-pinned entries** verified. The conservative TRUNCATE token flag on the defensive denial trigger is retained with explicit review `V120-AUDIT-TRUNCATE-GUARD`; no migration classifier was weakened. See the source review in `docs/V120_SHARED_AUDIT.md`.
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration. Whitespace checks passed. The packaged patch passes `git apply --check` on a clean reconstructed V119 worktree.

Counterexamples cover event replay/conflict, payload privacy shape, unsafe grants/roles, missing triggers, tampered last rows, failed head advance, uncertain commits, snapshot selection, bounded paging, chronology, gaps/forks/rollback, invalid or absent anchors and external-anchor timeout. Unit mocks are not SQL execution evidence.

The expanded `postgres-security-integration` CI job now executes all 49 migrations and adds actual independent writer concurrency, replay, mutation/privilege denial, SQL metadata/hash validation, concurrent snapshot reads and rollback detection using a synthetic descriptor retained outside the test database. **This job was not executed locally:** PostgreSQL and its driver/service are unavailable here. It must pass before merging; a skipped local test cannot replace it. The synthetic test descriptor does not validate an immutable external production provider or signature verification.

Migration 049 has not been applied to a deployed database. The new sink is not a drop-in replacement for synchronous SQLite audit/checkpoint APIs. Production still needs restricted credentials, same-instance probe/operation wiring, trusted external anchoring, audit failure gates, retention/capacity and operational validation. V120 does not establish production readiness.
