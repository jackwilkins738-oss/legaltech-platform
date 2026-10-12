# V207 — Database admission acceptance contract

The V204–V206 conversation schema is **deliberately inaccessible**, even to the restricted runtime login. V207 adds executable PostgreSQL CI assertions that the real runtime login cannot SELECT, INSERT, UPDATE, DELETE or TRUNCATE any of the four tables and cannot use the conversation audit identity sequence. Those tests also execute SQL with the runtime connection to prove actual privilege-denied behaviour (SQLSTATE 42501), rather than trusting SQL text alone.

## Minimum future integration design

Future access requires a separate narrow-purpose role rather than granting the shared runtime account direct table access. Actor identity and tenant must be derived from a verified server-side session; no client-supplied actor, tenant or participant claims. Enforce active actor and matter permissions and tenant-bound recipient identity within every transaction.

Creation must insert thread, creator membership and a CREATED audit row atomically. Posting must lock and recheck current participant membership, tenant and matter access; store the message, idempotency receipt, thread revision and MESSAGE_POSTED audit in one transaction. Participant updates must take the **same lock** as message posting, reject stale revisions and atomically update membership with PARTICIPANTS_CHANGED audit. For two-server revocation races, test one writer blocked by a pending revocation and prove no message becomes visible after revocation commits. Cross-tenant, disabled actor and zone-denied reads/writes must be indistinguishable from nonexistent resources.

Never weaken the restrictive false policies or grant application access ahead of satisfying this contract. An intentional activation migration requires fresh adversarial integration tests, approval of retention/legal hold and encryption requirements, and an explicit production gate review. D-018, V131, partner TO and synthetic-only restrictions continue.
