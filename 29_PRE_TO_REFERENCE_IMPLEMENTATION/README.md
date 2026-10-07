# Pre-TO Reference Implementation

Runnable local reference API for architecture and security behaviour. It uses only in-memory synthetic data and mock integrations.

## Run
```bash
npm test
npm start
```

Default port: `3000`.

## Implemented
- tenant-scoped matter reads;
- inbound event ingestion;
- idempotency;
- deterministic exact-reference matching;
- conflict/no-match exception routing;
- adversarial-content block path;
- tenant-scoped exceptions;
- mock Proclaim write/read-back;
- audit events;
- basic hostile upload checks.

## Explicitly not proven
- Microsoft Graph production behaviour;
- real Proclaim APIs/auth/licensing;
- production identity/SSO;
- durable queues/database/storage;
- malware scanning;
- OCR/model accuracy;
- cryptographic controls;
- production security.

This is a reference implementation, not pilot-ready software.

## V17 persistent reference path
The repository also includes a SQLite-backed local path used only to demonstrate durable state and queue semantics.

```bash
npm test
npm run start:persistent
```

Then visit `http://localhost:3000/` for the synthetic exception review UI.

SQLite/local filesystem are deliberately not production architecture decisions.
