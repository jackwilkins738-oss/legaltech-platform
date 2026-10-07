# BUSINESS CONTINUITY PLAN

## Goal
Continue minimum viable customer service when normal systems, people or suppliers fail.

## Critical functions
1. authentication
2. matter/document access
3. inbound processing
4. customer communication
5. security monitoring
6. support
7. backups/recovery
8. billing less critical

## Business impact analysis
For every function:
- max tolerable outage
- RTO
- RPO
- dependencies
- manual workaround
- recovery owner

## Scenarios

### Primary cloud outage
- status communication
- failover/recovery
- suspend risky automation

### Microsoft Graph outage
- queue/reconciliation later
- customer can continue Outlook directly
- no data-loss claim until delta reconciliation

### Proclaim outage
- store pending safe work
- prevent duplicate write-back
- reconcile later

### AI provider outage
- disable AI-dependent processing
- continue deterministic intake
- manual review

### Founder unavailable
- second founder has access
- documented runbooks
- external incident/security contacts

### Cyber incident
May require deliberate shutdown to protect confidentiality.

## Minimum viable operations
Define system mode where:
- customers can securely access core matters/documents
- new risky automation disabled
- outbound autonomous actions disabled
- support/status available

## Communications
Alternative channel if:
- email compromised
- primary domain unavailable

## Exercises
- tabletop
- vendor outage
- credential compromise
- database restore
- major region outage

## Source
NCSC 2026 disruptive-attack recovery guidance:
https://www.ncsc.gov.uk/guidance/ceos-responding-cyber-incidents
