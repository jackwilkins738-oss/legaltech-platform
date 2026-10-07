# BACKUP & DISASTER RECOVERY ARCHITECTURE

## Threat assumptions
- accidental deletion
- failed deployment
- database corruption
- ransomware
- malicious admin
- cloud-region failure
- supplier failure
- lost credentials/keys

## NCSC principles incorporated
Backups should:
- survive destructive actions
- preserve earlier clean versions
- have strong key management
- alert on privileged/significant changes
- avoid one compromised administrator destroying all recovery options

## Architecture

### Database
- point-in-time recovery
- scheduled snapshots
- retention tiers
- independent backup protection
- restore tests

### Object storage
- versioning
- deletion protection/retention where appropriate
- separate backup/copy
- integrity hashes

### Configuration/IaC
- Git repository
- protected history
- cloud config backup/export

### Secrets/keys
Recovery plan must cover:
- KMS
- secrets
- identity
- emergency accounts

## Separation
Production operators should not automatically have destructive backup-admin rights.

Consider:
- separate backup role/account
- immutable retention
- MFA/step-up
- delayed deletion
- alerts

## Target RPO/RTO — initial proposal
Must be validated commercially.

Tier 1 canonical matter data:
RPO <= 15 minutes
RTO <= 4 hours

Tier 1 documents:
RPO <= 1 hour
RTO <= 8 hours

Critical identity/config:
documented emergency recovery

Do not contractually promise until tested.

## Restore testing
Monthly/quarterly depending stage:
- database restore
- sample document restore
- permissions
- search rebuild
- audit consistency

Annual/major:
full DR exercise.

## Recovery reconciliation
After restore:
- replay durable events where appropriate
- check external Graph/Proclaim deltas
- preserve idempotency
- reapply deletion/legal-hold state

## Sources
NCSC ransomware resistant backups:
https://www.ncsc.gov.uk/collection/ransomware-resistant-backups
https://www.ncsc.gov.uk/collection/ransomware-resistant-backups/principles-for-ransomware-resistant-cloud-backups
