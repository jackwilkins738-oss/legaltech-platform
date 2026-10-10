# V128 — Artifact resource containment

Managed artifact readers previously checked current permission and evidence before awaiting stream cleanup. A cleanup callback could stall, revoke access or receive cancellation after those checks and still cause previously verified bytes to be returned. Workers also copied managed loader output without wiping the original transferred buffer after execution.

The loader now awaits exactly-once stream cleanup before re-resolving the immutable manifest, verifying evidence and checking current return authorization. Cancellation or changed bindings during cleanup cannot transfer bytes. Failed cleanup wipes retained byte copies and cannot dispatch a second resolution or a processor. The public error remains `WORKER_ARTIFACT_PROVIDER_UNAVAILABLE`.

## Resource ownership

`ManagedWorkerArtifacts` accepts `maxConcurrentReads` (default 4, range 1–32) and `readTimeoutMs` (default 10,000, range 100–60,000). Payload and policy reads share the same capacity. Saturation rejects additional work before provider dispatch. The deadline and caller cancellation propagate a combined abort signal to every read callback and iterator check.

A timeout requests cancellation; it does not assert that a provider stopped. The loader keeps its capacity slot and waits for actual callbacks and iterator cleanup to settle. Readiness stays unready while any cancelled read remains owned, or when capacity is saturated. Probes also refuse overlap until their actual provider callbacks settle, and recheck read state before reporting healthy. There is no automatic slot expiry, forced iterator close or optimistic drain release. An adapter that ignores abort can therefore remain blocked deliberately; deployment must diagnose it without restarting over unresolved work.

Successful managed returns are registered privately as owned byte transfers. The worker runtime wipes these original buffers after processing, checkpoint work and completion/failure handling settle, including cancellation immediately after loading. Runtime and processor copies are also wiped. Unregistered legacy/provider-owned buffers retain their existing copy-only contract. Explicit managed-loader callers may call `releaseManagedArtifact` after their actual use has settled; this only wipes authentic buffers registered by this module, never lookalike objects. No byte zeroing occurs while an uncooperative processor still owns its input.

## Connected validation

Twenty-seven new boundary tests cover cleanup ordering, manifest/evidence/permission withdrawal, cancellation, stalled cleanup and resolution, deadlines, shared capacity, probe ownership, listener failures and buffer ownership through success, failure and uncooperative execution. Four enabled PostgreSQL cases verify no result after cleanup-time withdrawal, byte release after actual queue completion/failure and persistent deployment admission during cancelled stalled cleanup. The existing nine-pool HTTP/canary lifecycle remains enabled.

All 55 pinned migrations remain unchanged. PostgreSQL is skipped locally and must pass in CI. Provider implementations and business permissions in integration tests are synthetic. This continues the authorized D-018 integration exception; the pre-TO freeze and customer-data release gate remain. Real cloud SDK cancellation, permission evidence and deployment provisioning still require verification.
