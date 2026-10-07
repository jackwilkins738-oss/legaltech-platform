# Authentication / Session Model

## Phase 1
Abstract authentication provider behind a `SessionResolver`.

Expected production enterprise providers:
- Microsoft Entra ID / OIDC;
- SAML where required through a compatible identity layer;
- SCIM later for lifecycle automation.

## Session output
```text
actor_id
actor_type USER | SERVICE
organisation_id
active_tenant_id
capabilities[]
security_zone_ids[]
auth_time
mfa_context
session_id
```

## Non-negotiables
- tenant selection is server validated;
- object tenant IDs are never trusted from browser input;
- deactivated user cannot refresh access;
- service principals have narrower capabilities than human admins;
- support access is time-bound and separately audited;
- break-glass is explicit, justified, monitored and reviewed.
