# V45 batch verification

Lifecycle: current synthetic engineering test evidence.

## Reproductions

- V44: an expired worker's empty read requeued the same job while its replacement
  was RUNNING; the fixed worker returns SUPERSEDED and changes no replacement state.
- V44: an old-cycle empty read consumed one attempt from a fresh recovery cycle;
  the fixed cycle remains at zero attempts until its own worker reserves a read.
- Persistence-fault regressions prove read-back success, audit and job completion
  roll back together and that no read occurs before reservation commit.

## Results

- Platform: 207/207, including 22 new worker/recovery tests and 2 new UI regressions.
- Existing suites: technical starter 7/7; reference implementation 17/17;
  production-shape contracts 14/14; dev reproducibility contracts 5/5.
- Repository inventory 9/9; security policy 4/4; security regression scan clean.
- Knowledge lint zero errors/warnings; catalog current; whitespace clean.
- Installer embedded payload verified. Fixture apply, repeat, scoped commit/push,
  catalog variation and Windows/Linux line endings passed; dirty tracked files,
  unrelated staged/unstaged/untracked files and incompatible baseline are guarded
  before publication; version-prefixed downloads stay preserved and uncatalogued.
- No pwsh runtime available here: wrapper inspected; embedded Node mutation and
  checks exercised against synthetic local repositories and local bare remotes.

## Coverage and limits

Cases include late error/empty/malformed/positive results, late known write failure
and receipt, lease handoff across SQLite connections, old-cycle failures/positive
evidence/conflicting receipts, legacy overlapping jobs and shared budgets, claim
ownership by tenant/type/attempt/status, reservation/audit/job-completion faults,
authenticated HTTP SUPERSEDED output and truthful operator notices. External
fixtures have no native write deduplication. No live customer/integration access,
production deployment, certification or production queue performance tested.
