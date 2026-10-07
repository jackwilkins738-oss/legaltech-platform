# BUILD PHASES & GATES

## Phase E0 — Engineering foundation
Build repo, CI, local stack, auth/tenant skeleton, observability.

Gate:
- local/test reproducible;
- CI green;
- no customer data.

## Phase E1 — Ingest spike
Graph webhook/delta + safe document pipeline + canonical inbound event.

Gate:
- duplicate-safe;
- scoped mailbox;
- hostile-file controls.

## Phase E2 — Canonical matter/review
Matter model + candidates + review UI + audit.

Gate:
- cross-tenant tests;
- human correction captured.

## Phase E3 — Proclaim adapter
Mock contract then authorised test environment.

Gate:
- write/readback;
- unknown-outcome reconciliation;
- no silent duplicate.

## Phase E4 — AI assist/evals
Classification/extraction/matching suggestions.

Gate:
- versioned eval;
- zero wrong-client auto-file threshold before any auto filing;
- prompt-injection tests.

## Phase E5 — Pilot hardening
SSO, monitoring, backups, admin config, support/runbooks.

Gate:
- security acceptance;
- restore test;
- customer scope;
- pilot success metrics.

## Phase E6 — Paid pilot
Only after commercial/evidence gate.
