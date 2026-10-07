# V46 test results

Build environment: Node 24, Python 3; synthetic data and loopback/local test remotes.

- Platform: 246/246, including 39 new HTTP boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5.
- Repository inventory: 9/9; security policy: 4/4.
- Security regression scan: no secret, unsafe environment or sensitive log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- V45 baseline reproductions: 17 of the initial 24 boundary tests failed;
  malformed UTF-8 reached ingest, malformed IDs returned 500, duplicate headers
  reached routing and unexpected error metadata reached responses. The seven
  controls (body limits, aborts and valid input) already passed on V45.
- Installer fixture checks: V45 LF and Windows checkout endings, differing local
  catalog metadata, wrong branch/dirty/unrelated edits, apply and repeat, optional
  scoped commit/push and repeat publication against local bare Git remotes.

No real connector or production evidence is implied. Native PowerShell execution,
GitHub CI and human security review remain required before merge. See
`docs/V46_HTTP_BOUNDARY_SAFETY.md` for changed client-error behavior and limitations.
