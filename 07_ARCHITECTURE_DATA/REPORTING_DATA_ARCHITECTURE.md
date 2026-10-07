# REPORTING & DATA ARCHITECTURE

## Proclaim evidence
Historical forum evidence shows some users bypassing native reporting for SQL/SSRS.
This is old evidence and must not be treated as proof of 2026 limitations.

Current Access training still includes "Proclaim Advanced Reports," confirming reporting remains a specialist feature area.

## Modern product requirement
Reporting should not require specialist SQL for routine operations.

## Data architecture principles
### Canonical transactional model
Postgres/relational canonical records:
- firm
- branch
- user
- team
- client
- matter
- party
- event
- task
- deadline
- communication
- document
- document version
- workflow
- time entry
- audit event

### Operational analytics
Create event/analytics layer for:
- task throughput
- queue age
- case stage duration
- automation success
- exceptions
- emails processed
- documents processed
- waiting states
- user workload
- deadlines
- errors
- SLA breaches

### Reporting UX
Three layers:
1. predefined operational dashboards
2. configurable saved views
3. governed natural-language query

## Natural language reporting guardrails
AI must:
- respect user/matter permissions
- generate only against approved semantic layer
- show definitions
- show source/drill-down
- never bypass row-level access
- avoid leaking cross-matter information

## Metrics to build from day one
- matter cycle time
- stage dwell time
- task age
- overdue rate
- automation rate
- exception rate
- manual touches/matter
- first-response time
- document processing latency
- email classification accuracy
- capacity saved
