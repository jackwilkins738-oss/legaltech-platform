# V132 test results

- Platform: 2,368 passing tests, including 107 new V132 boundary regressions.
- Production-shape scaffold: 140 passing tests; the actual PostgreSQL integration parent is skipped locally.
- Seventeen new enabled PostgreSQL cases are included in the full disposable PostgreSQL 17 CI suite; actual database CI must pass before merge.
- All 57 checksum-pinned migrations are verified locally. Migration 057 is additive; earlier migration bytes are unchanged.
- Repository security policy, regression scan, knowledge lint and pinned Semgrep scans must pass before merge.

Synthetic source/auth/storage/evidence/control fixtures do not prove live Graph, provider permissions, external outputs or customer-data deployment. See `docs/V132_DURABLE_GRAPH_INTAKE.md` for the exact production boundaries.
