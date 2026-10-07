# V42 validation

Lifecycle: synthetic engineering reliability/security validation.

- Platform: 157/157 (135 previous + 19 recovery/API + 3 UI tests).
- Catalog inventory: 6/6 for ignored secrets/runtime/installers, source/Unicode paths,
  tracked ignored files, archive fallback and missing tracked files.
- Reproduced exhausted job displayed QUEUED with no further worker; filesystem
  catalog included ignored local `.env` and downloaded installer markers.
- Recovery tests cover safe failure visibility, exact-event retry, bounded cycles,
  lifetime counters, repeated keys, key binding, fresh-job refusal, fixed lease,
  transaction rollback, restart, retired late success/failure, decision protection,
  actor attribution and tenant/capability/body/idempotency boundaries.
- UI tests cover failure visibility, truthful analysed counts, selected-event request,
  honest unconfirmed outcomes and retained human approval.

- Legacy suites: 7/7 technical starter, 17/17 reference, 14/14 production-shape,
  5/5 dev-control contracts. Security policy tests: 4/4. Security scan is clean;
  knowledge lint has 0 errors/0 warnings. Catalog and whitespace checks pass.
- Original updater passed V41 fixtures with differing catalogs, local ignored installers/env
  markers, dirty-edit and wrong-branch refusal, repeat runs and Windows line endings.
  Local artifacts remain untouched and excluded from the rebuilt catalog.
- Optional publish was tested against local bare Git remotes: exact source/catalog
  commit, successful push, repeat without a new commit and refusal of unrelated
  staged work. Embedded PowerShell payload matches the tested Node updater.
  Default mode does not commit/push. No external remote, reset or merge was used.
- Cumulative V40-to-V42 installer includes missing V41 source/docs/tests; it is
  separately validated against V40 fixtures with the same checks and publish guards. Tests run on Linux, with Windows line-ending fixtures; the updater repeats
checks on the user's Windows checkout. No production/customer validation is claimed.
