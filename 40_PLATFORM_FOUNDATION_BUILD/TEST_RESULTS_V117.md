# V117 validation evidence

STATUS: CURRENT
DOMAIN: platform_build

Validated on Linux / Node v24.19.0 against the reconstructed supplied V116 baseline. GitHub main and Windows were not directly tested; local patch application verification and GitHub CI remain required.

- Full platform suite: **1,776/1,776 passed**, including **18 new V117 admission regressions** and all 19 V116 regressions.
- Full production-shape scaffold: **126/126 passed**, including **8 new database-probe unit/SQL-contract tests**. The focused database tests were repeated after catalog tightening and passed 8/8.
- Technical starter / reference implementation / dev-control: **7/7, 17/17, 5/5 passed**.
- Security policy suite: **38/38 passed**.
- Security regression scan: no secret/action/default/log hits or missing required test concepts.
- Migration manifest: 46 entries verified by the scaffold tests. Source inspection found zero ENABLE-RLS tables lacking FORCE after migration 046.
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration. Git diff whitespace checks passed. The packaged patch passes `git apply --check` on a clean reconstructed V116 worktree.

Executable PostgreSQL validation was **not completed**. Invoking the runtime-check CLI returned `PSQL_EXECUTION_UNAVAILABLE`; no PostgreSQL binary or live runtime connection is available in this environment. Unit tests use fake driver connections and do not execute SQL. The catalog check and synthetic isolation suite must be run by the controlled deployment operator before PostgreSQL posture can be recorded as verified.

The readiness/data-route bypass and ignored asynchronous HTTP security callbacks are covered by counterexamples. Callback registration does not prove actual provider wiring. Shared production security adapters, real pool transaction/context tests, actual database privileges/policies and live operational controls remain deployment work. See `docs/V117_PRODUCTION_ADMISSION.md` and the scaffold's `docs/V117_RUNTIME_DATABASE_VERIFICATION.md`.
