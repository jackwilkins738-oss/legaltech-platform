# V130 validation

- Platform: 2,261 passed, zero failures, including 13 new review-decision regressions.
- Production scaffold: 140 passed, zero failures, one skipped optional real PostgreSQL suite.
- Real PostgreSQL integration suite: 105/105 passed in three consecutive runs locally against a disposable PostgreSQL 16 database (98 existing cases plus 7 new V130 cases). CI runs the same suite on PostgreSQL 17 and must pass before merge.
- The V130 cases run last in the shared suite. Their approvals queue PROCLAIM_WRITEBACK work that nothing in the suite executes yet, and when they ran mid-suite, that work intermittently stopped the later V127/V129 service drain cases (1 run in 3 locally; in CI). Each V130 fixture also processes until its own job has a result, so another case's leftover queue work cannot be mistaken for it.
- Security policy: 38/38 passed; the repository security regression scan and knowledge lint pass (0 errors, 0 warnings, after regenerating the file catalog).
- Migrations: 56 pinned, with the new `056_domain_review_decisions.sql` added to the checksum manifest. Existing migrations are unchanged. No dependencies are added.

The decision authority callback and identities are synthetic. This validates the PostgreSQL decision boundary, not a review UI, real permissions, Proclaim writeback execution or customer-data release. See `docs/V130_DURABLE_REVIEW_DECISION.md`.
