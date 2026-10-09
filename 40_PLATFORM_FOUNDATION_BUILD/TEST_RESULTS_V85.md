# V85 Test Results — Audit checkpoint and rollback detection

Date: 2026-10-09
Version: 0.10.40

## Result

- Platform test suite: **1,478 / 1,478 passed**
- Production-shape suite: **71 / 71 passed**
- Focused V85 audit-checkpoint suite: **12 / 12 passed**
- Security policy: **21 / 21 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings**
- Synthetic demo: **RECONCILED**

## V85 security properties exercised

- externally anchorable checkpoint descriptor excludes audit bodies;
- local persistence stores only checkpoint/head hashes and a hash of the external anchor reference;
- checkpoint evidence is tenant scoped, idempotent and append-only;
- invalid or empty audit chains cannot be checkpointed;
- valid-but-shorter restored chains are detected as rollback;
- valid alternate histories are detected as forks;
- external anchor verification failure invalidates an apparently healthy local chain;
- readiness returns bounded integrity states without audit or anchor detail;
- production configuration requires external immutable anchoring, rollback detection and append-only checkpoint evidence;
- real-client-data gate requires reviewed checkpoint validation evidence;
- migration 022 is checksum pinned and tenant/RLS constrained.

No live external immutable anchor service is claimed by these tests.
