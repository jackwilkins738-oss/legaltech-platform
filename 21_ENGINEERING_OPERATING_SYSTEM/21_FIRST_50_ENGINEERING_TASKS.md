# FIRST 50 ENGINEERING TASKS

These tasks are ordered to reduce risk, not maximize visible features.
Do not start later phases simply because earlier tasks are easy.

## Foundation — ENG-001 to ENG-010

### ENG-001 — Create code monorepo scaffold
Acceptance: target structure exists; build/test commands documented.

### ENG-002 — Add protected CI baseline
Lint, typecheck, unit test, secret/dependency scan.

### ENG-003 — Create local Postgres/object-store/queue development stack
One command starts/stops; synthetic only.

### ENG-004 — Define environment configuration schema
Typed config; fail fast on missing required values.

### ENG-005 — Add structured logging + trace IDs
No content logging by default.

### ENG-006 — Implement Tenant entity/repository
Tenant IDs immutable.

### ENG-007 — Implement User/Team/Role skeleton
No complex policy yet.

### ENG-008 — Implement server-side authorization interface
Default deny; unit tests.

### ENG-009 — Add first cross-tenant isolation test suite
Tenant A cannot read/write Tenant B objects.

### ENG-010 — Implement append-oriented AuditEvent envelope
Actor/action/object/outcome/trace/source.

## Canonical data — ENG-011 to ENG-017

### ENG-011 — Implement Matter canonical model
Tenant, ref, client display, stage, handler, external mappings.

### ENG-012 — Implement ExternalMapping model
Connector + external ID + internal object.

### ENG-013 — Implement Communication model
Inbound metadata; content reference; source IDs.

### ENG-014 — Implement Document + DocumentVersion model
Hash/provenance/security metadata.

### ENG-015 — Implement Task model
Owner/due/source/status/risk.

### ENG-016 — Implement Exception model
Type/priority/reason/owner/resolution.

### ENG-017 — Implement InboundEvent + processing-state model
Durable state machine.

## Graph ingest — ENG-018 to ENG-025

### ENG-018 — Define Graph adapter interface + fake implementation
No Microsoft dependency in domain.

### ENG-019 — Create test Entra app configuration/runbook
Dev/test only; least privilege.

### ENG-020 — Implement webhook validation endpoint
Fast acceptance; verify clientState/signature requirements as applicable.

### ENG-021 — Persist Graph subscription/checkpoint state
Expiry/tenant/mailbox.

### ENG-022 — Implement notification dedupe + queue enqueue
Replay-safe.

### ENG-023 — Implement message fetch to canonical communication
Synthetic/test mailbox.

### ENG-024 — Implement attachment fetch into quarantine
No trusted parsing yet.

### ENG-025 — Implement delta reconciliation + subscription lifecycle job
Recover missed/removed/expired subscriptions.

## Document safety — ENG-026 to ENG-031

### ENG-026 — Implement file hash/type/size validation
Extension not trusted.

### ENG-027 — Add malware-scanner abstraction + fake scanner
Production vendor TBD.

### ENG-028 — Implement quarantine/clean/rejected document states
No parser before clean.

### ENG-029 — Implement isolated text-extraction worker interface
Parser crash contained.

### ENG-030 — Implement duplicate-document policy
Hash/version behavior tested.

### ENG-031 — Add hostile-file regression corpus
Mismatch, malformed, archive, encrypted, injection text.

## Matter matching/review — ENG-032 to ENG-038

### ENG-032 — Implement deterministic matter-candidate rules
Exact matter/claim refs first.

### ENG-033 — Implement candidate scoring contract
No auto-file threshold yet.

### ENG-034 — Build review queue API
Unmatched/low-confidence/failed states.

### ENG-035 — Build Inbound Queue UI
Filters/status/source/confidence.

### ENG-036 — Build Review Drawer UI
Source + candidate evidence + approve/edit/reject.

### ENG-037 — Persist human corrections/provenance
Correction never overwrites history.

### ENG-038 — Add adversarial matter-match test dataset
Same surname, conflicting refs, multi-matter sender.

## Proclaim adapter — ENG-039 to ENG-044

### ENG-039 — Define Proclaim adapter contract
Search/read/history/upload/task/update/reconcile capabilities.

### ENG-040 — Implement deterministic mock Proclaim server/adapter
Simulate success, 4xx, timeout, duplicate, unavailable.

### ENG-041 — Implement idempotent write wrapper
State includes OUTCOME_UNKNOWN.

### ENG-042 — Implement reconciliation/read-back workflow
No blind retry after unknown outcome.

### ENG-043 — Build connector health endpoint/admin status
No secrets displayed.

### ENG-044 — Execute authorised real Proclaim spike
Record GREEN/AMBER/RED; production implementation only after evidence.

## AI/evaluation — ENG-045 to ENG-048

### ENG-045 — Implement AI gateway contract
Provider/model/prompt/version/cost/latency/structured output.

### ENG-046 — Implement synthetic classification/extraction evaluation runner
Dataset version + metrics persisted.

### ENG-047 — Add prompt-injection/tool-policy tests
Documents cannot widen permission/action scope.

### ENG-048 — Add AI suggestion to review drawer
Suggestion only; source/provenance visible.

## Vertical slice / pilot gate — ENG-049 to ENG-050

### ENG-049 — Build full synthetic E2E inbound flow
Email → quarantine → matter candidates → review → mock Proclaim write/readback → audit.

### ENG-050 — Run V1 engineering gate review
Produce pass/fail report covering security, reliability, eval, observability, Proclaim evidence and remaining pilot blockers.

## Rule after ENG-050
Do not immediately build tasks 51+.
Use TO/customer/technical evidence to decide the next backlog.
