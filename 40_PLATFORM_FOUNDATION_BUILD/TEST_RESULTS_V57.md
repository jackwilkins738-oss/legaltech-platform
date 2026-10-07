# V57 test results

Node 24 / Python 3; synthetic providers/registry, local SQLite, loopback HTTP and Git.

- Platform: 1110/1110, including 86 new validation/registry boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5 (1153 total Node tests).
- Initial 50 new cases against unchanged corrected V56: 48 failed and two controls
  passed. These include variants/invariants, not 48 independent vulnerabilities.
- History cases cover sparse/partial/duplicate/oversized arrays, overridden methods,
  inherited/accessor identities, foreign/configuration bindings and exact-size controls.
- Harness cases cover fixed tenant, copied capabilities, captured provider/registry
  methods, original method receivers and private in-flight retirement tokens.
- Registry cases cover private/shadow maps, owned typed options/capabilities, lossy
  metadata shapes, safe proto-shaped keys, revision mismatches and independent copies.
- A stale read of registry state cannot overwrite a newer revocation. Conditional
  null/foreign/counterfeit/wrong-revision acknowledgements cannot claim persistence.
- API cases preserve foreign-tenant concealment and report malformed history as RED
  with write/live checks still NOT_TESTED/BLOCKED; raw payload/error content stays out
  of responses, summaries and audit. Read-only validation calls no write method.
- Existing corrected V56 SQLite teardown remains; new HTTP fixtures close the server
  and SQLite together without a temporary-directory cleanup ordering dependency.
- Inventory: 9/9; security policy: 4/4; scan has no secret/unsafe-env/log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Installer fixtures: corrected V56 LF/Windows checkout endings, scope/branch guards,
  catalog differences, apply/repeat, scoped commit/push/repeat to local bare remotes.
- Installer checks the corrected V56 fixture hash before fresh application.
- Diagnostics fixture: real failing synthetic Node assertion saves its complete TAP
  report and prints the cause; passing control prints its summary.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No live integration, legal validation or production security certification is claimed.
See docs/V57_VALIDATION_EVIDENCE_BOUNDARY.md.
