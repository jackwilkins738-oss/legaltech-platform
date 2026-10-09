# V92 — Graph delta recovery and opaque checkpoint safety

V92 closes the recovery gap after a Microsoft Graph subscription enters `RECOVERY_REQUIRED` following a missed-notification lifecycle event.

## Boundary

- Recovery consumes only Microsoft Graph `https://graph.microsoft.com/v1.0/...` delta URLs.
- `@odata.nextLink` and `@odata.deltaLink` are treated as opaque values and are never modified by the platform.
- A run is bounded by page and per-page item limits and can pause/resume without an unbounded loop.
- Downstream change dispatch must be idempotent because a failed page may be fetched again.
- A terminal delta link is stored only through a managed secret reference; application persistence keeps only hashes/generation metadata.
- Subscription reactivation is impossible until the terminal delta checkpoint has been durably secured.
- Checkpoint generations are append-only and tenant/resource-bound in production shape.

## Explicit non-claims

This reference boundary does not claim a live Microsoft Graph credential, live managed secret store, deployed delta worker, scheduler, or completed production recovery drill. Those remain external deployment/evidence requirements.
