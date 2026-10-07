# V38 validation

Lifecycle: current engineering validation. Synthetic data only.

- Current platform: 51/51 passing (33 existing + 18 failure/security regressions).
- Added regressions cover cross-tenant reads and all integration mutation routes,
  capability/body-tenant checks, mailbox/reader scope and revocation, rejected
  notification deduplication, identity collisions, successive same-resource updates,
  expiry, lifecycle/recovery guards, attempt accounting, malformed JSON/types,
  minimized failure records, operator/trace audits and unavailable audit storage.

- Legacy CI suites: technical starter 7/7; reference implementation 17/17;
  production-shape contracts 14/14; dev-control contracts 5/5.
- Security policy tests: 4/4. Security scan: no secret, unsafe-default or sensitive-log hits.
- Knowledge lint: 0 errors, 0 warnings. Catalog check and Git whitespace check pass.
- Synthetic demo completes approved writeback and read-back reconciliation.
- Local dev server smoke: V38 page, configured Graph subscription and durable audit pass.
- Catalog/lint remain clean when synthetic `.dev-data` runtime files exist.
- Embedded updater applies to the exact uploaded V37 baseline, creates its
  feature branch, preserves HEAD, runs all checks and verifies repeat runs without
  reapplying. Dirty checkouts are refused with existing edits intact. The same
  tests pass with repository Windows line-ending rules (CRLF scripts/batch files).
- Linux validation environment. Windows execution is checked by the delivered
  installer on the user's existing checkout; no claim of a completed Windows run.
No authorized customer integration, production SSO, production Postgres/RLS or
live Microsoft/Proclaim behavior is claimed.
