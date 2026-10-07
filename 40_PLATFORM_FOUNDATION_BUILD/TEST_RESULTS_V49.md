# V49 test results

Node 24 / Python 3; synthetic adapters, loopback HTTP and local bare Git remotes.

- Platform: 409/409, including 57 new connector evidence cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5.
- Inventory: 9/9; security policy: 4/4.
- Security scan: no secret, unsafe environment or sensitive log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Initial V48 cases: 39 of 40 failed. They reproduce adapter error exposure,
  malformed history acceptance, unsupported/static PASS evidence, stale results,
  registry alias/mutation issues and checkpoint exposure/scope behavior. Some
  cases specify strengthened validation/error contracts, not 39 distinct bugs.
- Additional coverage: JSON bounds/accessors, owned read controls, configuration
  fencing, reverse completion order, tuple namespace isolation, actual HTTP
  redaction and rendered UI secrecy/status honesty. No validation test sends writes.
- Installer fixtures: V48 LF/Windows checkout endings, differing catalog metadata,
  wrong branch, dirty/unrelated work, apply/repeat, scoped commit/push and repeated
  publication against local bare Git remotes.

Native Windows link fixture limits from V47 still apply. PowerShell execution,
GitHub CI and human security review remain pending. No live provider protocol or
production permission/evidence is implied. See docs/V49_CONNECTOR_EVIDENCE_SAFETY.md.
