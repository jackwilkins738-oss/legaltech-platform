# V81 controlled data-export and download containment

V81 adds a workflow-agnostic data-egress boundary for future reporting/export features without creating a public-download or arbitrary external-delivery channel.

## Boundary

- Every requested resource must be authorized by a server-owned authorizer before export state exists.
- Export requests accept only tenant, actor, trace, a bounded resource set, format and idempotency key. Browser-supplied destinations, email addresses and public URLs are outside the contract.
- Export manifests are SHA-256 pinned and idempotent. A changed replay fails closed.
- A package can become `READY` only when its manifest hash matches, its SHA-256/size are bounded and an injected managed-storage validator confirms the internal storage reference.
- Package bytes remain outside the registry. The registry stores only bounded package/storage evidence.
- Download grants are cryptographically random, actor+tenant+export bound, expire within 15 minutes and are single-use. Only the token hash is retained; raw tokens are returned once and are absent from events.
- Revoking an export invalidates active grants.
- Export activity is treated as privileged monitoring activity.

## Production-shaped controls

Migration `018_controlled_export.sql` adds tenant/RLS-bound export, resource, download-grant and append-only event records. Resource identity is immutable. Grant identity is immutable and can move only from `ACTIVE` to `CONSUMED` or `REVOKED`.

Production configuration requires controlled internal export, isolated managed export storage, actor-bound single-use grants, disabled public links and disabled arbitrary external delivery. Real-client-data mode additionally requires reviewed export security and storage evidence.

## Deliberate non-claims

V81 does not add a final export UI, PDF/CSV renderer, public link, outbound email delivery, production object-store implementation or customer export policy. Exact export use cases remain post-TO/product decisions.
