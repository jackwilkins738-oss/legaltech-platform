# V128 validation

- Platform: 2,161 passed, zero failures, including 27 new artifact containment regressions.
- Production scaffold: 140 passed, zero failures, one skipped optional PostgreSQL suite.
- Security policy: 38/38 passed; repository security scan, knowledge lint and local 35-rule Semgrep scan have no findings.
- All 55 pinned migrations remain unchanged. No provider dependency is added.
- Four new enabled PostgreSQL cases cover cleanup-time permission withdrawal, source-byte release after actual completion/failure and durable drain retention while cancelled cleanup is unresolved. PostgreSQL is not validated locally; actual CI must pass before merge.

Synthetic adapters do not certify production cloud SDK behavior, business permissions or customer-data readiness. See `docs/V128_ARTIFACT_RESOURCE_CONTAINMENT.md` for resource limits and ownership obligations.
