# V43 verification

Lifecycle: current synthetic engineering test evidence.

- V42 defect reproduced from the committed local baseline: changed rejection
  notes returned replayed success while the original notes remained stored.
- Platform: 170/170 tests, including 13 new review-request regressions.
- Regression suites: technical starter 7/7, reference implementation 17/17,
  production-shape contracts 14/14, dev reproducibility contracts 5/5.
- Inventory: 6/6; security policy: 4/4; security regression scan clean.
- Knowledge lint: zero errors/warnings; catalog current; whitespace clean.
- Installer payload verified against the generated Node updater; fixture apply,
  repeat and commit/push checked with Linux and Windows line-ending settings.
  Dirty tracked work, incompatible baseline and unrelated staged work are guarded.
- PowerShell wrapper is inspected but cannot be executed here (no pwsh runtime).
  Its embedded Node updater carries repository mutations and validation.

The regressions cover changed notes/actor/resolution/target, restart replay,
malformed fields, historical requests, deleted/foreign resources, job ownership,
transaction rollback, scope ambiguity and HTTP authorization/409 responses.
No live adapters, customer data, production deployment or certification tested.
