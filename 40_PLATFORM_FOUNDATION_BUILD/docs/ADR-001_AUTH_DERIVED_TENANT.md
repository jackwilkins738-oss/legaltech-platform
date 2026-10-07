# ADR-001 — Tenant context is derived from authenticated session

**Status:** ACCEPTED for all API designs.

## Decision
Normal API requests derive `tenant_id` from authenticated server-side identity/session context. Request bodies and query strings are never authoritative for tenant selection.

If an API payload contains a tenant identifier for compatibility or diagnostics, it must match the authenticated tenant or the request is rejected without revealing whether the supplied tenant exists.

## Why
Allowing clients to select tenant context creates a direct BOLA/IDOR risk and makes authorization easier to bypass accidentally.

## Consequences
- adapter/service code receives an already-authorized tenant context;
- cross-tenant administrative operations, if ever needed, must use a separate explicitly privileged control plane;
- OpenAPI contracts should not require normal callers to send tenant IDs for tenant-owned commands.
