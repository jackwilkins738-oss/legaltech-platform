# Event Catalog

## Principles
- Every event is tenant-bound.
- Every external event carries a stable external ID.
- Processing is idempotent.
- Raw legal content is referenced, not copied into logs.
- Events are append-oriented; corrections create new events rather than rewriting history.

## Core event envelope
Fields:
- `event_id`
- `tenant_id`
- `event_type`
- `event_version`
- `occurred_at`
- `received_at`
- `source_system`
- `source_id`
- `correlation_id`
- `causation_id`
- `actor_type`
- `actor_id`
- `matter_id` nullable
- `payload_ref` or structured payload
- `classification`
- `trace_id`

## Initial events
- `graph.message.received.v1`
- `document.quarantined.v1`
- `document.safe.v1`
- `matter.match.proposed.v1`
- `matter.match.confirmed.v1`
- `classification.proposed.v1`
- `automation.decision.created.v1`
- `exception.created.v1`
- `exception.resolved.v1`
- `proclaim.writeback.requested.v1`
- `proclaim.writeback.succeeded.v1`
- `proclaim.writeback.failed.v1`
- `audit.material_action.v1`

## Versioning
Breaking payload change => new event version.
Consumers must declare supported versions.
Do not silently repurpose fields.
