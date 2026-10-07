# V55 test results

Node 24 / Python 3; synthetic Graph/registry, local SQLite, loopback HTTP and Git.

- Platform: 931/931, including 80 new Graph boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5 (974 total Node tests).
- Initial 57 cases against unchanged V54: 56 failed and one control passed. These
  include variants and strengthened invariants, not 56 independent vulnerabilities.
- Authority cases cover tenant/budget changes and redefinition, dependency replacement,
  private map exposure/shadow injection and independent returned snapshots.
- Clock cases cover all mutation classes, duplicate/retry/dead-letter history,
  invalid values, one observation per operation and coherent expiry/health snapshots.
- Typed-input cases reject accessors/inherited records without invoking their getters;
  dense mailbox copying and null-prototype/default/explicit-false behavior are checked.
- Compatibility cases retain revocation, exact expiry, renewal restrictions,
  retry budgets/lifetime counts and deduplication after a clock failure.
- HTTP cases deny tenant retarget/foreign requests before clock evaluation, return
  minimized 503 errors, preserve connector state and record ATTEMPT/FAILED only.
- Existing checkpoint tests retain content minimization and scope assertions through
  the public snapshot interface instead of reading the removed internal delta map.
- Inventory: 9/9; security policy: 4/4; scan has no secret/unsafe-env/log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Installer fixtures: V54 LF/Windows checkout endings, scope/branch guards,
  catalog differences, apply/repeat, scoped commit/push/repeat to local bare remotes.
- Installer diagnostics: real synthetic failing Node assertion saves the complete
  TAP report and prints its cause; passing control prints its summary.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No live integration or production security certification is claimed.
See docs/V55_GRAPH_BOUNDARY_SAFETY.md.
