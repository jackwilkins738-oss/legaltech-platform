# V129 validation

- Platform: 2,248 passed, zero failures, including 87 new source-ingress regressions.
- Production scaffold: 140 passed, zero failures, one skipped optional real PostgreSQL suite.
- Security policy: 38/38 passed; repository scan, knowledge lint and 35-rule local Semgrep scan must pass.
- Ten new enabled PostgreSQL cases exercise stable commands, current identity, source/matter bindings, legacy HTTP adoption, Graph lost-reply replay and the nine-pool source-readiness/drain lifecycle. Actual PostgreSQL is skipped locally and must pass in CI.
- All 55 pinned migrations remain unchanged; no dependencies are added.

The source callbacks, identity/evidence providers and webhook intake fixture are synthetic. This validates the PostgreSQL composition, not cloud provisioning or customer-data release. See `docs/V129_PRODUCTION_INGRESS_BATCH.md` for remaining adoption and deployment obligations.
