# V36 Integration Readiness Harness

Status: synthetic / pre-authorisation engineering only.

Adds production-shaped connector lifecycle and validation tooling without claiming live customer integration.

## Microsoft Graph
- separate capability model for read/write/send
- mailbox allow-list metadata
- subscription create/renew/lifecycle state
- delta checkpoint state
- connector health snapshot
- no browser tokens or real Graph secrets

## Proclaim
- explicit capability discovery record
- Green/Amber/Red validation harness
- read-history synthetic probe
- idempotency and write/read reconciliation contract checks
- live API version and permission checks remain BLOCKED until authorised customer access

## Authentication
`VerifiedOidcClaimsMapper` accepts only an already verified server-side claims object. It does not verify JWT signatures itself and cannot be fed a browser-selected tenant ID.

## Hard boundary
No real mailbox, Proclaim endpoint, OAuth token, client data or customer credentials are used by this build.
