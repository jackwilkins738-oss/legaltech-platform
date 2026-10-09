# V76 — Operational readiness and degraded-mode controls

V76 separates **process liveness** from **dependency-aware readiness** so an alive process cannot silently claim that it is safe to accept work.

## Runtime boundary

- `GET /api/v1/health` remains a process-only liveness signal and does not touch external dependencies.
- `GET /api/v1/ready` is public for orchestrator/load-balancer use but fails closed with HTTP 503 when a critical dependency is unavailable or no readiness coordinator is configured.
- Non-critical dependency failure is represented as `DEGRADED` with HTTP 200 so traffic can remain routable only when the configured critical boundary is intact.
- Public readiness responses contain only `READY`, `DEGRADED` or `NOT_READY`; dependency names, exception strings, endpoints, credentials and probe details are never returned. This is the **readiness error redaction** boundary.

## Probe containment

`ReadinessCoordinator` accepts a finite set of server-configured probes. Check names/codes are bounded, duplicate checks are rejected, result objects are strictly shaped, and arbitrary adapter payloads are converted into failure rather than reflected. Probes run with bounded timeouts and receive an abort signal. Concurrent callers share one in-flight evaluation and short-lived caching prevents a public readiness endpoint from becoming a dependency-amplification mechanism. This is the **bounded readiness probing** boundary.

A failed critical probe yields `NOT_READY`; a failed non-critical probe yields `DEGRADED`. There is no automatic fail-open or security-control bypass. This is the **readiness fails closed** boundary.

## Production configuration

Production startup now requires:

- `LIVENESS_MODE=process-only`
- `READINESS_MODE=dependency-aware`
- `READINESS_FAILURE_MODE=fail-closed`
- `READINESS_PROBE_TIMEOUT_MS` between 100 and 5000 ms

The scaffold records the required deployment shape but does not claim that a live production load balancer, database, queue, object store or connector has been validated. Exact critical/non-critical dependency selection remains deployment-specific and must not weaken authentication, audit, tenant isolation or write-safety controls.

## Deliberately not included

V76 does not add a guessed availability SLA, autoscaling policy, failover topology, incident response vendor, retry cadence or Co-op-specific workflow. It adds the generic liveness/readiness contract needed before those deployment decisions are made.
