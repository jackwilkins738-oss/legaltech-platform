# API security boundary

## Status
Current synthetic/local implementation. Production auth remains blocked until an authorised identity design is selected and tested.

## Rules implemented
- tenant identity comes from the authenticated server-side session;
- client-supplied `tenantId` may never switch tenant context;
- missing, restricted and capability-denied tenant objects return the same safe `404 NOT_FOUND` shape where appropriate;
- mutations that can replay require `Idempotency-Key`;
- request JSON is size bounded;
- errors use a machine-readable code plus trace ID;
- development worker controls are disabled unless the server is explicitly created with `devWorkers: true`;
- the bundled local development server refuses to boot under `NODE_ENV=production`.

## Still not production proof
- StaticAuthProvider is a deterministic test/dev adapter, not production authentication.
- No OIDC/SAML/Entra token validation exists yet.
- SQLite is the behavioural reference store, not the production canonical store.
- No production rate limiting, WAF, distributed tracing or managed secrets are wired yet.
