# OBSERVABILITY STANDARD

## Every request/job carries
- trace_id;
- tenant_id (where safe); 
- actor/system;
- integration;
- job/event ID.

## Logs
Structured.
Do not log raw legal document/email body by default.
Redact tokens/secrets/credentials.

## Metrics
Application:
- request rate/error/latency;
- queue depth/age;
- worker failure;
- DB health.

Product:
- events processed;
- review rate;
- correction rate;
- auto-action rate;
- writeback success;
- exception age.

Integration:
- Graph webhook/delta health;
- subscription expiry;
- Proclaim latency/errors;
- AI/OCR latency/cost/errors.

## Alerts
SEV1:
- possible cross-tenant;
- credential compromise;
- mass export;
- audit failure/data integrity.

SEV2:
- connector outage;
- queue backlog;
- auth outage;
- malware scan unavailable;
- backup failure.
