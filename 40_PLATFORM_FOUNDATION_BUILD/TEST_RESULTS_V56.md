# V56 test results

Node 24 / Python 3; local filesystem/SQLite, synthetic classifier/adapters and Git.

- Platform: 1024/1024, including 93 new storage/attachment boundary cases.
- Earlier Node suites: 7/7, 17/17, 14/14 and 5/5 (1067 total Node tests).
- Initial 55 new cases against unchanged V55: 54 failed and one control passed.
  These include variants and strengthened invariants, not 54 separate vulnerabilities.
- Read/deduplication cases cover missing/invalid/foreign sidecars, hash/size/type
  mismatch, invalid UTF-8 and oversized evidence without rewriting existing files.
- Input cases cover metadata callbacks/accessors, unsupported values, aggregate
  bounds, depth/cycles/sparse arrays, owned option records and explicit byte types.
- Namespace/read cases cover immutable root authority, root replacement and observed
  binary/metadata/tenant redirects between stat and read. Link fixtures run on Linux;
  tests visibly skip if native link creation is unavailable.
- File-check cases cover malformed names/bytes/budgets/accessors and compatibility
  with empty explicit bytes, tighter valid budgets and ordinary safe suffixes.
- Worker cases cover metadata loss/corruption before and during classification,
  historical invalid safety labels, transaction rollback and authorized restoration.
- Valid compact/pretty sidecars, deduplication preservation, restarts and typed
  metadata snapshots remain compatible; existing zero/exact-limit tests also pass.
- Metadata write failure leaves an unacknowledged orphan and cannot silently repair
  it on retry; no claim of atomic filesystem/database rollback is made.
- Inventory: 9/9; security policy: 4/4; scan has no secret/unsafe-env/log hits.
- Knowledge lint: zero errors/warnings; regenerated catalog passes --check.
- Git diff whitespace check passes.
- Installer fixtures: V55 LF/Windows checkout endings, scope/branch guards,
  catalog differences, apply/repeat, scoped commit/push/repeat to local bare remotes.
- Installer diagnostics: a real failing synthetic Node assertion saves its full TAP
  report and prints the cause; passing control prints its summary.

Native Windows/PowerShell, GitHub CI and human security review remain pending.
No production scanner, live integration or security certification is claimed.
See docs/V56_STORAGE_EVIDENCE_BOUNDARY.md.

## Windows cleanup correction

The supplied Windows log showed 1007 passes, 12 failed cleanup hooks and five link
skips in the 1024-case platform suite. All shown failures were EPERM during recursive
temporary-folder removal. The shared fixture registered removal before SQLite close;
Node ran those hooks in registration order, leaving the database open at removal.
One fixture-owned cleanup now closes every registered SQLite store before removing
its own temporary directory. No assertions are removed or failures bypassed.
A deterministic child-process reproduction makes removal fail while SQLite is open:
it fails with the original fixture and passes with the corrected fixture on Linux.
The complete 1067-test Linux suite and guarded installer fixtures also pass again.
Native Windows rerun is still required; no claim is made that it has already passed.
