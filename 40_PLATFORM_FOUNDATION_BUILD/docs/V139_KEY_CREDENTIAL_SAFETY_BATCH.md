# V139 — Key and credential lifecycle safety

V139 fixes two reference-boundary defects together. Key metadata previously used
`tenantId + ':' + purpose` as its identity even though both values allow colons.
For example, `(ACME, CLIENT:DATA)` and `(ACME:CLIENT, DATA)` selected the same
rows. Decrypt assertions checked alias/generation/fingerprint but did not compare
the stored tenant and purpose. The registry now uses an unambiguous encoded pair
and checks all binding identity fields against the stored row.

Both key and secret rotation previously mutated rows before later clock/event
creation calls. A thrown clock or event-ID failure could leave DECRYPT_ONLY,
RETIRED or RETIRING metadata without its corresponding new state/evidence.
All seven mutation methods now use copy-on-write rollback and one clock observation
per transition. Rows and local events commit together, including both key rotation
events, or the entire in-memory metadata change is restored.

## Boundary contract

- Key register/rotate/retire and secret stage/activate/revoke/cancel require exact
  plain records with all required own data fields. Accessors, inherited fields,
  symbols and extras are rejected before reading their values. These are trusted
  server-side JavaScript APIs, not a sandbox for attacker-controlled proxies.
- Key generations must be actual integers in 1–2,147,483,647. Numeric strings,
  booleans and coercible objects no longer pass. Decrypt bindings use the same
  strict generation validation and exact own-data shape.
- Clock callbacks are synchronous and return a nonnegative safe integer within
  JavaScript Date range. Invalid, throwing, asynchronous or backwards clocks fail
  closed. The last valid observation is retained even if the subsequent change
  fails; clock correction must catch up before another transition succeeds.
- Authorization callbacks are synchronous and must return exactly `true`.
  They receive a frozen detached request. Thrown errors are sanitized; asynchronous
  authorization is denied and native promise rejection is consumed. A promise
  is not an authorization result.
- Recursive mutation through a clock/authorization callback is rejected. Catching
  that rejection inside the callback cannot make the enclosing change commit.
  Read-only observations inside those callbacks see the prior lifecycle state.
- No key/credential material is introduced. Public views remain detached copies;
  key metadata contains provider fingerprints and secret metadata contains managed
  reference fingerprints and external evidence hashes.

Existing successful behavior remains: one ACTIVE key generation, prior key
DECRYPT_ONLY until evidence-backed retirement; separate staging/activation actors;
prior secret RETIRING until explicit revocation. An unsuccessful activation keeps
the previous credential ACTIVE and the candidate STAGED.

## Validation

94 new regressions cover colliding tenant/purpose pairs, cross-tenant decrypt
refusal, all seven transitions under thrown/invalid/backwards/asynchronous clocks,
one-clock event consistency, strict request shapes, nonnumeric generations,
failed authorization, callback recursion, async rejection containment, detached
views and event-creation failures after mutation. Failure assertions compare both
rows and events and confirm a subsequent valid operation remains possible. The
17 existing key/secret tests and connector-broker integration still pass.

Local: 2,860 platform tests, 140 scaffold tests and 38 security-policy tests pass.
Security scanner is clear; knowledge lint has zero errors/warnings. PostgreSQL
is skipped locally; the full PostgreSQL 17 GitHub CI suite must pass before merge.
No migration/dependency is added.

## Operating limits

These are synchronous, process-local reference registries. Copy-on-write cost
scales with registry metadata/events. They do not persist after restart or provide
cross-process locking, managed KMS rotation, ciphertext re-encryption or cloud
credential revocation. Existing SQL lifecycle tables are unchanged and are not
wired to these classes by this batch. Production requires a durable adapter with
atomic state/evidence commits and provider operation reconciliation.

Secret mutation caller authorization remains a trusted-service responsibility;
this batch does not add an HTTP administration endpoint. Retirement/revocation
hashes are external evidence references, not independently verified proof that
all backups/ciphertext still decrypt, that provider destruction succeeded or that
in-flight credentials were drained. Recoverable retained key generations,
backup/KMS drills and current provider authority remain operating requirements.
External actions performed by a callback cannot be rolled back by this metadata
transaction. Callbacks must therefore observe/authorize only.

This is an existing D-018 defect-fix exception. The pre-TO/customer-data gates
remain in force and V131 writeback execution remains paused for partner evidence.
