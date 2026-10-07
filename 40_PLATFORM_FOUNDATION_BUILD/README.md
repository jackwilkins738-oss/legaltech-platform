# Platform Foundation Build

**Lifecycle:** current engineering foundation, product workflow still evidence-gated.

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
