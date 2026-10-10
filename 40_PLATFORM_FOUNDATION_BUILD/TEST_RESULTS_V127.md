# V127 validation

- Platform: 2,134 passed, zero failures, including 42 new durable-drain boundary regressions.
- Production scaffold: 140 passed, zero failures, one skipped optional real PostgreSQL integration suite.
- Security policy: 38/38 passed. Semgrep CE: zero findings with 35 local rules; repository security scan and knowledge lint must also pass in CI.
- Migration 055 is pinned; the earlier 54 migrations remain unchanged.
- Twenty-one new enabled PostgreSQL CI cases exercise durable shared state, principal and schema boundaries, exact replay/reconciliation, source tampering and the full nine-pool service lifecycle. PostgreSQL is not validated locally. Actual `postgres-security-integration` and all other CI checks must pass before merge.

Tests use synthetic identity, provider, audit and artifact dependencies. No deployed cloud service or customer-data release is certified. See `docs/V127_DURABLE_DEPLOYMENT_DRAIN.md` for provisioning and recovery obligations.
