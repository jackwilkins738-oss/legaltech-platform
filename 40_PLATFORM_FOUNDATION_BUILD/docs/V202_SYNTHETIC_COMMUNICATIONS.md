# V202 synthetic matter conversations

Process-local reference, **not** a deployed messaging service. Provides matter-associated threads, named participants, bounded body and subject lengths, participant-only reads/writes, per-request tenant/matter membership checks, and separate read/write capabilities. No production endpoints, notifications, database migrations, or real-client data. It does not validate a participant against a live directory and cannot guarantee durable history across processes.

**Required for production:** durable tenant RLS-backed PostgreSQL storage, authenticated recipient resolution, transactional audit, retention/records policy, message encryption and attachment policies, revocation race/authorization fencing, delivery/read semantics, paging, rate limiting, accessible UI, deployment recovery evidence. Partner-derived escalation and supervisor routing remain hypotheses awaiting TO evidence. D-018, V131, pre-TO/customer-data restrictions stay unchanged.
