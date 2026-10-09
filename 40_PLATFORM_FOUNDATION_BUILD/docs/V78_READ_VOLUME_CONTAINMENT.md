# V78 — Authenticated read-volume containment

V78 adds a hard egress budget alongside V62 monitoring so a valid account cannot rely on individually authorized list requests to extract an unbounded volume of matter/work data.

## Actor-scoped record and matter budgets

`InMemoryAbuseLimiter.checkRead` tracks authorized visible record volume for a `(tenant, actor)` across protected read endpoints and separately tracks distinct matter identifiers during the same bounded window. Splitting reads across work, matters, audit or exception endpoints therefore does not create a fresh budget. Tenant and actor budgets remain isolated. This is the **authenticated read volume limit** and **distinct matter read budget** boundary.

The reference in-memory implementation uses deliberately high generic safety ceilings and exists for test/development shape. Production configuration requires `READ_VOLUME_LIMIT_MODE=managed` so horizontally scaled instances cannot each grant an independent extraction budget. Exact operational thresholds remain deployment/security policy, not a TO workflow assumption.

## Before-egress enforcement

For protected authenticated reads, visible objects are first authorization-filtered, then security monitoring observes the attempted read, then the read-volume limiter must accept the response before JSON is sent. A denied request returns the bounded `READ_VOLUME_LIMITED` error and no `items` payload. A failed attempt does not partially consume a new budget state. This is the **read egress fails closed** boundary.

Work queue/list reads and work-event history are now included in the same security-monitoring/read-budget path as matters, inbound events, exceptions, audit and security alerts. This closes the **work queue read monitoring** gap introduced by the newer orchestration API.

## Deliberately not included

V78 does not set role-specific browsing quotas, business productivity targets, export entitlements or Co-op-specific thresholds. It does not replace authorization, RLS, monitoring or managed production rate limiting; it provides an additional defense against high-volume use of otherwise legitimate reads.
