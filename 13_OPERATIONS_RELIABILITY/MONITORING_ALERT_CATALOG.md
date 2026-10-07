# MONITORING / ALERT CATALOG

## SEV1 candidate alerts
- confirmed cross-tenant access signal
- privileged credential compromise
- mass unauthorized export
- ransomware/destructive anomaly
- production DB corruption
- unrecoverable critical outage

## SEV2
- Graph ingestion backlog above threshold
- Proclaim write-back failure rate spike
- authentication outage
- malware scan unavailable
- audit pipeline failure
- backup failure
- search permission anomaly
- AI policy bypass detected

## SEV3
- elevated processing latency
- isolated connector failure
- subscription near expiry
- unusual retry rate
- customer-specific integration degraded

## Security detections
- repeated access denied across matter IDs
- break-glass use
- new privileged admin
- bulk export
- unusual download volume
- impossible/abnormal login
- support access granted
- secret rotation
- workflow policy weakened
- AI tool denied repeatedly

## Business-operational alerts
- oldest exception
- SLA breach
- mailbox stopped ingesting
- case write-back lag
- queue depth

## Alert quality
Every alert:
- owner
- severity
- runbook
- threshold
- false-positive review
- escalation
