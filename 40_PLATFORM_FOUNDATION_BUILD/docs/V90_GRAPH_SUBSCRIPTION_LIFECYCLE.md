# V90 — Microsoft Graph subscription lifecycle and durable registry

V90 provides the server-owned subscription state used by the V89 webhook authenticity boundary. It is deliberately separate from the synthetic Graph harness.

## Boundary

- Subscription resources/change types and callback URLs come from server configuration, not webhook payloads.
- `clientState` is generated server-side and stored only through a managed secret reference; snapshots/events never expose the value or reference.
- Webhook resolution returns a clientState only after an ACTIVE, unexpired exact subscription lookup and managed-secret hash verification.
- A `missed` lifecycle event moves the subscription to `RECOVERY_REQUIRED`; webhook resolution fails closed until separate recovery evidence is recorded.
- `subscriptionRemoved` moves the old subscription out of service and permits a linked replacement.
- `reauthorizationRequired` can be resolved by reauthorization or renewal; renew and reauthorize operations are guarded from rapid collision.
- Returned Microsoft Graph subscription identity/expiration are validated before local publication.
- Renewal scans are bounded and expose no secret material.

Microsoft Graph requires subscriptions to be renewed before expiry and defines `missed`, `subscriptionRemoved`, and `reauthorizationRequired` lifecycle notifications. Microsoft also warns against sending reauthorize and update/renew requests for the same subscription within a 10-minute window; V90 encodes that guard as a configurable production minimum of 600 seconds.

## Production shape

Migration `027_graph_subscription_lifecycle.sql` adds:

- tenant-bound Graph subscription registry metadata;
- a unique live subscription per tenant/resource hash;
- managed clientState secret references plus verification hashes, never clientState bytes;
- immutable subscription identity and monotonic generation guards;
- append-only lifecycle events;
- forced RLS on registry and event tables.

Production requires:

- `GRAPH_SUBSCRIPTION_REGISTRY_MODE=durable-server-owned`
- `GRAPH_SUBSCRIPTION_SECRET_MODE=managed-reference`
- `GRAPH_SUBSCRIPTION_LIFECYCLE_MODE=renew-reauth-recovery`
- `GRAPH_SUBSCRIPTION_MUTATION_GUARD_SECONDS>=600`

Real-client-data readiness additionally requires `GRAPH_SUBSCRIPTION_LIFECYCLE_VALIDATION_STATUS=PASS`.

## Deliberate non-claims

V90 does not claim a live Microsoft Graph subscription API client, automatic renewal scheduler, managed secret provider, durable application repository implementation, or completed delta-recovery implementation. The in-memory lifecycle class is a reference boundary for those production adapters.
