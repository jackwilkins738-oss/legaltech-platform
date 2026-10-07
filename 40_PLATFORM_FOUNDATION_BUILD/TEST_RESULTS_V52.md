# V52 test results

Node 24 / Python 3; synthetic sessions, loopback HTTP and local Git fixtures.

- Platform: 679/679, including 81 new authentication boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5 (722 total Node tests).
- Initial 63-case regression suite against V51: 51 failed and 12 controls passed.
  These are contract/abuse cases, not 51 distinct independent vulnerabilities.
- Delayed-body HTTP tests preserve both tenant scope and review actor attribution.
- Inventory: 9/9; security policy: 4/4; scan has no secret/unsafe-env/log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Installer fixtures: V51 LF/Windows checkout endings, scope/branch guards,
  catalog differences, apply/repeat, scoped commit/push/repeat to local bare remotes.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No real OIDC signature/token verification, production SSO or live integration is claimed.
See docs/V52_AUTH_BOUNDARY_SAFETY.md.
