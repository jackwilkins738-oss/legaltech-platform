# V37 — Connector reliability harness

Status: **current integration-test tooling; synthetic only**.

This increment stays inside D-018 by improving authorised-integration test tooling rather than adding legal workflow scope.

## Added
- synthetic Graph notification fingerprinting and duplicate suppression;
- retry/dead-letter state with bounded attempts;
- subscription lifecycle attention state;
- delivery/retry/dead-letter health telemetry;
- tenant-scoped API controls for simulated webhook receipt, failure and retry;
- operator visibility in the Integrations workspace.

## Hard boundary
No live Graph endpoint, token, mailbox, Proclaim endpoint, customer credential or client data is used. The harness does not claim production Graph semantics are proven; live behaviour must be validated in an authorised Microsoft tenant.
