# V47 test results

Node 24 / Python 3, synthetic objects and loopback/local test remotes only.

- Platform: 293/293; 47 new attachment/storage tests.
- Earlier Node suites: 7/7, 17/17, 14/14, 5/5.
- Inventory: 9/9; security policy: 4/4.
- Security scan: no secret, unsafe environment or sensitive log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Initial V46 baseline run: 29 of 35 new cases failed, covering corrupt content
  reuse, reference coercion/extra segments, linked paths, blocked filename aliases,
  and unavailable objects progressing through processing. Non-string tenant cases
  also verify the new bounded error contract rather than an untyped exception.
- Installer fixtures: V46 LF and Windows checkout endings, differing catalog
  metadata, wrong branch, dirty/unrelated changes, apply/repeat, scoped publication
  and publication repeats against local bare Git remotes.

All link fixtures passed on Linux. Native Windows may skip link creation when
privileges are unavailable; Windows PowerShell execution and GitHub CI are pending.
No live connector, production malware scanner or production evidence is implied.
Human review remains required. See docs/V47_ATTACHMENT_STORAGE_SAFETY.md for
compatibility, recovery and filesystem/SQLite rollback limits.
