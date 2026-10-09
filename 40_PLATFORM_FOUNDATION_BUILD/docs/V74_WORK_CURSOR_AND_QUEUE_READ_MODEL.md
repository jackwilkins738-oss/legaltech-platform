# V74 — Opaque work pagination and queue read-model hardening

V74 hardens the generic work API pagination boundary before any final operator queue UI is built.

## Boundary

- Numeric work offsets are no longer accepted at the HTTP/API boundary.
- `WorkCursorCodec` encrypts and authenticates cursor state with AES-256-GCM; the underlying scan offset is not exposed to the client. This is the **opaque work cursor** boundary.
- Every cursor is bound to the authenticated tenant and therefore cannot be replayed into another tenant. This is the **work cursor tenant binding** boundary.
- Every cursor is bound to normalized owner/state/type/matter filters; changing filter semantics invalidates the cursor while ordering equivalent state/type sets remains valid. This is the **work cursor filter binding** boundary.
- Cursors expire after a bounded lifetime and reject tampering, malformed tokens and weak key material.
- Authorization scans remain capped to 1,000 underlying rows per API request. If all scanned rows are unreadable, continuation state is returned only as an opaque token rather than an observable numeric hidden-record count.
- Pagination now advances only over rows actually consumed before the visible response limit is reached, preventing the previous whole-page skip behavior.
- Production-shaped indexes cover USER, ROLE/TEAM/POOL, state/type and matter queue access patterns. This is the **work queue read model** boundary.

## Deployment note

The synthetic service may use an ephemeral process cursor key. A multi-instance or restart-stable production deployment must inject the same managed 32-byte cursor key into each API instance; no key is stored in this repository.

## Deliberately not included

No Co-op-specific queue, final admin/case-manager dashboard, workload algorithm, SLA, escalation route or UI sorting preference is defined. Queue semantics remain post-TO configuration.
