# V34 Operator Capability Layer

Status: current synthetic/operator capability.

## Added
- global client-side search across matters, inbound events, references, traces and audit text
- view-specific filters for event status/source and exception priority
- locally persisted saved operator views
- derived high-priority notification drawer
- safe multi-select triage with **bulk reject only**
- bulk approval remains intentionally prohibited
- richer synthetic matter intelligence: related signals, open human gates, verified actions and observed classifier confidence

## Safety boundary
These are operability capabilities, not validated legal workflow intelligence. Search is client-side over already-authorised tenant-scoped API payloads. Notifications and priority states are deterministic synthetic heuristics. No legal-risk score, deadline authority or autonomous external action has been introduced.

## Human control
Single-item approval still requires explicit matter selection and uses the existing approval/writeback/reconciliation boundary. Multi-item approval is not implemented.
