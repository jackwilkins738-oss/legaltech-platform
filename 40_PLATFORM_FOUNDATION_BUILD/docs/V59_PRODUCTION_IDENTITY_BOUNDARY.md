# V59 — Production identity boundary

## Scope
V59 closes the previously injected-only production identity gap without enabling real customer access. It adds cryptographic OIDC/JWT verification primitives, trusted identity resolution, opaque server-side sessions and browser session protections while preserving all V58 tenant, matter, document and writeback controls.

## Implemented
- RS256 JWT verification against a bounded HTTPS JWKS endpoint.
- Exact issuer/audience validation, expiry/not-before/issued-at checks and allowed Entra directory-tenant policy.
- Algorithm-confusion and attacker-controlled `jku`/JWK rejection.
- JWKS size/key-count limits, same-origin issuer/JWKS requirement, redirect refusal and bounded key caching.
- External OIDC identity is resolved to internal tenant/actor/roles/capabilities through a trusted application resolver. Token-supplied application privileges are ignored.
- MFA/auth-time evidence is retained as authentication context and can be required as a recent step-up.
- Opaque 256-bit server-side sessions with absolute lifetime, idle lifetime, explicit revocation and provider-session revocation.
- Browser sessions use a `__Host-` cookie with `HttpOnly`, `Secure`, `SameSite=Strict`, host-only semantics and no bearer token in browser-readable storage.
- Cookie-authenticated unsafe requests require the exact configured HTTPS origin and reject cross-site Fetch Metadata when present.
- Session exchange and logout endpoints are supported by the HTTP boundary when the identity session service is explicitly configured.
- Production environment validation now requires JWKS URI, directory-tenant allowlist, HTTPS public origin and bounded session TTLs.

## Deliberately not claimed
- No real Entra tenant has been connected.
- The in-memory session store is a reference/test implementation only; production still requires a managed session store.
- Real Conditional Access/MFA policy, Continuous Access Evaluation and tenant offboarding/revocation remain external validation items.
- No real client data or production credentials are introduced.

## Security invariants
1. A syntactically valid JWT is not authentication: signature, issuer, audience, lifetime and directory tenant must all verify.
2. OIDC claims never directly grant LegalTech application capabilities or internal tenant identity.
3. Normal browser API use can operate with an opaque server session rather than exposing provider bearer tokens to application JavaScript.
4. Revoked/expired/idle sessions fail closed.
5. MFA/step-up is evidence, not a capability string.
