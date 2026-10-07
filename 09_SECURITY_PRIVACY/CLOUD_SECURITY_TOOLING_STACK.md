# CLOUD & SECURITY TOOLING STACK

## Philosophy
Buy commodity security capabilities.
Build only controls specific to our product/tenant/legal workflows.

## Cloud
Early options:
- Vercel frontend/application
- Supabase/Postgres
but architecture must remain portable.

For enterprise scale consider:
- major cloud account under company control
- UK region
- private networking
- KMS
- managed Postgres
- object storage
- queue
- WAF
- audit logs

## Identity
Customer:
- Entra / OIDC / SAML
- SCIM

Internal:
- company IdP
- phishing-resistant MFA
- hardware/passkeys
- separate privileged accounts

## Secrets
Use:
- cloud secrets manager / managed vault
Never:
- .env committed
- secrets in Claude/chat
- shared founder passwords

## Developer security
- GitHub org
- branch protections
- signed/verified accounts where useful
- Dependabot/renovation
- secret scanning
- SAST
- dependency scan

## Endpoint
- MDM
- EDR
- disk encryption
- patching
- screen-lock
- no unmanaged production access

## Monitoring
- central structured logs
- error tracking
- metrics/tracing
- SIEM/security alerts
- uptime/status

## Security testing
- dependency scanning
- SAST
- DAST
- API test
- IaC scan
- penetration test
- red-team later

## Email/domain
- SPF
- DKIM
- DMARC
- domain registrar MFA
- registry lock where appropriate
- DNS change logging

## Backup
- encrypted
- separate credentials/account boundary
- point-in-time DB recovery
- object versioning
- restore drill

## Rule
Every tool must be documented in:
VENDOR_REGISTER.md
with:
- data accessed
- region
- criticality
- exit plan
