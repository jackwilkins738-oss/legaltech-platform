# V84 — Worker execution identity and exact claim binding

V84 adds a workflow-agnostic execution-authority boundary for background processing. Short-lived signed grants bind tenant, worker type, exact queued object, service identity and trace before a worker may claim work. Grants are single-use in the reference store; production shape requires durable replay evidence and managed workload identity.

Covered execution paths:

- inbound processing jobs;
- Proclaim writeback jobs;
- response-policy evaluation jobs;
- notification delivery intents.

The local Ed25519 issuer is a reference/test helper only. Production configuration requires a managed workload identity issuer/verifier and durable replay control. Raw grants are never persisted in the production-shaped schema; only SHA-256 grant fingerprints and bounded execution evidence are retained.

No Kubernetes, Azure Managed Identity, queue broker, Teams tenant or Proclaim production worker is claimed by this reference implementation.
