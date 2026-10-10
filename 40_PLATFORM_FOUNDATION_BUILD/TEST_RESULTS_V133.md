# V133 test results

- Platform: 2,444 passing tests, including 76 new V133 regressions.
- Production-shape scaffold: 140 passing tests; the actual PostgreSQL parent is skipped locally.
- PostgreSQL 17: ten new connected cases are enabled (132 total); CI must pass before merge. No local database execution is claimed.
- All 58 checksum-pinned migrations verified; migration 058 is additive and earlier bytes remain unchanged.
- Security policy tests, regression scan and knowledge lint must pass before merge.

Synthetic providers do not attest live permissions, audit durability, customer deployment or Proclaim outputs. V131 execution remains paused. See `docs/V133_PRODUCTION_REVIEW_BOUNDARY.md`.
