# V50 test results

Node 24 / Python 3; synthetic adapters, local SQLite, loopback HTTP and local bare Git.

- Platform: 489/489, including 80 new writeback boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5.
- Inventory: 9/9; security policy: 4/4.
- Security scan: no secret, unsafe environment or sensitive log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Initial V49 boundary suite: 47 of 53 failed; six safety controls already passed.
  Cases reproduce operator/cache proof gaps, missing-command resend/false completion,
  malformed counters/flags/evidence, provider failure metadata and late binding
  overwrites. Several cases specify strengthened contracts; these are not 47 distinct bugs.
- Expanded coverage: restart/replay, completed receipts, missing-command positive read,
  overflow, audit rollback, approval status/job trace changes, conflicting receipts
  and malformed IDs. Actual HTTP checks same-tenant operator conflict and one probe.
- The earlier cache-extra-field fixture now preserves original internal receipt proof
  while adding the unrelated field; a separate test rejects unproved historical caches.
- Installer fixtures: V49 LF/Windows checkout endings, catalog metadata differences,
  wrong branch, dirty/unrelated work, apply/repeat, scoped commit/push and repeated
  publication against local bare Git remotes.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No production/live provider behavior is asserted. See docs/V50_WRITEBACK_BOUNDARY_SAFETY.md.
