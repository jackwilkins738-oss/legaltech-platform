# V61 — Connector credential containment boundary

V61 narrows live Graph/Proclaim credential authority without claiming a live provider integration.

## Controls
- Live connectors accept only strict managed-secret references. Query strings, fragments, embedded credentials, percent-encoded path tricks and plaintext values are rejected.
- `ConnectorCredentialBroker` binds resolution to tenant, connector kind and one granted purpose.
- Provider results must be ACTIVE, unexpired, tenant/kind-bound and carry a monotonic generation.
- Credential-generation authority sits behind a store interface; production requires a durable store. Once a newer generation is observed, an older generation is rejected even after broker recreation.
- Provider-returned secret bytes are zeroed immediately after copying; leased bytes are zeroed after the one connector callback finishes.
- Direct credential egress in a connector result is rejected.
- Integration registry metadata/health reject obvious raw credentials, tokens, private keys and byte containers. Managed references may be stored internally.
- Integration API responses redact credential/secret references and credential-like values before browser delivery.
- Production configuration requires a managed secret store reached through workload/federated identity, brokered credential resolution, no plaintext secret cache, a durable generation store, and least-privilege Graph/Proclaim identities.
- Real-client-data mode additionally requires reviewed rotation, revocation and secret-audit evidence.

## Explicit non-claims
V61 does not connect to Azure Key Vault, AWS Secrets Manager, GCP Secret Manager, live Microsoft Graph or live Proclaim. It does not prove provider-side permission scope, rotation or revocation. Those remain external evidence gates.
