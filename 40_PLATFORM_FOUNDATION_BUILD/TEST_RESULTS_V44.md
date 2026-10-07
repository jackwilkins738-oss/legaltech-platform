# V44 verification

Lifecycle: current synthetic engineering test evidence.

- V43 reproduction: fresh verification during a running read-only probe created
  a third job and reset the existing two-read attempt count to zero.
- Platform: 183/183 tests, including 13 new writeback recovery regressions.
- Existing suites: technical starter 7/7, reference implementation 17/17,
  production-shape contracts 14/14, dev reproducibility contracts 5/5.
- Inventory 6/6; security policy 4/4; security regression scan clean.
- Knowledge lint zero errors/warnings; catalog current; whitespace clean.
- Installer fixture apply/repeat/commit/push verified with Linux and Windows
  line endings, local catalog variation, dirty-work and staged-work protection.
  Incompatible baseline refused before mutation; embedded payload verified.
- PowerShell wrapper inspected; no pwsh runtime here. Embedded Node carries
  mutation and checks, and was exercised against local synthetic repositories.

Tests cover actual overlapping I/O, fresh and repeated request keys, restart,
older command pointers, bounded exhausted-cycle recovery, lifetime counters,
completed commands, malformed/foreign job bindings, actor/key validation,
tenant/event isolation and authenticated HTTP reuse. The external fixture has
no native write deduplication, so duplicate writes cannot hide behind the mock.
No real Graph/Proclaim, customer data or production deployment was tested.
