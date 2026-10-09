# V70 — Bounded work API

V70 exposes the generic V64 work model through an authenticated HTTP contract that is always mediated by the V69 authorizer.

## Routes

- `GET /api/v1/work`
- `POST /api/v1/work`
- `GET /api/v1/work/:id`
- `GET /api/v1/work/:id/events`
- `POST /api/v1/work/:id/state`
- `POST /api/v1/work/:id/respond`
- `POST /api/v1/work/:id/assign`

## Security boundary

- Tenant, requester, actor and trace identity are server owned.
- Client attempts to supply actor/requester/trace fields are rejected.
- Matter authorization is re-applied through V69 for reads and mutations.
- Unauthorized resources retain safe 404 behavior.
- Creation is idempotent and assignment authority is separately enforced.
- Queue limits/cursors/filter collections are bounded; broad queue reads are filtered by the same matter/self rules as object reads.
- Stale optimistic versions are surfaced as bounded 409 conflicts.
- Domain implementation errors are not reflected to HTTP clients.

Security regression concepts: **server-owned work identity**, **work api safe 404**, **bounded work pagination**, **work api authorization**.

## Scope

This is an API foundation, not a final legal-admin/case-manager interface. No firm-specific queue, task family, SLA, escalation ladder, workflow or UI is defined by V70.
