# V130 validation

- Platform: 2,261 passed, zero failures, including 13 new review-decision regressions.
- Production scaffold: 140 passed, zero failures, one skipped optional real PostgreSQL suite.
- Real PostgreSQL integration suite: 105/105 passed when run locally against a disposable PostgreSQL 16 database (98 existing cases plus 7 new V130 cases). CI runs the same suite on PostgreSQL 17 and must pass before merge.
- Security policy: 38/38 passed; the repository security regression scan and knowledge lint pass (0 errors, 0 warnings, after regenerating the file catalog).
- Migrations: 56 pinned, with the new `056_domain_review_decisions.sql` added to the checksum manifest. Existing migrations are unchanged. No dependencies are added.

The decision authority callback and identities are synthetic. This validates the PostgreSQL decision boundary, not a review UI, real permissions, Proclaim writeback execution or customer-data release. See `docs/V130_DURABLE_REVIEW_DECISION.md`.
