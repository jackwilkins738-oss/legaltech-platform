# V89 — Microsoft Graph webhook ingress authenticity and replay containment

V89 separates public webhook receipt from trusted workflow dispatch. A callback can be acknowledged quickly without becoming a trusted tenant event; validation occurs against server-owned subscription state before any normalized notification is dispatchable.

## Boundary

For basic Graph change notifications, V89 requires:

- a known ACTIVE, unexpired server-side subscription;
- exact subscription-ID binding;
- constant-time `clientState` comparison against the secret originally associated with that subscription;
- payload directory-tenant equality with the directory tenant stored on the subscription;
- bounded batch/body/resource fields;
- valid change-vs-lifecycle semantics;
- durable notification fingerprinting before dispatch.

Internal tenant identity comes only from the stored subscription mapping, never from the notification payload.

For rich notifications, V89 additionally requires an injected trusted validation-token verifier. Verified claims must bind the directory tenant and application ID and identify the Microsoft Graph change-notification publisher. The reference boundary does not implement JWT signature verification itself.

Endpoint-validation tokens are treated as opaque and returned only as `text/plain`, matching the Microsoft Graph endpoint-validation contract.

## Production shape

Migration `026_graph_webhook_ingress.sql` stores only tenant-bound hashes/fingerprints and append-only validation evidence. It does not persist clientState values, validation JWTs, resource data or raw webhook payloads. A unique tenant+notification fingerprint supports durable replay suppression.

Production requires:

- `GRAPH_WEBHOOK_INGRESS_MODE=queued-validate-before-dispatch`
- `GRAPH_WEBHOOK_BASIC_AUTH_MODE=subscription-client-state`
- `GRAPH_WEBHOOK_RICH_TOKEN_MODE=verified`
- `GRAPH_WEBHOOK_REPLAY_MODE=durable-fingerprint`
- `GRAPH_WEBHOOK_TENANT_MODE=server-subscription`
- `GRAPH_WEBHOOK_VALIDATION_RESPONSE_MODE=opaque-plain-text`

Real-client-data readiness additionally requires `GRAPH_WEBHOOK_VALIDATION_STATUS=PASS`.

## Deliberate non-claims

V89 does not claim a live Microsoft Graph webhook endpoint, live JWT/JWKS verification, a managed ingress queue, or a production subscription registry. The in-memory staging/dedupe structures are reference/test infrastructure only.
