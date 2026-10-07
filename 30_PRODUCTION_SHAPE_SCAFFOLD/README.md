# Production-Shape Scaffolding

This directory moves the pre-TO reference implementation toward the intended production architecture without pretending that customer-specific deployment decisions are already known.

## What is real here
- versioned PostgreSQL migration definitions;
- tenant-isolation/RLS policy prototypes;
- authentication/authorization boundary contracts;
- worker lifecycle semantics;
- structured observability/redaction helpers;
- environment validation;
- local Postgres container definition;
- executable contract/static tests.

## What is NOT proven
- migrations have not yet been applied to a real production-like Postgres instance in this environment;
- no real SSO/Entra integration;
- no real queue provider;
- no real KMS/secrets manager;
- no customer networking/SIEM;
- no real Proclaim/Graph credentials.

The SQLite implementation in `29_PRE_TO_REFERENCE_IMPLEMENTATION/` remains the executable behavioural reference. This directory defines the next production-shaped boundary.

## Run
```bash
npm test
```

## Postgres local dev
A `compose.yaml` is supplied for an engineer/Claude Code environment with Docker. Use only synthetic data.
