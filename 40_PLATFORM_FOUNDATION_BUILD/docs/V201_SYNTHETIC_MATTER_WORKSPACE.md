# V201 synthetic matter workspace reference

V201 introduces a read-only synthetic matter workspace with tenant-scoped lookup, visibility/membership/zone checks, bounded matter lists, and immutable detached results. Only trusted server session objects are accepted; this module is **not** an authentication boundary.

## Intentional non-features
- No production HTTP route, write access, matter creation, or Proclaim mutation.
- No work queue or inbound-event details/counts. They require their respective authorisers.
- No assertion that this is a live connected matter-management subsystem.

## Further production integration gates
A production design requires a durable PostgreSQL matter read adapter with row-level security and positive/negative actor tests, authenticated current-session checks, scope-controlled API routes and release readiness. This reference is suitable for synthetic tests and later design review only. All D-018, V131, pre-TO, and no-customer-data restrictions remain unchanged.
