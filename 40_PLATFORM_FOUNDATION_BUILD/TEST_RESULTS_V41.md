# V41 validation

Lifecycle: synthetic engineering validation; no customer data or live integration.

- Platform suite: 135/135 (111 existing + 24 request/replay regression tests).
- V40 reproduction: changed-body replay returned original event; tenant/key
  delimiter collision returned a foreign event; malformed base64 decoded empty.
- Conflicts cover subject/body, source system/ID, attachment filename/content type,
  bytes/order/count and quarantined content. No extra event, job or acceptance audit.
- Equivalent defaults and text/base64 representation replay; fingerprints survive
  restart and processing-state changes. Existing trace remains authoritative.
- New delimiter collisions are isolated. Legacy foreign caches, foreign jobs and
  missing original events cannot produce accepted replay. Cached trace is untrusted.
- Legacy text-only requests safely upgrade. Unverifiable attached requests fail
  closed without guessing original bytes, creating work or changing original state.
- Wrong domain/HTTP types, malformed attachment metadata, oversized attachment count,
  dual encodings, base64 garbage/missing padding/noncanonical bits/whitespace fail
  before object/database writes. HTTP errors are stable and exclude input content.

- Legacy suites pass: technical starter 7/7; reference 17/17; production-shape
  contracts 14/14; dev-control contracts 5/5.
- Security policy tests pass 4/4; scan has no secret, unsafe-default or sensitive-log
  findings. Knowledge lint has 0 errors/0 warnings. Catalog and whitespace pass.
- Updater passes V40 fixtures with differing catalog content, dirty-edit and wrong-
  branch refusal, repeat runs and Windows line-ending rules. PowerShell payload
  matches the tested Node updater. No commit, push, merge or reset is performed.
- Legacy fingerprint/cache migration failure rolls back both together.
Validation runs on Linux; the updater repeats checks on Windows. Real integration
limits, production identity/storage and customer behavior remain unproven.
