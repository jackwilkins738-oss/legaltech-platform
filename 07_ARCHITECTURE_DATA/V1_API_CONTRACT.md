# V1 PUBLIC / INTERNAL API CONTRACT

## Principles
- REST/JSON
- predictable resources
- versioned
- authenticated
- tenant-scoped
- idempotent writes where meaningful
- machine-readable errors
- explicit permissions
- audit-generating

## Base
/api/v1

## Core resources

### GET /matters/{matter_id}
Returns authorised canonical matter.

### GET /matters
Filters:
- external_reference
- client
- status
- stage

### GET /matters/{matter_id}/communications

### GET /matters/{matter_id}/documents

### GET /matters/{matter_id}/tasks

### GET /matters/{matter_id}/exceptions

### POST /inbound-events
Internal/integration-only event ingress.

### POST /communications/{id}/match
Confirm/reject matter match.

### POST /communications/{id}/classify
Confirm/override classification.

### POST /actions/{id}/approve

### POST /actions/{id}/reject

### POST /tasks

### POST /documents

### POST /deadlines/{id}/confirm

## Idempotency
For externally triggered writes:
Idempotency-Key header mandatory.

Server stores:
- tenant
- key
- request hash
- result
- expiry

Same key + different payload:
409 conflict.

## Error format
{
  "error": {
    "code": "MATTER_ACCESS_DENIED",
    "message": "Access denied",
    "request_id": "...",
    "details": {}
  }
}

Do not leak existence of restricted resources through error differences where that creates confidentiality risk.

## Pagination
Cursor-based:
?limit=50&cursor=...

## Authorization
Every endpoint defines:
- required role/capability
- tenant rule
- matter rule
- security-zone rule
- side-effect classification

## API audit
Sensitive calls create audit event:
- actor
- endpoint/action
- resource
- result
- trace
