# THREAT MODEL V1

## Crown-jewel assets
- client identities
- matter contents
- privileged documents
- medical data
- financial data
- identity documents
- legal strategy
- credentials
- encryption keys
- audit logs
- integrations/tokens

## Trust boundaries
1. user browser ↔ platform
2. platform ↔ identity provider
3. application ↔ database
4. app ↔ object storage
5. app ↔ search
6. app ↔ queue/workers
7. app ↔ AI provider
8. app ↔ Microsoft Graph
9. app ↔ Proclaim
10. internal staff ↔ production
11. CI/CD ↔ production

## Threat actors
- external attacker
- phished employee
- malicious tenant
- malicious insider at customer
- malicious/compromised internal employee
- compromised developer
- compromised supplier
- compromised AI provider
- compromised dependency
- ransomware operator

## Critical attack scenarios
### Cross-tenant IDOR/BOLA
Attacker changes object identifier and retrieves another firm's matter.

Controls:
- server-side authz
- RLS / DB guard
- tenant-aware resource ownership
- cross-tenant automated tests

### Stolen user session
Controls:
- short sessions/tokens
- MFA/SSO
- risk-based/session revocation
- device/context signals where available

### Compromised admin
Controls:
- separate privileged identity
- JIT
- step-up auth
- immutable logging
- restricted support tooling

### Malicious document
Controls:
- quarantine
- malware scan
- isolated parser/OCR
- no execution
- prompt-injection isolation

### AI prompt injection
Controls:
- instructions separated from content
- AI cannot grant itself permissions
- allowlisted tools
- human approval
- output validation

### Compromised integration token
Controls:
- narrow scopes
- tenant-bound credentials
- rotation
- revocation
- short-lived tokens
- monitoring

### Ransomware/destructive action
Controls:
- immutable/offline-separated backups where practical
- recovery testing
- write separation
- anomaly detection
- delete protections

### Insider mass export
Controls:
- export permissions
- volume detection
- approvals
- watermarking where appropriate
- audit trail
- DLP signals

## Red-team acceptance
Before enterprise production:
- attempt cross-tenant reads/writes
- privilege escalation
- session theft
- API abuse
- webhook replay
- malicious upload
- AI injection
- storage URL bypass
- search leakage
- cache leakage
- support-tool abuse
