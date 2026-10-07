# PRODUCTION ARCHITECTURE V1

## Guiding principles
- zero trust
- browser-first
- tenant-aware everywhere
- event-driven ingestion
- least privilege
- no AI direct database access
- observable
- recoverable
- portable

## Request path
User
→ CDN/WAF/DDoS controls
→ application
→ identity/authentication
→ policy/authorisation
→ domain service
→ data store

Every request:
- authenticated where appropriate
- authorised
- tenant scoped
- logged
- traceable

## Identity
Enterprise:
- Entra ID / SAML / OIDC
- SCIM
- MFA
- passkeys/phishing-resistant options
- short-lived sessions
- conditional/context access where available

NCSC 2026 zero-trust guidance supports:
- unique user/service/device identities
- MFA
- policy-based authorisation
- short-lived tokens
- continuous re-evaluation
- central monitoring

## Services
Start modular monolith unless scale clearly requires microservices.
Logical domains:
- tenancy
- identity mapping
- matters
- contacts
- documents
- communications
- tasks
- workflows
- integration
- AI orchestration
- reporting
- audit

## Data
### Postgres
canonical transactional data

### Object store
private legal documents

### Search
permission-filtered search

### Queue
inbound email/docs, OCR, AI, workflow jobs

### Audit
append-oriented security and business events

## AI gateway
All AI calls go through one controlled service:
- provider routing
- redaction/policy
- tenant context
- prompt templates
- tool permissions
- audit
- cost
- evaluation
- human-approval enforcement

## Integration gateway
Microsoft / Proclaim / external APIs:
- token vault
- per-tenant credentials
- retries
- DLQ
- webhooks
- reconciliation

## NCSC alignment
Architecture should assume:
- network is hostile
- no inherent internal trust
- explicit authorisation everywhere
- service identities
- least privilege
- limit lateral movement
- minimise blast radius
- central security logs

## Sources
https://www.ncsc.gov.uk/collection/zero-trust/architecture-design-principles
https://www.ncsc.gov.uk/collection/zero-trust/zero-trust-network-access-ztna/introduction-to-ztna
https://www.ncsc.gov.uk/collection/cloud/using-cloud-services-securely/using-saas-securely
