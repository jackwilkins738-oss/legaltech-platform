# V202 synthetic matter conversations

Process-local reference, **not** a deployed messaging service. Provides matter-associated threads, named participants, bounded body and subject lengths, participant-only reads/writes, per-request tenant/matter membership checks, and separate read/write capabilities. No production endpoints, notifications, database migrations, or real-client data. It does not validate a participant against a live directory and cannot guarantee durable history across processes.

**Required for production:** durable tenant RLS-backed PostgreSQL storage, authenticated recipient resolution, transactional audit, retention/records policy, message encryption and attachment policies, revocation race/authorization fencing, delivery/read semantics, paging, rate limiting, accessible UI, deployment recovery evidence. Partner-derived escalation and supervisor routing remain hypotheses awaiting TO evidence. D-018, V131, pre-TO/customer-data restrictions stay unchanged.

## Additional guarded reference behaviours
Thread creators may replace the participant list, immediately denying removed participants on subsequent calls. The original creator remains a participant. Per-instance thread capacity and per-thread message limits fail closed instead of evicting legal records. These are process-local controls and **not** distributed revocation, retention or production-level backpressure; delivery and membership changes still require durable transactional authorisation before any real deployment.
