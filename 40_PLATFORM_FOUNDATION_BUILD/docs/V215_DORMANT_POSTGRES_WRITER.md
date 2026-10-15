# V215 — Dormant PostgreSQL conversation writer reference

V215 adds a substantive PostgreSQL mutation implementation using an **injected trusted transaction** and an **injected trusted authorization callback**. This is not a deployed service: it creates no database role, grants, production routes, pool factory, or activation flag. The existing restrictive always-false row policies continue to deny application access.

## Operations implemented in the reference

- **CREATE**: authorization occurs inside the write transaction before thread, participant and metadata-only CREATED audit rows are inserted.
- **POST**: locks the thread row with `FOR UPDATE`, checks currently active participant membership inside the same transaction, rechecks trusted authorization, and inserts message, increments revision and adds MESSAGE_POSTED audit evidence. Client retries scoped by tenant/thread/actor/request ID replay the original message without duplicate audit; conflicting bodies fail closed.
- **PARTICIPANTS**: takes the same thread lock, checks membership and creator identity, demands a matching expected revision, marks withdrawn users revoked, upserts current participants and inserts a PARTICIPANTS_CHANGED audit row together with the revision increase. The shared lock is intended to serialize participant revocation and message commits on one PostgreSQL primary across app servers.

The implementation requires `transact` to *roll back all SQL changes whenever the callback throws*, pin the actor and tenant to its database transaction, and provide a database identity without access through a privilege bypass. It does not accept caller-supplied authorization outcomes. The `authorize` callback must validate actual active tenant, actor, matter security-zone and membership entitlements, and every requested recipient against the live directory. A permissive callback is **not production safe**.

## Outstanding gates

The new tests use a SQL spy, not a real PostgreSQL writer login. No SQL writes can run via the existing runtime identity because restrictive-deny RLS and absent table grants remain unchanged. Before any grant or production use, add a purpose-specific role with narrowly reviewed RLS policies and live session/recipient validation, then run adversarial PostgreSQL integration tests using two independent servers, with races, transaction rollback, request collisions, revoked/disabled actors, foreign tenants, and durable retry under process restart.

No real client records, attachments or notifications. D-018, V131 and partner TO governance remain unchanged.
