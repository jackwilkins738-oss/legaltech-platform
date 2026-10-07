# V48 test results

Synthetic data, Node 24 / Python 3, local loopback and test remotes only.

- Platform: 352/352, including 59 new decision/recovery tests.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5.
- Inventory: 9/9; security policy: 4/4.
- Security scan: no secret, unsafe environment or sensitive log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Initial V47 cases: 34 of 36 failed, covering accepted actor/cache changes,
  weak approval input, unresolved review bypass, attachment loss, scope collision,
  overwrite after lost cache and unbound recovery replay. These also include new
  conservative compatibility/error-contract expectations, not 34 distinct bugs.
- Additional dispatch/legacy proof cases: all five failed before their related
  worker/legacy guard fixes. Other new cases cover fault rollback, key-length
  compatibility, HTTP actor conflicts, cache upgrade and restoration controls.
- One older replay fixture now supplies the original recorded reviewer rather
  than implicitly changing actors; separate regression coverage rejects that change.
- Installer fixtures: V47 LF/Windows checkout endings, differing catalog metadata,
  wrong branch/dirty/unrelated work, apply/repeat, scoped commit/push and repeat
  publication against local bare Git remotes.

No production/live connector evidence is implied. Native PowerShell execution and
GitHub CI remain pending; human security review is required before merge. See
`docs/V48_DECISION_RECOVERY_SAFETY.md` for historical compatibility and limitations.
