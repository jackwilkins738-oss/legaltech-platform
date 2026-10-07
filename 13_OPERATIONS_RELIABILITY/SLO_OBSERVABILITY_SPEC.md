# SLO / OBSERVABILITY SPEC

## Do not contract these until measured.
Initial internal targets only.

## Availability
Core authenticated product:
99.9% monthly internal target.

## Inbound processing
Valid Graph notification:
99.9% durably queued within 2 minutes under normal upstream availability.

## Processing
95% ordinary emails reach classification decision within 5 minutes, excluding large/complex files and upstream outage.

## Proclaim write-back
99% of accepted writes attempted within 2 minutes.
Success target measured separately because upstream failures must be distinguished.

## Audit
100% of defined privileged/material actions produce an audit event.
Missing audit event is release/incident-level defect.

## Backup
Database RPO internal target:
<= 15 minutes where infrastructure supports.

## Observability pillars
- logs
- metrics
- traces
- audit events
- synthetic health checks

## Trace
One trace ID follows:
Graph event
→ queue
→ classification
→ approval
→ Proclaim connector

## Tenant visibility
Operational metrics tagged by tenant internally but access-controlled.

## SLO burn alerts
Use multi-window alerts once volume justifies.

## Status
Separate:
our service
Microsoft
Proclaim/customer-side dependency
AI provider
so customers see dependency cause clearly.
