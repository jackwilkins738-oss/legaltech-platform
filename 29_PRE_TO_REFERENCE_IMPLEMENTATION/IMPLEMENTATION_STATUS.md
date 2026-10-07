# Implementation Status — V17

## Implemented reference behaviour
- in-memory reference API;
- SQLite-backed local persistent API;
- persisted tenants/matters/events/exceptions/audit/idempotency;
- durable local job table with retry/dead-letter state primitives;
- content-addressed local object-storage abstraction;
- deterministic matter matching;
- mock Proclaim adapter with write/read-back;
- minimal review queue UI;
- GitHub Actions test workflow;
- synthetic security-negative tests.

## Safe conclusions
The proposed architectural boundaries are implementable using ordinary web/backend primitives.
Idempotent event handling and tenant-scoped storage can be enforced in code/tests.
A review-first UI can sit over exception state without choosing the eventual commercial wedge.

## Still not implemented/proven
- production identity or session security;
- Postgres/RLS migrations;
- managed queue worker;
- cloud object storage and signed URLs;
- malware scanning sandbox;
- Microsoft Graph production connector;
- Proclaim real connector;
- AI gateway/model routing;
- production monitoring/secrets/KMS;
- customer-specific information barriers;
- production-grade frontend.

## Status
This is a wedge-agnostic pre-TO engineering reference, not pilot-ready software.
