# V100 outbound egress / SSRF containment

V100 creates a server-owned outbound destination policy for connector and integration HTTP calls.

- HTTPS only; no URL credentials or fragments.
- Purpose-scoped exact origin/path allowlists.
- Public destinations fail closed if DNS returns any local/private/link-local/metadata address.
- Approved private services require an explicit exact resolved-address allowlist.
- The connection plan pins the resolved address while retaining the original host for Host/SNI/certificate verification.
- Redirect following is disabled and redirect responses are rejected.
- DNS failures and mixed public/private answers fail closed.

This is an application-layer reference boundary; production network/firewall egress controls remain required defense in depth.
