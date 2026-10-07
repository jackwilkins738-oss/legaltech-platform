# Observability Contract

## Logs
Required common fields:
- timestamp
- level
- service
- environment
- trace_id
- tenant_id (pseudonymous/internal ID)
- actor_id where relevant
- event/job ID
- operation
- outcome
- error_code
- duration_ms

## Never log by default
- email/document bodies;
- medical details;
- client names;
- access/refresh tokens;
- passwords/secrets;
- full signed storage URLs.

## Metrics
- inbound events/minute;
- queue depth/age;
- worker success/retry/dead-letter;
- Proclaim/Graph latency and error category;
- review/correction rates;
- model/OCR latency, tokens/pages and cost;
- no content labels derived from sensitive text unless approved.
