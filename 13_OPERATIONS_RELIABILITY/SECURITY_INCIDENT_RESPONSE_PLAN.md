# SECURITY INCIDENT RESPONSE PLAN

## Basis
NCSC recommends a documented incident response plan with:
- key contacts
- escalation
- process
- legal/regulatory considerations
- tracking
- specific playbooks
and links to BCP/DR/communications.

## Roles
At small-company stage:

### Incident Commander
Coordinates response.

### Technical Lead
Containment/analysis/recovery.

### Security Lead
Evidence, threat, credentials.

### Privacy/Legal
Data-breach/regulatory assessment.

### Customer Communications
Customer updates.

### Founder Executive
Business decisions.

Named backups required.

## Severity

### SEV0
Confirmed/likely material cross-tenant disclosure, active compromise of platform-wide privileged access, catastrophic integrity failure.

### SEV1
Customer-data compromise, ransomware, critical outage, compromised production credential.

### SEV2
Contained vulnerability/incident with limited impact.

### SEV3
Low-impact suspicious event.

## Core process
Detect
→ triage
→ declare
→ contain
→ preserve evidence
→ analyse
→ eradicate
→ recover
→ communicate
→ review

## First-hour checklist
- create incident record
- establish secure communication channel
- identify incident commander
- protect logs/evidence
- revoke/rotate compromised credentials
- isolate affected service where appropriate
- identify affected tenants/data
- assess ongoing exfiltration
- contact specialist/insurer/legal if required

## Playbooks to create first
1. cross-tenant access
2. stolen production credential
3. ransomware/destructive compromise
4. malicious insider/export
5. compromised Graph integration
6. compromised AI/vendor
7. data breach
8. DDoS/outage
9. supply-chain dependency

## Evidence
Record:
- time
- finding
- person
- decision
- action
- result

## Testing
Tabletop quarterly while small.
Technical simulation at least annually / after major architecture changes.

## Source
https://www.ncsc.gov.uk/collection/incident-management/cyber-incident-response-processes
