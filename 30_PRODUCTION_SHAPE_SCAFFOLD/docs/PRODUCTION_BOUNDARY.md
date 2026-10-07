# Production Boundary

## Intended production shape
Client/browser → API → authorization → domain service → Postgres/private object store/queue → integration workers.

### Request context
Every authenticated request must resolve:
- tenant_id;
- user_id/service_principal_id;
- capabilities;
- security zones/matter restrictions when applicable;
- trace_id.

### Database isolation
Application authorization remains mandatory even when RLS exists. RLS is defence in depth, not a substitute for application policy.

The API sets transaction-local PostgreSQL settings:
- `app.tenant_id`
- `app.actor_id`

RLS policies compare row `tenant_id` with `current_setting('app.tenant_id', true)`.

### Production user
Production runtime must not use a database owner/superuser role capable of silently bypassing RLS.

### Workers
Workers receive tenant-bound job payloads. The tenant context is fixed when the job is created and cannot be replaced by model/user-supplied content.

### Content
Raw legal content does not go into general logs/metrics. Logs use identifiers, classifications, counts, durations and controlled error codes.
