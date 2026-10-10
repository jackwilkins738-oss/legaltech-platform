# V136 test results

- Platform: 2,645/2,645 pass, including 83 new document-boundary regressions.
- Scaffold: 140/140 pass; native PostgreSQL integration is skipped locally.
- PostgreSQL 17: six new cases plus the extended eleven-pool root; all 147 tests required in CI before merge. Native PostgreSQL is unavailable locally.
- Security/knowledge checks: 38/38 policy tests pass, scan findings/missing concepts are empty, knowledge lint reports zero errors/warnings.
- All 59 migration bytes unchanged; no dependency or subprocessor added.

Tests use synthetic documents/providers/identities. Downloads do not prove source review or client receipt. No inline viewer or external writeback executor is delivered. D-018, the pre-TO freeze and customer-data gate remain; V131 execution stays paused pending partner evidence.
