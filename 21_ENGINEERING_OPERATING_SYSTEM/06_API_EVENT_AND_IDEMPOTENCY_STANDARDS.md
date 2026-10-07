# API, EVENT & IDEMPOTENCY STANDARDS

## API
Prefix: `/api/v1`.

Every mutation supports an idempotency mechanism when duplication is plausible.

Error envelope:
```json
{
  "code": "MACHINE_READABLE_CODE",
  "message": "safe human-readable message",
  "trace_id": "..."
}
```

Do not reveal existence of restricted objects through 403/404 differences unless policy explicitly allows it.

## Event envelope
Required fields:
- event_id;
- event_type;
- version;
- occurred_at;
- tenant_id;
- actor/source;
- correlation_id;
- causation_id;
- payload.

## External event dedupe
Store external source ID + tenant + connector.

## External write states
- PENDING
- ATTEMPTING
- SUCCEEDED
- FAILED_KNOWN
- OUTCOME_UNKNOWN
- RECONCILING
- RECONCILED

`OUTCOME_UNKNOWN` must never auto-retry without reconciliation logic.

## Schema evolution
Events are versioned.
Consumers must tolerate additive fields.
Breaking changes require new event version.
