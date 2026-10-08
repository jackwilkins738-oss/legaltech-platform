# CURRENT STATE — AUTHORITATIVE

## Status
Research/scoping is advanced. Product-market evidence is not yet complete.

## Current product hypothesis
Inbound Legal Operations for Proclaim-based high-volume personal-injury teams.

Core flow:
Graph/document input → secure ingest → matter match → classification/extraction → action detection → policy → exception/human approval → Proclaim write-back → audit.

## Current ICP hypothesis
UK high-volume PI firms, roughly 50–250 Proclaim users, Microsoft 365, significant case/admin teams.

## Current practice-area order
1. Personal injury
2. Clinical negligence as a later adjacent vertical
3. Other high-volume litigation after evidence

## Current commercial motion
Workflow discovery/audit → paid narrow pilot → measurable ROI → department/firm expansion.

## Current architecture direction
Browser-first modular monolith with explicit connector boundaries, canonical Postgres model, object storage, queues/workers, AI gateway, Graph and Proclaim adapters, permission-aware search/RAG, and central audit.

## Current security posture
Security-by-design specification exists. No claim is made that certification/compliance has already been achieved. Tenant isolation, matter-level access, information barriers, safe document processing, auditability, backup recovery, incident response and AI permission boundaries are mandatory.

## Current pre-build state
Allowed: spikes, prototypes, mocks, evals, schema, connector proofs, security foundations.
Blocked: full PMS replacement, legal accounting, broad feature build, high-risk autonomous legal actions.

## Evidence still required
- TO study
- external customer interviews
- real Proclaim connector tests
- real Microsoft tenant integration test
- willingness-to-pay validation
- paid pilot candidate

## Top-spec verdict
NOT YET TOP SPEC. Structure and research are strong; decisive customer/operational evidence is still outstanding.


## Non-TO research status
Major desk-research and pre-build scoping is now substantially complete. See `NON_TO_RESEARCH_COMPLETION_STATUS.md`. Prioritise TO/customer evidence and controlled technical spikes rather than broad additional speculative research.


## Competitive expansion research — October 2026
A 20-company competitor and fastest-growth analysis is complete. It supports expanding around Matter Command, records/evidence orchestration, Firm Skills/workflow agents, matter intelligence, client updates, PI evidence workflows, cross-matter intelligence, Microsoft-native surfaces and migration-as-a-service. See the competition and product-expansion files in the master index.


## Pre-TO decision pack
A complete Pre-TO Scoping & Decision Pack now exists under `17_PRE_TO_SCOPING/`. It defines the scoring, technical validation, analysis, service scope, pilot economics, validation, red-team and decision gates to use when TO data arrives.


## Pre-TO execution pack
An execution-ready pack now exists under `18_PRE_TO_EXECUTION/`, covering Graph/document/Proclaim spikes, synthetic evaluation data, security abuse cases, external interviews, a conditional V1 PRD and evidence-to-decision protocol.


## Comprehensive gap audit — October 2026
A full repository gap audit has been completed. Twenty-six second-order domains are now scoped under `19_GAP_AUDIT_NEW_DOMAINS/`, including adoption, customer success, QA, FinOps, data quality, exit/export, accessibility, current SRA AI duties, UK automated-decision law, EU AI Act readiness, court/records workflows, founder/IP, finance, partner channels and supply-chain licensing.


## PI economics/ecosystem deep dive — October 2026
A deeper analysis of PI case economics and the surrounding service ecosystem now exists under `20_PI_ECONOMICS_AND_ECOSYSTEM/`. This adds fixed-cost stages, OIC/Claims Portal, MedCo, ATE/funding, disbursement exposure, Part 36/offer state, rehabilitation, experts, settlement completion, acquisition/referral compliance, complaints, PII risk, duplicate claims and external-party operations to the strategic model. The emerging long-term concept is a Matter Progression Operating System rather than only inbound automation.


## Engineering operating system — October 2026
The master repository is now Claude Code-ready for bounded technical spikes and the initial V1 build. `21_ENGINEERING_OPERATING_SYSTEM/` defines repository structure, agent roles, architecture guardrails, API/event standards, DB/migration rules, CI/CD, testing, security release gates, environment/secrets controls, observability, feature flags, release/rollback, Definition of Done and the first 50 engineering tasks. This does not remove TO/customer/Proclaim evidence gates.



## Final pre-evidence completeness pass
The `23_FINAL_COMPLETENESS/` pack completes the operational artifacts that can be responsibly prepared before real TO/customer/Proclaim evidence. New work should now be driven by observations, customer asks, implementation results or law/platform changes rather than additional speculative research.


## Desk-scoping closure
`24_SCOPING_CLOSURE/` now closes the remaining desk-scoping work: target validation campaign, provisional cloud/vendor choices, effort/risk estimates, economics sensitivity and a final assumption→experiment register. Further scoping should now be evidence-driven.


## TO Day-0 readiness
The partner observation kit is complete under `25_TO_DAY0_OPERATING_KIT/`, including observer instructions, anonymisation, taxonomy, role-cost assumptions, Proclaim questionnaire, first-30 analysis and decision-meeting template. Tomorrow's TO can begin without further process design.


## External validation execution ready
`26_EXTERNAL_VALIDATION_EXECUTION/` contains the target-account campaign, persona-specific interviews, anti-confirmation-bias rubric, validation gates, outreach sequence and execution workbook. External interviews can now run in parallel with TO.

## Final pre-TO execution readiness
A runnable synthetic spike harness exists under `27_PRE_TO_TECHNICAL_STARTER/` and passed all current local tests. `28_FINAL_PRE_TO_EXECUTION/` contains verified first outreach contacts, persona-specific outreach, tomorrow's parallel launch order, stop/pivot conditions and the final blocked-vs-done ledger. Further meaningful progress requires TO evidence, external responses, authorised customer access or representative data.


## Runnable pre-TO reference implementation
`29_PRE_TO_REFERENCE_IMPLEMENTATION/` now provides a dependency-light local HTTP reference service for tenant isolation, inbound idempotency, deterministic exact-reference matter matching, exception routing, audit, mock Proclaim write/read-back and basic hostile-upload checks. Latest local suite: 11/11 tests passing. This is not production or pilot software and does not prove real Graph/Proclaim behaviour.


## Persistent pre-TO reference foundation — V17
The synthetic reference implementation now includes SQLite-backed persistence, durable local job semantics, tenant-scoped content-addressed object storage, a minimal exception-review UI and CI. The full local suite passes 17/17 tests. These are reference primitives only; production Postgres/RLS, cloud storage/queue, SSO, Graph and Proclaim remain evidence/access-dependent.


## Production-shape scaffold running
`30_PRODUCTION_SHAPE_SCAFFOLD/` adds versioned PostgreSQL schema/RLS prototypes, auth/session contracts, worker lifecycle, observability redaction, environment validation, local Postgres compose setup and CI. Static/contract tests pass, while runtime PostgreSQL validation remains explicitly pending a real Postgres development environment.

## Dev reproducibility/control plane
`31_DEV_REPRODUCIBILITY_AND_CONTRACTS/` adds one-command repo/contract checks, deterministic synthetic reset/seed tooling, a local synthetic admin surface, API contract-change rules and an explicit pre-TO engineering stop line.


## Security regression automation
Repository-level checks now cover secret patterns, unsafe defaults, sensitive logging, mandatory security-test concepts, schema/event fingerprinting, and dependency/licence review hooks. These are development gates, not production certification.

## PRE-TO FINAL AUDIT AND LOCK
A repository-wide pre-TO audit found and corrected the main remaining measurement risk: mixing direct timing observations with repeated frequency/headcount assumptions. The active workbook now separates observation from volume validation, analyses at Task Family × Role, records sampling/session context, adds privacy/authorisation controls, and gates annualisation. See `33_PRE_TO_FINAL_AUDIT_AND_LOCK/00_PRE_TO_COMMAND_CENTRE.md`.

**Current status: PRE_TO_LOCKED.**
No further speculative feature/infrastructure work is necessary before first TO evidence. The priority is measurement quality.


## Future competitor map
A 40-platform 2026–2031 threat map is stored under `34_FUTURE_COMPETITOR_THREAT_MAP/`. It is strategic watchlist/disconfirmation input and does not alter the PRE_TO_LOCKED product decision.


## Deep pre-TO audit
A second-wave methodology/root-cause audit was added under `35_PRE_TO_DEEP_AUDIT/`. It strengthens sampling representativeness, system-data triangulation, Proclaim implementation-maturity diagnosis, adoption/change-backlog analysis, shadow-system capture, positive controls, rare-event handling, baseline KPIs and worker/client privacy implementation. Product scope remains frozen until TO evidence.


## Claude knowledge architecture
The repository now uses an authority-aware progressive-retrieval layer under `36_CLAUDE_KNOWLEDGE_ARCHITECTURE/`. Root `CLAUDE.md` is intentionally concise; domain instructions live in `.claude/rules/`; current/historical precedence is explicit in the authority and supersession registries. This changes navigation, not product evidence or phase gates.

## Pre-TO last-mile research-design state

A final research-design layer now exists at `37_PRE_TO_LAST_MILE_RESEARCH_DESIGN/`.
It adds observer blinding, two-pass live capture, second-level timing, observer-reliability checks, work-sampling fallback, robust timing statistics, process-mining readiness, raw-data lineage, workflow FMEA, metadata-quality auditing, queue/WIP analysis, transferability and cheapest-fix tests.

This does **not** reopen product scope. It strengthens the empirical method before the TO.

## Digital Pre-TO lock
The digital state is now frozen under `38_DIGITAL_PRE_TO_LOCK/`. Repository navigation/security/reference checks were rerun on the current master and passed. Post-TO empirical material must enter through `39_POST_TO_EVIDENCE/` and follow the RAW → CLEANED → ANALYSIS → DECISION → PRODUCT CHANGE gate. Speculative product scope remains frozen.


## Platform foundation build — V28
`40_PLATFORM_FOUNDATION_BUILD/` is the first coherent reusable platform implementation assembled under the D-018 pre-TO boundary. It proves a synthetic inbound event can move through durable ingest, safe attachment handling, deterministic matter matching, controlled AI classification, human approval, mock Proclaim writeback, read-back reconciliation, traceable audit and idempotent replay. New suite: 11/11 passing. Existing reference/security regression suites also pass. Commercial workflow logic remains evidence-gated; real Graph/Proclaim behaviour remains unproven.

## 2026-10-07 — Real platform coding started
The bounded pre-TO foundation build is now an actual runnable API service, not only a domain harness. Current `40_PLATFORM_FOUNDATION_BUILD` adds an authenticated HTTP boundary, server-derived tenant context, capability enforcement, safe not-found behaviour, idempotent inbound mutation, human exception resolution and a local-only synthetic dev server. Commercial workflow logic remains evidence-gated under D-018.


## 2026-10-07 — First visible application surface
`40_PLATFORM_FOUNDATION_BUILD/` now exposes a local synthetic browser UI backed by the authenticated `/api/v1` service. Current screens: My Work, Inbound Queue, Exception Review, Matters and Audit Trail. Human approve/reject actions operate through the existing permission/idempotency boundary and mock Proclaim reconciliation. Platform/API/UI suite: 22/22 passing. This does not change D-018: commercial workflow logic remains evidence-gated.

- 2026-10-07: Platform foundation V31 adds tested operator Exception Review UI (source, reasoning, matter context, approval/rejection, reconciliation, audit) using synthetic scenarios only. Product workflow remains TO-evidence gated.

## 2026-10-07 — Operations cockpit — V32
`40_PLATFORM_FOUNDATION_BUILD/` now presents My Work as an operations cockpit with a deterministic synthetic priority queue and matter-progression state cards. Matter detail explains whether the current synthetic matter is CLEAR, WAITING, IN PROGRESS or BLOCKED and links directly to related review work. The scoring is an operator-demo heuristic only; it is not a legal-risk, deadline or commercial-priority model. Platform/API/UI suite: 24/24 passing. D-018 remains intact and workflow-specific product logic remains TO-evidence gated.


## 2026-10-07 — High-tech command centre — V33
`40_PLATFORM_FOUNDATION_BUILD/` now presents the synthetic local app as a command-centre interface with live API health/latency telemetry, processing-pipeline state, live trace stream, AI confidence instrumentation, keyboard navigation and a command palette. Platform/API/UI suite: 25/25 passing before package smoke. This is an operability/UX upgrade only: deterministic demo priority remains non-legal, and D-018 / TO evidence gates remain unchanged.


## 2026-10-07 — Operator capability layer — V34
`40_PLATFORM_FOUNDATION_BUILD/` now adds global search, view filters, saved operator views, a derived attention feed, safe multi-select rejection and richer matter intelligence over the existing tenant-scoped synthetic API payloads. Bulk approval is intentionally prohibited; single-item approval retains matter selection, human decision and reconciliation controls. Platform/API/UI suite: 26/26 passing. This is an operability layer only and does not alter D-018, legal-risk logic, deadline authority or TO evidence gates.


## 2026-10-07 — Aurora enterprise visual system — V35
`40_PLATFORM_FOUNDATION_BUILD/` now has a full presentation-layer redesign named Aurora. The old accumulated visual layer was replaced with a distinct enterprise command-centre shell, secure workspace rail, telemetry/context fabric, redesigned operational surfaces and a denser three-pane Exception Review workspace. V34 operator capabilities and all existing security/human-control boundaries are preserved. Platform/API/UI suite: 27/27 passing before final package smoke. This is a UX/operability change only and does not alter D-018, legal-risk logic, deadline authority or TO evidence gates.

## 2026-10-07 — Integration readiness control plane — V36
`40_PLATFORM_FOUNDATION_BUILD/` now adds a tenant-scoped synthetic integration control plane. It models Microsoft Graph reader/write/send capability separation, mailbox allow-list metadata, subscription renewal/lifecycle and delta checkpoints; adds a Proclaim capability/validation harness with explicit BLOCKED live checks; and adds a production-shaped OIDC claims mapper that accepts only already-verified server-side claims. The Aurora UI includes an Integrations workspace for connector health and validation. Current platform suite: 32/32 passing. No real customer credentials, Graph mailbox, Proclaim endpoint or client data are used; real integration behaviour remains access/evidence-dependent and D-018 remains intact.


## 2026-10-07 — Connector reliability harness — V37
`40_PLATFORM_FOUNDATION_BUILD/` now includes synthetic integration reliability tooling for Graph-style notification deduplication, retry/dead-letter state, lifecycle attention, reconciliation checkpoints and operator recovery controls. This remains integration-test/evidence tooling under D-018; it does not add legal workflow scope or claim live Microsoft/Proclaim behaviour is proven.

## 2026-10-07 — Connector safety fixes — V38
Defect fixes in `40_PLATFORM_FOUNDATION_BUILD/` close cross-tenant integration
access, enforce mailbox/read scope, validate input and subscription expiry, prevent
rejected notifications from interfering with deduplication, constrain retry/recovery
transitions and audit HTTP connector mutations with actor/trace attribution.
The platform suite passes 51/51 tests. This is synthetic defect remediation under
D-018; product scope and live Graph/Proclaim evidence gates remain unchanged.

## 2026-10-07 — Durable writeback safety — V39
A reproduced writeback defect in `40_PLATFORM_FOUNDATION_BUILD/` permitted another
external call after an uncertain first outcome. V39 persists intent/receipts,
reconciles uncertainty using reads only, binds approval replay to one event/matter,
commits approval and audit atomically, scopes HTTP worker selection to the tenant,
and makes selected-event UI success contingent on read-back evidence. Operator
recovery is read-only. The platform suite passes 89/89 synthetic tests. This is
D-018 defect remediation; real Graph/Proclaim and product evidence gates remain.

## 2026-10-07 — Durable inbound safety — V40
Reproduced acceptance/processing failures in `40_PLATFORM_FOUNDATION_BUILD/` could
leave partial events, duplicate review exceptions and raw internal worker errors.
V40 makes database acceptance and processing/audit/job completion atomic, preserves
human decisions against late jobs, validates classifier shape and requires genuine
selected-event processing proof in the scenario UI. Platform suite: 111/111 synthetic
tests. D-018 scope and real integration/customer evidence gates remain unchanged.

## 2026-10-07 — Inbound request/replay safety — V41
Reproduced V40 request defects allowed changed-content replay, delimiter-qualified
cross-tenant cache collision and malformed upload decoding. V41 adds unambiguous
ingest scopes, owned-resource replay checks, durable normalized payload fingerprints
and shared HTTP/domain input validation. Historical attached replay fails closed
when original identity cannot be verified. Platform suite: 135/135 synthetic tests.
This is D-018 remediation; live integration and customer evidence gates remain.

## 2026-10-07 — Recovery/repository safety batch — V42
Observed exhausted inbound jobs appeared queued indefinitely, while catalogs included
ignored local runtime/download artifacts. V42 adds honest failed/stalled views,
audited tenant-bound recovery with preserved lifetime attempts, retired-worker guards
and UI recovery controls. Shared Git inventory excludes ignored local files without
deleting them. Platform: 157/157; inventory: 6/6 synthetic tests. Optional updater
commit/push is scoped and cannot merge. D-018 and live/customer evidence gates remain.

## 2026-10-07 — Review request safety — V43

A reproduced changed-notes replay defect is fixed in the existing synthetic human
review flow. Requests are validated and fingerprinted, notes persist atomically,
and cached decisions are checked against owned event/matter/job records. Historical
requests fail closed when unverifiable. Platform suite: 170/170 tests. Production
access, real connector proof, human security review and D-018 gates remain intact.

## 2026-10-07 — Writeback recovery scheduling safety — V44

A reproduced running-probe scheduling defect is fixed: fresh verification keys
reuse active read-only work without resetting its read budget or stacking jobs.
Cached recovery results verify owned command/job bindings. Platform: 183/183 tests.
No live integration, production access or new legal workflow scope is introduced;
human security review, connector evidence and D-018 gates remain unchanged.

## 2026-10-07 — Combined worker/recovery safety batch — V45

The V45 batch fixes reproduced lease-handoff and old-cycle budget corruption,
reserves shared read budgets durably, commits read-back/audit/job completion
atomically and explains SUPERSEDED results in the UI. Valid late owned-cycle
receipt/read-back evidence is retained conservatively. Download inventory and
publication guards preserve unrelated local work. Platform: 207/207 tests;
repository inventory: 9/9.
No schema reset, live connector or legal workflow expansion is introduced;
human security review and D-018/evidence gates remain unchanged.

## 2026-10-07 — Combined HTTP boundary safety batch — V46

Reproduced invalid-byte ingestion, ambiguous security headers, malformed route
classification and unexpected exception metadata exposure are fixed together.
Private immutable application-error envelopes also protect integration audit
failure reasons. Platform: 246/246, including 39 boundary tests. No production
access or legal workflow expansion; D-018 and human security review remain.

## 2026-10-07 — Combined attachment/storage safety batch — V47

Reproduced corrupt-object reuse, malformed reference acceptance, linked storage
paths and blocked filename aliases are fixed. Inbound processing verifies owned
attachment bytes before classification and completion; unavailable evidence cannot
become approvable. Platform: 293/293, including 47 new tests. Existing retry/review
flows remain; no automatic data repair, production access or new legal scope.
D-018 and human security review requirements remain unchanged.

## 2026-10-07 — Combined decision/recovery safety batch — V48

Reproduced approval cache/actor trust, unresolved exception bypass, post-processing
attachment loss and recovery attribution defects are fixed together. Writeback
validates immutable approval proof before external I/O. Tuple scopes and conservative
historical replay preserve existing data; no automatic repair or new legal scope.
Platform: 352/352, including 59 new tests. D-018, production evidence gates and
human security review remain unchanged.

## 2026-10-07 — Combined connector evidence safety batch — V49

Reproduced provider error/token exposure, false validation evidence, stale result
replacement and mutable registry records are fixed together. Read-only synthetic
validation now distinguishes PASS/NOT_TESTED/BLOCKED and does not claim live
readiness. Platform: 409/409, including 57 new cases. No schema reset, live calls,
new legal scope or production access; D-018 and human security review remain.

## 2026-10-07 — Combined writeback boundary safety batch — V50

Reproduced reconciliation attribution, lost-command resend, mutable approval proof,
invalid retry counters/flags and malformed adapter evidence defects are fixed
within the existing synthetic writeback path. Historical recovery is read-only;
late results cannot overwrite changed approval/job/receipt bindings.
Platform: 489/489, including 80 new cases. No schema reset, automatic data repair,
live calls or new legal scope; D-018 and human security review remain unchanged.

## 2026-10-07 — Combined inbound evidence safety batch — V51

Reproduced classifier metadata trust, stale source/match commits, incomplete inbound
claim fencing and the broken demo source are fixed in the existing synthetic path.
New classification evidence is bound through processing, human approval and dispatch;
recognized historical synthetic evidence retains its previous human gates.
Platform: 598/598, including 109 new cases and eight fixed synthetic contract samples.
No new legal scope, auto-action threshold, live model or production access is added.
D-018, integration evidence gates and human security review remain unchanged.


## 2026-10-07 — Combined authentication boundary safety batch — V52

Reproduced string capability grants, inherited/coerced OIDC identities, mutable
static registry records and delayed-body tenant/actor substitution are fixed within
the existing synthetic authentication path. Typed immutable request projections
precede retrieval and mutation; OIDC signature verification remains upstream.
Platform: 679/679, including 81 new cases. No production SSO, live credentials,
new legal scope or data migration is introduced. D-018, integration evidence gates
and human security review remain unchanged.


## 2026-10-07 — Combined review boundary safety batch — V53

Reproduced wrong-exception rejection, prior decision overwrite, audit-note duplication
and partial UI failure defects are fixed within the existing human review path.
Decisions validate owned record bindings and conditionally persist against the
original event/exception snapshots. Historical rejection replay remains conservative.
Platform: 763/763, including 84 new cases. No schema reset, live connector, new legal
scope or changed human decision threshold. D-018, integration evidence gates and
human security review remain unchanged.

## 2026-10-07 — Combined inbound recovery boundary batch — V54

Reproduced missing/contradictory job history, malformed counters/timestamps,
unsafe claim retirement and stale recovery commits are fixed within the existing
synthetic inbound path. Recovery requires owned typed evidence and conditional
writes; incomplete evidence is shown as unavailable without repairing history.
Platform: 851/851, including 88 new cases. No schema reset, live connector, new legal
scope or changed human decision threshold. D-018, integration evidence gates and
human security review remain unchanged.

## 2026-10-07 — Combined synthetic Graph boundary batch — V55

Reproduced mutable harness authority/state, partial clock-failure mutations and
inconsistent expiry snapshots are fixed in the existing synthetic Graph harness.
Tenant and retry settings are immutable, internal records/checkpoints are private,
and each operation validates one time observation before changing state.
Platform: 931/931, including 80 new cases. No live Graph semantics, credentials,
customer mailbox permissions, new legal scope or schema migration are introduced.
D-018, integration evidence gates and human security review remain unchanged.

## 2026-10-07 — Combined storage/attachment evidence boundary batch — V56

Reproduced ignored sidecar corruption, mutable root authority and malformed basic
file-check inputs are fixed within the existing synthetic attachment pipeline.
Owned hash/size/metadata evidence and bounded descriptor reads are checked before
acknowledgement; missing or inconsistent records are preserved for investigation.
Platform: 1024/1024, including 93 new cases. No migration, automatic repair, live
connector, production scanner or new legal scope. D-018, integration evidence gates
and human security review remain unchanged.

V56 Windows feedback identified 12 fixture cleanup failures from deleting a temporary
folder before SQLite close. The shared fixture now closes its stores first; all
assertions and publication gates remain. Native Windows rerun completed successfully on 2026-10-08: 1,110 tests, 1,105 passed, 0 failed, 5 skipped. The V56 SQLite fixture cleanup issue is verified closed on Windows.

## 2026-10-07 — Combined validation/registry evidence boundary batch — V57

Reproduced mutable Proclaim harness authority, sparse/forged history proofs and
exposed registry state are fixed in the existing read-only synthetic validation path.
Owned typed snapshots precede I/O; conditional registry writes and read-back prevent
stale or unverified acknowledgements from claiming persisted validation evidence.
Platform: 1110/1110, including 86 new cases. No Proclaim writes, live credentials,
customer access, data migration or new legal scope. D-018, integration evidence gates
and human security review remain unchanged. Requires corrected V56 on main.

## 2026-10-08 — Security hardening and production evidence gates — V58

The V58 security batch hardens tenant-consistent database relationships, restricted
matter membership, security zones, document overrides, matter-bound step-up
break-glass, append-only audit behaviour, production OIDC/configuration boundaries,
server-owned trace identity, hostile-file evidence semantics, connector credential/
payload constraints, API abuse bounds and CI/supply-chain controls. Platform: 1123/1123;
production-shape contracts: 27/27; security policy: 7/7; regression scan clean.
Real customer data remains fail-closed until managed infrastructure, live Graph and
Proclaim validation, restore/monitoring evidence and an independent penetration test
are completed. No new legal workflow scope or autonomous legal action is introduced.

## 2026-10-08 — Production identity boundary — V59

V59 replaces the injected-verifier-only production identity gap with bounded RS256/JWKS
verification primitives, exact issuer/audience/lifetime/directory-tenant policy, trusted
external-to-internal identity resolution, opaque server-side browser sessions, idle and
absolute expiry, provider-session revocation, exact-origin CSRF protection and MFA/auth-time
step-up evidence. Token-supplied LegalTech roles/capabilities are never authoritative.
Platform: 1133/1133; production-shape contracts: 28/28. No real Entra tenant, customer
credential, managed session service or client data is introduced; live Entra/Conditional
Access/CAE evidence remains required before the V58 real-data gate can pass.


## 2026-10-08 — Hostile document containment boundary — V60

V60 hardens the attachment path with explicit MIME/signature checks, bounded archive metadata inspection, path-traversal/macro/nested-archive/decompression-bomb rejection, object-bound malware-scan evidence and isolated-parser evidence. Production document mode fails closed before AI and approval until clean isolated evidence exists; infected or forged evidence cannot authorize Proclaim writeback. Platform: 1147/1147; production-shape contracts: 29/29; security policy: 9/9. No live malware scanner, parser sandbox, quarantine store or customer document is claimed; those remain external evidence gates.
