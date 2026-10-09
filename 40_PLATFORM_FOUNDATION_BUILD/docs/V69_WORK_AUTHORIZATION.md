# V69 — Matter-aware work authorization

V69 adds an authorization boundary around the generic V64–V68 work primitives before they are exposed through a user-facing API or UI.

## Boundary

- Every work read/mutation is tenant-bound and, when matter-linked, must also pass the existing matter visibility/security-zone/break-glass checks.
- `work:read:self` covers a trusted USER owner, a ROLE owner present in the server-owned session roles, or the original requester for read-only visibility.
- `work:update:self` and `work:respond:self` apply only to the current trusted owner, not merely the requester.
- TEAM and POOL ownership never creates implicit self-access because team membership is not currently present in the trusted session contract.
- Creating work requires `work:create`; assigning it to another user, an untrusted role, a team or a pool additionally requires `work:assign`.
- Broad `*:any` work capabilities do not bypass restricted matter authorization.
- Flow intelligence has a separate `work:flow:read` capability.
- Response/escalation policy administration has a separate `work:policy:manage` capability and requires recent MFA/step-up by default.
- Unauthorized resource access returns the same safe 404 shape used by the existing matter boundary.

## Security concepts

This release explicitly tests **matter-bound work authorization**, **team ownership not inferred**, **work self mutation**, and **work policy step-up**.

## Deliberately not included

V69 does not define firm roles, team membership, supervisor hierarchy, Co-op routing, API endpoints or user interface behavior. A future trusted directory/team-membership source can extend TEAM/POOL self-access without weakening this boundary.
