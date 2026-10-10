# Platform Foundation Build

**Lifecycle:** current engineering foundation, product workflow still evidence-gated.

Latest batch: [V137 deployment capacity](docs/V137_DEPLOYMENT_CAPACITY_BATCH.md).
The durable PostgreSQL root requires a fleet connection budget and observable
bounded pools. Check a synthetic plan with
`npm run deployment:capacity -- deployment/capacity.synthetic.json`.

This is the first coherent implementation of the reusable platform path allowed by D-018:

`synthetic inbound event -> durable queue -> safe attachment gate -> deterministic matter candidate -> controlled AI/classification interface -> exception/human review -> mock Proclaim write -> read-back reconciliation -> audit -> idempotent replay`

## What this proves
- tenant-scoped persisted data;
- durable jobs and explicit worker states;
- event and command idempotency;
- attachment quarantine before trusted processing;
- deterministic exact-reference matter matching;
- AI behind a controlled gateway rather than direct DB access;
- exceptions as first-class operational state;
- human approval before external writeback;
- mock Proclaim idempotent writes and read-back reconciliation;
- append-oriented audit trail and trace IDs.

## What this does not prove
- real Microsoft Graph behaviour;
- real Proclaim API/writeback behaviour;
- production Postgres/RLS;
- production malware scanning/OCR;
- production authentication/SSO;
- legal correctness of any workflow;
- the commercial V1 wedge.

Run:

```bash
npm test
npm run demo
```


## Visible local application
The synthetic development server now includes a browser UI.

### Windows
Double-click `RUN_LOCAL_APP.bat`, or run:

```powershell
cd 40_PLATFORM_FOUNDATION_BUILD
npm run dev
```

Then open `http://127.0.0.1:3210`.

Current screens:
- My Work
- Inbound Queue
- Exception Review
- Matters
- Audit Trail

Use **Generate demo item** to create a synthetic inbound item. Select a matter, approve or reject it, and observe the mock Proclaim reconciliation/audit trail.

This surface is synthetic/local development only. The static dev bearer token is forbidden for production.

## V31 operator review surface
The synthetic browser app now exposes a richer human-control workflow: source preview, explainable classification/matching, matter context, proposed controlled action, candidate selection, approve/reject controls, reconciliation status, technical audit trace, matter timelines, and four synthetic exception scenarios. These are UX/infrastructure demonstrations only; they do not set the first commercial workflow before TO evidence.

## V32 operations cockpit
My Work now prioritises synthetic operational exceptions and matter progression state. These priority labels are deterministic demo heuristics only, not validated legal-risk or deadline scores. See `docs/V32_OPERATIONS_COCKPIT.md`.


## V33 high-tech command centre
The synthetic local UI is now a dark command-centre operator surface with live API health/latency telemetry, an ingest-to-reconciliation pipeline, a live audit stream, AI confidence instrumentation, keyboard shortcuts and a command palette. These are presentation/operability improvements only. Priority values remain deterministic demo heuristics; no legal-risk, deadline or commercial workflow model has been introduced. See `docs/V33_HIGH_TECH_COMMAND_CENTRE.md`.


## V34 operator capability layer
The synthetic command centre now includes global search, per-view filters, saved local operator views, a high-priority attention drawer, richer matter intelligence and safe bulk rejection. Bulk approval is deliberately unavailable. These features operate only over already-authorised tenant-scoped synthetic data.


## V35 Aurora visual system
V35 is a full presentation-layer rebuild rather than an incremental CSS patch. The browser app now uses the Aurora enterprise command system: secure workspace rail, command fabric, glass/telemetry surfaces, animated ambient state, redesigned progression pipeline, denser operational panels, a three-pane human-review workspace, upgraded matter/audit surfaces, responsive fallbacks and a dedicated visual-contract regression. Existing V34 search/filter/saved-view/notification/bulk-reject controls and all safety boundaries remain intact. This is a UX/operability change only; it does not create validated legal intelligence or alter D-018.


## V36 integration readiness
The local synthetic app now includes an Integrations control plane for Microsoft Graph lifecycle modelling, Proclaim validation readiness and production-shaped OIDC claims mapping. Live customer access remains blocked until authorised.

## V38 connector safety fixes
Tenant and mailbox scope are enforced throughout the synthetic control plane.
Rejected notifications no longer interfere with deduplication; expiry and recovery
transitions are checked; operator actions have actor/trace audit records. See
`docs/V38_CONNECTOR_SAFETY.md` for changed behavior, recovery and limits.

## V39 durable writeback safety
Write intent and receipt persist before external I/O/read-back. Unknown outcomes
retry verification only, and approval replay cannot queue the same event again.
The operator UI reports success only after selected-event read-back proof and
provides read-only Verify outcome recovery. See `docs/V39_WRITEBACK_SAFETY.md`
for failure behavior, the recovery API, conservative upgrades and rollback limits.

## V40 inbound safety

V40 makes inbound acceptance and processing audit/queue changes atomic, prevents
retry/late-worker duplicate review and decision overwrites, and replaces raw worker
errors with a safe code. Scenario UI success requires selected-event processing
proof. See `docs/V40_INBOUND_SAFETY.md` and `TEST_RESULTS_V40.md` for upgrade limits.

## V41 inbound request safety

V41 binds ingest replay to the original normalized payload, isolates tenant/key
scopes, verifies cached resource ownership and rejects malformed uploads before
acceptance. Unverifiable historical attachment requests fail closed. See
`docs/V41_INBOUND_REQUEST_SAFETY.md` and `TEST_RESULTS_V41.md` for compatibility limits.

## V42 recovery and repository safety

Failed/stalled inbound work is visible and has a controlled audited retry. Retired
workers cannot overwrite replacement work; approval/writeback remain separate.
Catalog/lint respect Git ignores, including downloaded installers. The updater's
optional CommitAndPush mode prepares the feature branch without merging it. See
`docs/V42_RECOVERY_AND_REPOSITORY_SAFETY.md` and `TEST_RESULTS_V42.md` for limitations.

## V43 review request safety

Review retries now bind the decision, target, notes and original actor. Changed
requests conflict; approval notes persist and cached replay verifies owned
resources. Historical requests fail closed when their original input cannot be
proved. See `docs/V43_REVIEW_REQUEST_SAFETY.md` and `TEST_RESULTS_V43.md`.

## V44 writeback recovery safety

Repeated verification requests now reuse an active read-only job without resetting
its read budget or stacking jobs. Cached recovery results verify owned job/command
bindings. See `docs/V44_WRITEBACK_RECOVERY_SAFETY.md` and `TEST_RESULTS_V44.md`.

## V45 combined worker and recovery safety batch

Claim/attempt fences protect reclaimed work; old-cycle results preserve new
budgets and valid receipt evidence. Reads reserve a shared durable budget and
successful read-back commits with audit/job completion. The UI explains retired
work without claiming success. Download inventory and publication guards protect
unrelated local work. See `docs/V45_WORKER_RECOVERY_SAFETY.md` and
`TEST_RESULTS_V45.md` for the combined fix, tests and rollback boundaries.

## V46 combined HTTP boundary safety batch

The API rejects malformed UTF-8 and duplicate security headers, handles malformed
route IDs as client errors, and exposes only privately recorded application error
envelopes. Connector audit failure reasons share this safe classification. See
`docs/V46_HTTP_BOUNDARY_SAFETY.md` and `TEST_RESULTS_V46.md` for compatibility,
regression evidence and delivery requirements.

## V47 combined attachment and storage safety batch

Owned object references and stored bytes are checked before reuse. Linked paths,
corruption and blocked filename aliases fail closed; inbound processing verifies
attachment availability before classification and completion. Existing retry and
quarantine flows remain in use. See `docs/V47_ATTACHMENT_STORAGE_SAFETY.md` and
`TEST_RESULTS_V47.md` for evidence, byte limits and recovery boundaries.

## V48 combined decision and recovery safety batch

Approval and recovery retries bind the original actor and owned durable proof.
Review exceptions cannot be bypassed, first approval checks attachment availability,
and writeback dispatch checks approved actor/classification/trace. See
`docs/V48_DECISION_RECOVERY_SAFETY.md` and `TEST_RESULTS_V48.md` for historical
compatibility, rollback and delivery requirements.

## V49 combined connector evidence safety batch

Connector validation uses owned read evidence, bounded failures and honest untested
write/live checks. Revision/generation fences protect newer results; registry
records are isolated and validated before mutation. Checkpoint tokens remain out
of API/UI responses. See `docs/V49_CONNECTOR_EVIDENCE_SAFETY.md` and
`TEST_RESULTS_V49.md` for compatibility and evidence limits.

## V50 combined writeback boundary safety batch

Reconciliation retries bind the requesting operator and the original approval.
Missing durable command evidence cannot erase recorded write history or authorize
another send; legacy completion needs fresh bound read-back. Worker commits
recheck approval/job/receipt bindings and preserve changed evidence. Typed counters,
bounded budgets and normalized adapter evidence fail closed. See
`docs/V50_WRITEBACK_BOUNDARY_SAFETY.md` and `TEST_RESULTS_V50.md` for compatibility
and the required security review.

## V51 combined inbound evidence safety batch

Classifier results retain only the recognized synthetic output contract. Processing
binds source/classification/match evidence through first approval and worker dispatch;
retired claims cannot commit or requeue replacement work. Matching verifies current
owned matter references at completion, and `npm run demo` uses a supported source.
See `docs/V51_INBOUND_EVIDENCE_SAFETY.md` and `TEST_RESULTS_V51.md` for historical
compatibility, provider admission limits and the required security review.


## V52 — Authentication/request snapshot safety

The existing synthetic auth boundary now validates owned typed identity fields and
exact capability arrays. Static session records and OIDC mapper configuration are
private; request sessions are immutable snapshots before body reads. Malformed
provider sessions return 401 before retrieval; missing exact permissions return 404.
See docs/V52_AUTH_BOUNDARY_SAFETY.md for compatibility, limits and review gates.


## V53 — Review decision/audit safety

Review decisions validate the owned event/exception binding, refuse contradictory
prior decision evidence and commit with conditional writes. Rejections retain
notes in decision records while audit views use a fixed reason. Bulk partial
failures and recorded approvals refresh the UI without claiming verified writes.
See docs/V53_REVIEW_BOUNDARY_SAFETY.md for historical compatibility and review gates.

## V54 — Inbound recovery evidence and conditional writes

Recovery validates original jobs, complete recovery cycles, owned bindings and
safe counters/timestamps before retiring expired claims. Scheduling and event
updates commit conditionally; missing evidence appears as Processing unavailable
with unknown counts and requires investigation. Workers preserve superseded claims
and reject invalid evidence before classification. See
`docs/V54_INBOUND_RECOVERY_BOUNDARY.md` for compatibility and review gates.

## V55 — Synthetic Graph authority and clock safety

The harness keeps subscriptions, deliveries and opaque checkpoints private. Its
bound tenant/retry budget and captured dependencies cannot be redirected through
public property edits. Clock failure leaves connector state unchanged; one validated
time observation drives each operation and snapshot. Typed configuration/notification
inputs reject inherited records and accessors without evaluating them. See
`docs/V55_GRAPH_BOUNDARY_SAFETY.md` for compatibility, limits and review gates.

## V56 — Storage sidecar and basic file-check evidence

Object reads/deduplication validate both stored bytes and their owned metadata
sidecar. The root is fixed; descriptor reads are bounded and check observed file
and directory identity changes. Invalid metadata/input types fail before creation,
and basic inspection quarantines malformed filenames, byte inputs and size budgets.
No incomplete evidence is silently repaired. See
`docs/V56_STORAGE_EVIDENCE_BOUNDARY.md` for compatibility and investigation limits.

## V57 — Read-only validation and registry evidence

Proclaim validation captures its tenant/provider methods and keeps request generation
private. Provider history must be a bounded dense array of unique owned records;
raw payloads and accessors are not used as proof. Registry records are private JSON
snapshots, and validation persists only against its original connection revision,
then checks the acknowledgement through read-back. Live and write evidence remains
blocked/untested. See `docs/V57_VALIDATION_EVIDENCE_BOUNDARY.md` for compatibility.


## V58 — Security hardening and production evidence gates

V58 adds composite tenant integrity, restricted-matter membership, document-level
security overrides, matter-bound step-up break-glass, server-owned trace identity,
bounded collection/API abuse controls and explicit production identity/content/
connector infrastructure gates. GitHub Actions are immutable-SHA pinned and the
security scanner now detects unpinned Actions and additional credential classes.
Real customer data remains blocked until live infrastructure, connector, recovery
and independent penetration-test evidence exists. See
`docs/V58_SECURITY_HARDENING.md` and `TEST_RESULTS_V58.md`.

## V59 production identity boundary
The foundation now includes a production-shaped OIDC/JWKS verification and opaque server-session boundary. See `docs/V59_PRODUCTION_IDENTITY_BOUNDARY.md`. The local static bearer flow remains synthetic-only; real Entra and managed-session evidence is still required before real-client-data mode can be approved.


## V60 hostile-document containment boundary
The foundation now includes bounded MIME/signature inspection, Office/archive safety checks, decompression-bomb and path-traversal rejection, managed malware-scan evidence binding, isolated-parser evidence binding and a production mode that refuses AI/approval until clean isolated document evidence exists. See `docs/V60_HOSTILE_DOCUMENT_BOUNDARY.md`. This remains a boundary/reference implementation: no real malware scanner or parser service is claimed.

## V61 connector credential containment boundary
The foundation now includes strict managed-secret references and a tenant/kind/purpose-bound credential broker. Secret bytes are short-lived and zeroed, stale generations are rejected after rotation, registry/API surfaces reject or redact credential material, and production configuration requires workload/federated identity plus least-privilege connector identities. See `docs/V61_CONNECTOR_CREDENTIAL_CONTAINMENT.md`. No live vault, Graph or Proclaim credential is claimed.


## V62 security monitoring and audit integrity boundary
The foundation now hash-chains synthetic audit entries, verifies the chain, keeps local audit/security-alert ledgers append-only and emits bounded security signals for privileged connector actions, break-glass use, anomalous session context, bulk/cross-matter reads and connector failure bursts. Production-shaped configuration requires a managed alert sink, strict redaction, server-generated incident correlation and explicit retention. See `docs/V62_SECURITY_MONITORING.md` and `TEST_RESULTS_V62.md`. This is monitoring/reference logic only; no live SIEM/SOC integration is claimed.


## V63 backup, restore and ransomware recovery resilience
The foundation now validates immutable tenant-bound backup manifests, records append-only hash-chained recovery evidence, requires dual-control restore authorization, constrains restores to isolated/clean targets and refuses verified status until database/audit/object/tenant integrity checks pass. Production-shaped configuration requires PITR, isolated backup identity, separate KMS keys and ransomware recovery controls. See `docs/V63_RECOVERY_RESILIENCE.md`. No live cloud backup or production restore is claimed.


## V64 generic work orchestration foundation
The foundation now has workflow-agnostic typed work, explicit states, generic user/role/team/pool ownership, optimistic versioning, idempotent creation, matter binding, dependencies with cycle protection, automatic downstream reactivation, structured request responses, bounded queues, append-only work events and baseline flow metrics. See `docs/V64_WORK_ORCHESTRATION.md`. No Co-op-specific role mapping, SLA, routing or legal workflow is encoded before TO evidence.


## V65 versioned workflow runtime, feature flags and notification intents
The foundation now supports validated/published workflow definitions, definition-hash/version-pinned instances, bounded create-work/wait/delay/branch/notify/complete execution, idempotent starts/signals, tenant pilot feature flags and deduplicated in-app/Teams notification intents. Notification steps never send externally; connector delivery remains a separate credentialed boundary. See `docs/V65_WORKFLOW_RUNTIME.md`.

## V66 time-and-motion evidence foundation
The foundation now includes tenant-bound, pseudonymised TO studies with measured/estimated timing separation, internal/external dependency evidence, correction-by-supersession, append-only observation/estimate history, flow summaries and guarded annualisation. See `docs/V66_TO_EVIDENCE_FOUNDATION.md`. The module measures process evidence; it does not decide what to automate before TO findings exist.

## V67 delegation and flow intelligence
The foundation now supports bounded generic delegation/absence routing and append-only aggregate flow snapshots. Flow intelligence can quantify queue age, waits, dependencies and downstream work blocked by an owner without persisting case titles or matter IDs in snapshots. See `docs/V67_DELEGATION_FLOW_INTELLIGENCE.md`. Firm-specific SLA/escalation rules remain post-TO configuration.

## V68 configurable response targets and escalation intents
The foundation now supports versioned, published response-target policies that can generate bounded notification intents or explicit escalation work after configurable created/waiting/due thresholds. Source work is never automatically reassigned. See `docs/V68_RESPONSE_TARGET_ESCALATION.md`. Actual thresholds and escalation routes remain TO-driven configuration.

## V69 matter-aware work authorization
The generic work foundation now has an explicit tenant/matter-aware authorization boundary before API/UI exposure. Self access is derived only from trusted actor/role claims; TEAM/POOL membership is not inferred, requester read visibility does not grant mutation authority, and broad work capabilities never bypass restricted matter controls. Policy management requires recent step-up by default. See `docs/V69_WORK_AUTHORIZATION.md`.

## V70 bounded work API
The generic work model is now available through an authenticated, bounded HTTP contract backed by V69 matter-aware authorization. Tenant/requester/actor/trace identity is server-owned, queues are bounded and filtered, stale mutations return safe conflicts, and no endpoint can bypass restricted matter controls. See `docs/V70_WORK_API.md`.

## V71 trusted organisation membership
The foundation now has a generic tenant-bound TEAM/POOL directory with time-aware memberships, optimistic revocation, retired-group handling and append-only membership evidence. V69 can use this trusted directory to authorize shared team/pool work without trusting browser-supplied group identity. See `docs/V71_ORGANIZATION_DIRECTORY.md`.

## V72 durable response-policy evaluation worker
The foundation now has a bounded, lease-recoverable worker for evaluating the generic V68 response-target policies. Jobs pin published policy version/hash, scan work in bounded pages, deduplicate materialisation on replay and isolate individual item failures. No polling cadence, SLA or external notification delivery is installed. See `docs/V72_POLICY_EVALUATION_WORKER.md`.

## V73 bounded notification delivery containment
The foundation now has a bounded delivery worker for V65 notification intents. In-app delivery is local; external Teams delivery requires an explicitly injected adapter and receives only structured template/object references, never arbitrary matter text or connector credentials. Delivery attempts are tenant-scoped, lease-recoverable, retry-capped and recorded as append-only bounded evidence with provider references stored only as hashes. See `docs/V73_NOTIFICATION_DELIVERY.md`. No live Teams tenant, external messaging credential or production notification transport is claimed.

## V74 opaque work pagination and queue read-model hardening
The bounded work API now uses encrypted/authenticated short-lived cursors bound to tenant and exact queue filters instead of exposing numeric offsets. Tampering, cross-tenant reuse, filter reuse and expiry fail closed; unreadable work can still be scanned without disclosing skipped-record counts. Production-shaped owner/state/type/matter queue indexes support large shared workloads without adding firm-specific semantics. See `docs/V74_WORK_CURSOR_AND_QUEUE_READ_MODEL.md`. A production deployment must inject stable managed cursor-key material across instances; the synthetic dev service may use an ephemeral process key.

## V75 TO field intake and evidence report
The TO evidence foundation now has a strict anonymised CSV intake/preflight boundary and evidence-driven field report. Imports are bounded, row-isolated and idempotent; PII-like process notes remain rejected by the V66 evidence validator; accepted rows preserve measured/estimated separation. Reports expose task burden, dependency-role waiting, role×task matrices, system usage and guarded annualisation independently rather than inventing a composite opportunity score. See `docs/V75_TO_FIELD_INTAKE.md` and `docs/TO_FIELD_IMPORT_TEMPLATE.csv`.


## V76 operational readiness and degraded-mode controls
The HTTP boundary now separates process liveness from dependency-aware readiness. Critical dependency failure fails readiness closed, non-critical failure is explicit `DEGRADED`, public responses redact dependency/error detail, and bounded cached probes avoid turning readiness traffic into dependency amplification. Production configuration requires process-only liveness, dependency-aware readiness and fail-closed readiness semantics. See `docs/V76_OPERATIONAL_READINESS.md`.


## V77 migration and release integrity
Production-shaped SQL history is now SHA-256 manifest-pinned and sequence-checked. Missing, unexpected, reordered, tampered or symlinked migrations fail closed; applied database evidence must be an exact ordered prefix; destructive schema/data operations require an explicit review reference; and schema compatibility can participate in V76 readiness. Runtime production instances are configured not to auto-migrate. See `docs/V77_MIGRATION_RELEASE_INTEGRITY.md`.


## V78 authenticated read-volume containment
Authenticated visible reads now consume a tenant+actor record budget and a distinct-matter budget across protected endpoints before response egress. Work queues/event history participate in V62 bulk-read monitoring, denied extraction returns a bounded 429 without an items payload, and production requires a shared managed read-volume limiter rather than per-process memory. See `docs/V78_READ_VOLUME_CONTAINMENT.md`.


## V79 data lifecycle and legal-hold safety
Retention now has a versioned policy primitive with no default period, matter/resource legal holds fail disposition closed, eligible disposition plans are idempotent and policy-pinned, and approval requires a second actor plus a fresh hold/policy check. There is intentionally no automatic delete/execute method; production disposition remains externally controlled and real-client-data mode requires reviewed retention/hold/procedure evidence. See `docs/V79_DATA_LIFECYCLE.md`.


## V80 release and configuration provenance
Runtime identity can now bind source revision, package version, artifact digest, migration-manifest digest and a secret-free fingerprint of security-relevant configuration. Readiness can fail on release drift and bounded fleet assessment distinguishes mixed binaries from config drift without exposing environment values. Production and real-client-data gates require verified provenance/drift evidence. See `docs/V80_RELEASE_PROVENANCE.md`.

## V81 controlled data export and download containment
Future export/reporting features now have a bounded egress primitive: every resource is server-authorized before request creation, manifests and packages are digest-pinned, package readiness requires managed-storage evidence, and downloads use short-lived actor-bound single-use grants whose raw tokens are never persisted. Public links and arbitrary external delivery are explicitly absent/disabled. See `docs/V81_CONTROLLED_EXPORT.md`.

## V82 security incident interlocks
The foundation now has tenant-scoped emergency controls for all egress, Proclaim writes, external notifications, export, connector credential use and new server sessions. Activation is server-authorized and persistent; release requires a different authorized actor. The reference interlock is consumed by the export, connector, notification, session and writeback boundaries while preserving reads/recovery. See `docs/V82_SECURITY_INTERLOCKS.md`.

## V83 production change governance
Normal production behavior changes can now be bound to an expiring, exact target hash and require approval by a second authorized actor before one-time execution. Workflow publication, response-policy publication, feature-flag changes and retention-policy publication can consume this evidence when change control is configured. V82 emergency interlocks remain independent so incident containment is not delayed. See `docs/V83_PRODUCTION_CHANGE_CONTROL.md`.

## V84 worker execution identity
Background workers can now require short-lived, single-use execution grants bound to tenant, worker type, exact queued object and trace before they claim work. Inbound processing, Proclaim writeback, response-policy evaluation and notification delivery all support the boundary. Production shape requires managed workload identity plus durable replay evidence. See `docs/V84_WORKER_EXECUTION_IDENTITY.md`.

## V85 audit checkpoint and rollback detection
V85 adds externally anchorable audit-chain checkpoints so a locally valid but older/restored ledger can be detected as rollback or fork. Checkpoints persist only bounded hashes locally, are append-only and tenant-bound, and can participate in readiness without exposing audit contents or external anchor references. See `docs/V85_AUDIT_CHECKPOINT_ROLLBACK_DETECTION.md`.

## V86 secure document delivery
V86 adds short-lived, actor/matter-bound, single-use individual-document delivery without exposing reusable object-storage references. Authorization is rechecked at redemption, document identity is hash-bound, `ALL_EGRESS` can stop delivery, and production shape records immutable grant/consumption evidence. See `docs/V86_DOCUMENT_DELIVERY.md`.

## V87 managed encryption key lifecycle
V87 adds tenant/purpose-scoped, monotonic envelope-encryption key-generation metadata with ACTIVE, DECRYPT_ONLY and RETIRED states. It pins ciphertext metadata to exact generations while keeping all key material outside application state. See `docs/V87_KEY_LIFECYCLE.md`.

## V88 just-in-time support access
The foundation now includes a read-only, exact-resource JIT support-access boundary. Support capabilities alone never grant client-data access: requests require recent step-up, a distinct approver, ticket/purpose evidence, tenant/matter/resource binding and a short expiry. V86 document delivery can consume an exact document support grant without exposing object-storage identity. See `docs/V88_JIT_SUPPORT_ACCESS.md`. No standing support super-admin, support write scope or live ticketing integration is introduced.

## V89 Graph webhook ingress authenticity and replay containment
The foundation now separates webhook acknowledgement from trusted dispatch. Basic Microsoft Graph notifications must match a server-owned active subscription and secret `clientState`; internal tenant identity comes from that subscription rather than webhook JSON. Rich notifications additionally require a trusted validation-token verifier and exact app/tenant/Graph-caller claims. Replay is fingerprinted and production evidence excludes raw payload/clientState/token data. See `docs/V89_GRAPH_WEBHOOK_INGRESS.md`. No live webhook/JWT verifier or managed ingress queue is claimed.

## V90 Graph subscription lifecycle and durable registry
V90 adds a server-owned lifecycle authority for Microsoft Graph change-notification subscriptions. It keeps clientState in managed secret storage, binds webhook resolution to durable subscription metadata, treats missed notifications as recovery-required, handles removal/reauthorization states, and separates renew from reauthorize mutations. See `docs/V90_GRAPH_SUBSCRIPTION_LIFECYCLE.md`. No live Graph subscription client, scheduler or managed secret implementation is claimed.

## V91 durable Graph webhook queue and validation worker
V91 adds a bounded lease-recoverable queue/worker around V89 validation. Receipt is fast, invalid callbacks dead-letter, transient dependency/dispatch failures retry, downstream dispatch is fingerprint-idempotent, and terminal items retain no raw callback payload. See `docs/V91_GRAPH_WEBHOOK_QUEUE.md`. No managed queue deployment is claimed.

## V92 Graph delta recovery and checkpoint safety
Missed Graph notification recovery now has a bounded reference delta engine. Next/delta URLs are origin-pinned to Graph v1.0 and treated as opaque, terminal delta checkpoints are stored only through managed-secret references, and V90 subscriptions cannot return from recovery-required to active until the checkpoint is secured. Production shape persists only checkpoint hashes/generations and append-only recovery evidence. See `docs/V92_GRAPH_DELTA_RECOVERY.md`.


## V93 incident response evidence and containment
V93 adds a tenant-scoped incident lifecycle around the V82 security interlocks. Incident and evidence records contain bounded codes and cryptographic references only; raw forensic/client content stays external. Recovery and closure are evidence-bound, all active interlocks must be released before closure, and the incident opener cannot close the incident. See `docs/V93_INCIDENT_RESPONSE.md`.


## V94 tenant configuration rollout safety
V94 adds immutable tenant configuration bundles containing only server-validated component references/hashes. Activation requires an exact V83 change approval and switching back to an older published bundle is recorded as rollback rather than mutating history. See `docs/V94_TENANT_CONFIGURATION.md`.


## V95 synthetic workflow simulation
V95 can execute a validated workflow definition against an explicitly synthetic scenario without creating work, sending notifications, scheduling delays or touching a matter. It returns hashes rather than context values and supports deterministic before/after effect comparison. See `docs/V95_WORKFLOW_SIMULATION.md`.


## V96 tenant configuration regression certification
V96 binds an exact tenant configuration bundle hash to an exact synthetic scenario-suite hash and a successful bounded runner result. V94 activation now requires certification through an injected validation authority; failed/unavailable suites fail closed and scenario payloads are not persisted. See `docs/V96_CONFIG_VALIDATION.md`.


## V97 supply-chain attestation
V97 adds CycloneDX 1.7 SBOM generation shape plus an external-signature verification boundary binding artifact, SBOM, SLSA-style provenance and source revision hashes. Signature material remains outside application persistence and readiness can fail on artifact/source drift. See `docs/V97_SUPPLY_CHAIN_ATTESTATION.md`.

### V98 vulnerability evidence
V98 adds an SBOM-bound external vulnerability evidence boundary and critical/high release gate. VEX exceptions are exact finding/SBOM bound and require externally verified reviewed evidence; raw scanner/advisory/signature payloads remain outside application persistence.

### V99 exact dead-letter recovery
V99 adds exact-snapshot, attempt-preserving operator recovery for dead background jobs, with fail-closed risk classification and separate approval for high-risk replay.

### V100 outbound egress policy
V100 adds destination allowlisting, DNS/address pinning, private-network SSRF refusal and redirect-free outbound request plans for future managed integration clients.

### V101 dependency protection
V101 adds tenant-scoped circuit breaking, bounded dependency concurrency and full-jitter retry primitives for Graph/Proclaim/managed external dependencies.

### V102 graceful deployment drain
V102 adds shared-state deployment draining and readiness control so rolling deploys/maintenance do not accept new mutable work while in-flight operations finish.

### V138 recovery artifact evidence

Restore evidence now checks actual database/document bytes against a committed
inventory, verifies complete history and rolls recovery/audit rows back together.
See [V138 recovery evidence](docs/V138_RECOVERY_EVIDENCE_BATCH.md) for the bounded
local checker, trusted-provider contract and outstanding managed-restore limits.
