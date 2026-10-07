# V53 test results

Node 24 / Python 3; synthetic sessions/adapters, local SQLite, loopback HTTP and Git.

- Platform: 763/763, including 84 new review boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5 (806 total Node tests).
- Initial 43 cases against V52: 33 failed and 10 controls passed. These include
  strengthened invariants; they are not 33 independent vulnerabilities.
- Conditional-write lost row/status/content tests preserve open decisions and
  roll back queue, commands, cache, notes and audit, then permit safe retry.
- Historical JSON whitespace, missing links with unambiguous owned records,
  quarantine rejection and restart replay remain compatible.
- Audit-only HTTP tests cannot retrieve current/historical rejection note content.
- UI cases cover partial rejection counts/selections, refresh and unverified approval.
- Existing approval persistence fault injection now targets updateReviewEvent;
  its complete rollback/retry assertions remain.
- Inventory: 9/9; security policy: 4/4; scan has no secret/unsafe-env/log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Installer fixtures: V52 LF/Windows checkout endings, scope/branch guards,
  catalog differences, apply/repeat, scoped commit/push/repeat to local bare remotes.

- Installer diagnostics fixture: a real synthetic failing Node assertion preserves
  its full TAP report, prints the cause and fails verification; the passing control
  prints its summary without creating a failure report.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No live integration, production security certification or legal rule validation is claimed.
See docs/V53_REVIEW_BOUNDARY_SAFETY.md.
