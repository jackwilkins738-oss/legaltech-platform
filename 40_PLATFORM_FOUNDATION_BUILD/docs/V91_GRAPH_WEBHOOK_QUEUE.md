# V91 — Durable Microsoft Graph webhook queue and validation worker

V91 closes the gap between public callback acknowledgement and the V89 authenticity boundary. The reference queue is intentionally ephemeral/in-memory; production is required to substitute an isolated managed queue.

## Boundary

- Receipt validates only bounded shape/size, stages an isolated payload, and returns `202`.
- Validation and trusted dispatch happen in a worker, never on the acknowledgement path.
- Processing claims are lease-recoverable and retry attempts are bounded.
- Invalid authenticity/shape is terminal; dependency outages and downstream dispatch failures can retry.
- A retry after successful validation is allowed to present the same notification fingerprint again to an idempotent downstream consumer. This prevents a transient dispatch failure from turning V89 replay suppression into notification loss.
- Network replay is still harmless: the idempotent dispatcher executes the business handler once per fingerprint.
- Terminal queue items remove raw payload content. Public job/event views contain only IDs, hashes, timestamps, counts and bounded error codes.
- V89 now permits explicitly identified verifier/managed-secret dependency outages to surface as retryable queue failures while continuing to collapse unknown resolver failures to invalid notification state.

## Production requirements

- `GRAPH_WEBHOOK_QUEUE_MODE=managed-isolated`
- `GRAPH_WEBHOOK_WORKER_MODE=workload-identity`
- `GRAPH_WEBHOOK_PAYLOAD_RETENTION_MODE=ephemeral`
- `GRAPH_WEBHOOK_DISPATCH_MODE=idempotent-fingerprint`

Real-client-data readiness additionally requires `GRAPH_WEBHOOK_QUEUE_VALIDATION_STATUS=PASS`.

## Deliberate non-claims

V91 does not claim a deployed queue provider, cloud worker, dead-letter service, live Graph endpoint, or production downstream dispatcher. Raw webhook bodies are deliberately not added to the application database schema.
