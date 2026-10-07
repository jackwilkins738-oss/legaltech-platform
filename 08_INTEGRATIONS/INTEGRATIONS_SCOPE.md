# INTEGRATIONS SCOPE

## Priority 1
- Proclaim
- Microsoft 365 / Graph
- Entra ID / SSO

## Priority 2
- e-signature
- AML/KYC
- accounting
- payments
- telephony/SMS
- document generation
- BI

## Every connector must define
- auth method
- OAuth scopes
- customer consent
- tenant boundaries
- read permissions
- write permissions
- webhooks
- webhook signing
- replay protection
- polling fallback
- retries
- idempotency
- rate limits
- data mapping
- data retention
- failure mode
- reconciliation
- monitoring
- customer-visible status

## Microsoft strategy
Prefer Graph/API architecture over desktop automation.

## Proclaim strategy
Before product commitment establish:
- APIs available to target firms
- licensing/permission implications
- supported write operations
- event/webhook capability
- document/email insertion
- task creation
- field update
- export
- throttling
- sandbox/test availability
