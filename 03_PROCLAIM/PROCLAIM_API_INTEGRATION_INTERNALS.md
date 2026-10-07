# PROCLAIM API & INTEGRATION INTERNALS

## Evidence status
Official API documentation was not publicly available in the sources retrieved.
The details below combine:
- official Access product/support material where available
- recent Proclaim user-forum implementation evidence

Forum evidence must be labelled USER REPORT / TECHNICAL COMMUNITY EVIDENCE, not official specification.

## Observed integration patterns
### REST services
Recent forum posts show REST services actively used in 2025–2026.

Observed characteristics:
- JSON templates
- field data types
- dynamic URI values may be assembled inside Proclaim-side code
- base64 handling for embedded documents
- configuration testing via Proclaim tools
- document import/export can depend on embedded document fields and template setup

### SOAP
SOAP remains in use for legacy integrations.
Forum users reference:
- proPostEmail
- document import
- ProclaimCaseService
- v3.5 endpoint changes

### Email ingestion
2026 user discussion reports an endpoint equivalent to SOAP proPostEmail:
POST /ProclaimCaseService/Actions/Email/:CaseNo

A forum contributor reports .msg ingestion with attachments and metadata into history.

This must be verified against actual customer API documentation before architecture is committed.

## Integration risks to validate
1. What API licence/module is required?
2. Which endpoints are officially supported?
3. Read vs write coverage?
4. Create tasks?
5. update fields?
6. create history items?
7. import email?
8. import documents?
9. retrieve document binary?
10. workflow triggers?
11. webhooks/events?
12. rate limits?
13. authentication?
14. tenant/customer-hosting differences?
15. version compatibility?
16. sandbox/test environment?
17. support status for API-driven automation?
18. future compatibility with CaseMatters Evo?

## Product requirement generated from competitor weakness
Our public API must include:
- OpenAPI 3.x spec
- OAuth/OIDC
- service principals
- fine-grained scopes
- per-tenant API credentials
- stable resource identifiers
- cursor pagination
- idempotency keys
- webhooks
- signed webhooks
- replay protection
- audit events
- API version policy
- deprecation windows
- sandbox
- seeded test tenants
- SDK examples
- bulk import/export
- async job APIs
- error codes with machine-readable remediation

## Sources
https://proclaimforum.co.uk/viewtopic.php?p=4543
https://www.proclaimforum.co.uk/viewtopic.php?t=1231
https://www.proclaimforum.co.uk/viewtopic.php?t=1054
https://proclaimforum.co.uk/viewtopic.php?t=1296
https://www.proclaimforum.co.uk/viewtopic.php?p=3650
