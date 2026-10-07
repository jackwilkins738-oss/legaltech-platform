# V54 test results

Node 24 / Python 3; synthetic sessions/adapters, local SQLite, loopback HTTP and Git.

- Platform: 851/851, including 88 new inbound recovery boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5 (894 total Node tests).
- Initial 29 new regression cases against unchanged V53: 29 failed. They include
  strengthened invariants and variants, not 29 independent vulnerabilities.
- Ownership/history/cycle tests cover missing original jobs, count/pointer drift,
  partial actor proofs, malformed timestamps and negative/fractional/text/unsafe counts.
- Conditional retirement and event writes preserve changed evidence and roll back
  cancelled claims, queue, event, audit and cache on scheduling/persistence failures.
- Worker tests cover invalid queued jobs, healthy work behind them, over-budget
  claims, evidence changes during classifier awaits and superseded claim preservation.
- Historical unattributed recovery, unambiguous missing pointers, completed accepted
  replay and restart remain compatible without backfill.
- Loopback HTTP and UI tests cover unavailable evidence, tenant concealment, honest
  unknown counts and critical work queues without an automatic Retry control.
- Existing recovery persistence fault injection targets updateRecoveryEvent and
  retains complete rollback/restart assertions.
- Inventory: 9/9; security policy: 4/4; scan has no secret/unsafe-env/log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Installer fixtures: V53 LF/Windows checkout endings, scope/branch guards,
  catalog differences, apply/repeat, scoped commit/push/repeat to local bare remotes.
- Installer diagnostics: real synthetic failing Node assertion saves the full TAP
  report and prints the cause; passing control prints its summary.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No live integration, production security certification or legal rule validation is claimed.
See docs/V54_INBOUND_RECOVERY_BOUNDARY.md.
