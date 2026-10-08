# V62 — Security Monitoring, Audit Integrity and Incident Detection

## Scope
V62 hardens the existing synthetic foundation without adding legal workflow scope. It adds application-level tamper evidence and bounded security signals, plus production-shaped contracts for managed monitoring.

## Audit integrity
New synthetic audit entries include `previousHash` and `entryHash`. The hash is calculated over a canonical representation of the server-created audit record and the previous entry hash. The store exposes a verification operation and rejects local audit UPDATE/DELETE operations.

The production-shaped PostgreSQL migration adds server-generated SHA-256 chain fields for new audit rows. A per-tenant advisory transaction lock serializes chain creation. Historical pre-V62 rows remain historical and are not silently rewritten.

## Security signals
The bounded monitor emits append-only alerts for:
- successful privileged Graph/Proclaim actions;
- active break-glass matter access;
- session network/user-agent context changes within the monitoring window;
- high-volume reads;
- access across unusually many distinct matters;
- repeated connector failures.

Raw IP addresses and user-agent strings are not persisted in alert records; only a SHA-256 context hash is retained.

## Central sink failure
A production-shaped platform may require a security alert sink. If emitting a security signal fails, the security-sensitive operation is not allowed to silently proceed as though monitoring succeeded.

## Production configuration
Production config now requires:
- `SECURITY_MONITORING_MODE=managed`;
- `SECURITY_ALERT_SINK_MODE=managed-security-sink`;
- `SECURITY_LOG_REDACTION_MODE=strict`;
- `AUDIT_CHAIN_MODE=sha256-v1`;
- `INCIDENT_CORRELATION_MODE=server-generated`;
- bounded `SECURITY_LOG_RETENTION_DAYS`.

Real-client-data mode also requires reviewed PASS evidence for audit-chain verification, security alerting, session-anomaly detection, exfiltration detection, break-glass alerting, connector-abuse alerting, retention and log redaction.

## Explicit limits
V62 does not claim a live SIEM/SOC, production alert routing, customer-specific detection tuning, immutable cloud/WORM storage, live incident response, or production retention policy approval. Those remain external evidence requirements.
