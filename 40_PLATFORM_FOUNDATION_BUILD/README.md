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
