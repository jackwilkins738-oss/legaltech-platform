# V71 — Trusted organisation membership

V71 adds a generic, tenant-bound TEAM/POOL membership directory so shared work queues can be authorized from server-owned organisational evidence rather than a browser-supplied group name.

## Boundary

- TEAM and POOL groups are registered per tenant and have immutable identity.
- Memberships are actor-bound, time-aware and cannot overlap for the same actor/group window.
- Membership grant/revoke and group register/retire operations produce append-only directory events and audit evidence.
- Retired groups, revoked memberships, expired windows, future windows and directory failures all deny group-derived work access.
- V69 can consume the directory as an optional trusted membership resolver. Without it, TEAM/POOL self access remains denied exactly as before.
- Active trusted membership permits the same bounded `work:*:self` semantics already available to exact USER/ROLE owners; matter authorization still applies independently.
- Group membership is never inferred from a client-supplied group id.

Security regression concepts: **trusted group membership**, **directory event append-only**, **membership fail closed**, **group membership tenant binding**.

## Deliberately not included

No Co-op team names, reporting hierarchy, supervisor authority, case-manager relationship, load-balancing rule or routing policy is installed. Those can be configured only after real organisation data and TO findings are known.
