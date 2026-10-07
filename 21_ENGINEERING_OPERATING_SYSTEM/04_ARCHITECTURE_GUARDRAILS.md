# ARCHITECTURE GUARDRAILS

## Mandatory
- modular monolith first;
- Postgres canonical transactional store;
- private object storage;
- async queue for inbound work;
- server-side authorization;
- tenant-scoped data model;
- append-oriented audit;
- integration adapters around Graph/Proclaim/AI/OCR;
- idempotent external-event processing;
- explicit retries and dead-letter handling;
- trace IDs end to end.

## Tenant rules
Every tenant-owned row carries `tenant_id` unless there is a documented global/reference exception.

Enforce:
- application authorization;
- DB-level constraints/RLS where appropriate;
- tenant-consistent foreign keys / validation.

No normal request may use an unrestricted cross-tenant DB service identity.

## AI rule
AI cannot directly query arbitrary DB/storage.
It receives pre-authorized, minimized context through controlled tools.

## File rule
Uploaded files are hostile.
Parser/OCR work runs outside trusted request path and behind quarantine controls.

## Integration rule
No external integration writes directly into internal tables.
Adapter → canonical command/event → policy → transaction → audit.

## Failure rule
Unknown external write outcome is a distinct state.
Never blindly retry a write that may have succeeded.

## Portability
Business/domain logic must not depend directly on Vercel/Supabase proprietary APIs where a standard abstraction is practical.
