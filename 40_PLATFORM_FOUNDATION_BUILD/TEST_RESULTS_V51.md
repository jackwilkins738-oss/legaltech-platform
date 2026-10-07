# V51 test results

Node 24 / Python 3; synthetic gateways/adapters, local SQLite, loopback HTTP and local Git.

- Platform: 598/598, including 109 new inbound evidence cases.
- Fixed synthetic contract samples: 8/8; no real-data accuracy/calibration claim.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5.
- Inventory: 9/9; security policy: 4/4.
- Security scan: no secret, unsafe environment or sensitive log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Initial 57-case suite, rechecked against a fresh V50 archive: 49 failed, eight
  controls already passed. Reproductions include metadata exposure, unvalidated
  model/label contracts, getters/serialization, stale source/current match, claim
  replacement and the obsolete demo source. Some are strengthened contracts, not
  49 distinct bugs.
- Expanded cases cover current-source retry, quarantine retry, context minimization,
  restart/manual recovery, atomic audit/conditional completion, malformed retired
  output, complete recovery payload fencing, first approval/dispatch proof, historical
  compatibility, JSON key ordering and actual HTTP projection/supersession/tenant scope.
- The standalone demo command completes the synthetic approved/readback workflow.
- Existing inbound completion fault tests now target completeClaimedJob; their
  rollback/restart assertions remain.
- Installer fixtures: V50 LF/Windows checkout endings, differing catalog metadata,
  wrong branch, dirty/unrelated work, apply/repeat, scoped commit/push and repeated
  publication against local bare Git remotes.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No live model/provider protocol or production behavior is asserted.
See docs/V51_INBOUND_EVIDENCE_SAFETY.md.
