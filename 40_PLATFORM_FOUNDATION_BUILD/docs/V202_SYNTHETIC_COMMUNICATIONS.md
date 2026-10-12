# V202 synthetic matter conversations

Process-local reference, **not** a deployed messaging service. Provides matter-associated threads, named participants, bounded body and subject lengths, participant-only reads/writes, per-request tenant/matter membership checks, and separate read/write capabilities. No production endpoints, notifications, database migrations, or real-client data. It does not validate a participant against a live directory and cannot guarantee durable history across processes.

**Required for production:** durable tenant RLS-backed PostgreSQL storage, authenticated recipient resolution, transactional audit, retention/records policy, message encryption and attachment policies, revocation race/authorization fencing, delivery/read semantics, paging, rate limiting, accessible UI, deployment recovery evidence. Partner-derived escalation and supervisor routing remain hypotheses awaiting TO evidence. D-018, V131, pre-TO/customer-data restrictions stay unchanged.

## Additional guarded reference behaviours
Thread creators may replace the participant list, immediately denying removed participants on subsequent calls. The original creator remains a participant. Per-instance thread capacity and per-thread message limits fail closed instead of evicting legal records. These are process-local controls and **not** distributed revocation, retention or production-level backpressure; delivery and membership changes still require durable transactional authorisation before any real deployment.

## V203 synthetic accountability: retry and concurrent review

Local-only routes under `/api/v1/dev/conversations` are disabled without an explicitly injected synthetic adapter and forbidden during production admission. `GET /{threadId}/audit` reveals metadata-only audit events to the creator subject to live tenant, matter, participant and read-capability checks. Content bodies do not appear in audit entries.

`POST /{threadId}/messages` accepts optional `requestId` (bounded, actor-scoped). Repeating a request with the same actor, request identifier and body returns the original message without adding an event, revision or second message. A different payload using the same request identifier fails with 409 `COMMUNICATION_CONFLICT`; other actors have independent namespaces. Retry receipts exist only in process memory and are **not** suitable for distributed idempotency.

`PUT /{threadId}/participants` accepts optional positive `expectedRevision`. When supplied, a stale value fails with 409 `COMMUNICATION_CONFLICT` before membership mutation or audit. API consumers should obtain the current revision from `GET /{threadId}/snapshot`. These controls address local synthetic retries and UI concurrency only, **not** PostgreSQL transaction isolation or cross-server revocation.

Delivery receipts, client notification, directory validation, persistent authorization checks, tenant RLS, production operations and TO-dependent case-manager workflow decisions remain unimplemented.
