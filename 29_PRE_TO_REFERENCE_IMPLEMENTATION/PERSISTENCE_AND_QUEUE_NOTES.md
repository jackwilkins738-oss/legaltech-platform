# Persistence, Queue and UI Reference

## What changed
The pre-TO reference implementation now has a second runnable path using Node's built-in SQLite module.

It demonstrates:
- tenant-scoped persisted matters/events/exceptions/audit/idempotency;
- a durable job table with claim/complete/retry/dead-letter semantics;
- content-addressed local object storage with tenant checks;
- a minimal browser review queue;
- CI workflow on Node 22 and 24.

## Run
```bash
npm test
npm run start:persistent
```
Open `http://localhost:3000/`.

## Important limitation
SQLite and local filesystem storage are **reference-only**. Production remains Postgres/private object storage/managed queue unless architecture evidence changes that decision.

The UI deliberately uses `x-tenant-id` as a synthetic stand-in and therefore proves no production authentication property.
