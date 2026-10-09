# CURRENT STATE — AUTHORITATIVE

## V118 — Shared identity and tenant transaction foundation

V118 adds a PostgreSQL session/revocation store, separate identity-broker role, current-permission refresh and asynchronous cookie exchange/logout wiring. The domain transaction boundary binds UUID tenant/actor context to one connection and discards failed, timed-out or contaminated backends. Migration 047 and a dedicated real PostgreSQL CI integration check cover the shared path. See `40_PLATFORM_FOUNDATION_BUILD/docs/V118_SHARED_IDENTITY.md`.

Local suites pass 1,791 platform and 138 scaffold tests; the real PostgreSQL integration test is skipped here because PostgreSQL is unavailable. Its new PR job must pass before merge. Actual deployed role/provider validation, remaining shared security adapters and full production composition remain outstanding. This is an authorised D-018 security/integration exception; the customer-data deployment gate and pre-TO freeze remain in force.

## V117 — Enforced production admission and executable database checks

V117 closes the readiness/data-route bypass, prevents stale healthy probes restoring admission after invalidation, awaits HTTP rate/monitor/audit callbacks, and blocks built-in synthetic adapters in production mode. Production readiness requires all 13 critical provider/control probes. Migration 046 forces RLS on six incident/configuration tables; runnable direct-runtime PostgreSQL catalog and synthetic isolation checks were added. See `40_PLATFORM_FOUNDATION_BUILD/docs/V117_PRODUCTION_ADMISSION.md`.

This is an authorised D-018 security-defect exception. Shared production adapters/composition, actual PostgreSQL execution and live operational validation remain outstanding. No live database check has been completed here. Pre-TO freeze and the customer-data deployment gate remain in force.

## V116 — Confirmed security defect fixes

V116 fixes restricted matter-candidate disclosure, support scope separation, failed-audit support activation, expanded IPv6 egress classification, asynchronous document-redemption races, export permission freshness and signing-key refresh abuse. Nineteen counterexample regressions were added; the full platform suite passes 1,758 tests. This is a defect-fix exception under D-018, not speculative feature expansion. See `40_PLATFORM_FOUNDATION_BUILD/docs/V116_SECURITY_DEFECT_FIXES.md`.

Production composition/admission, shared durable security state, executable PostgreSQL isolation checks and deployed operational validation remain outstanding. Pre-TO freeze and the customer-data deployment gate remain in force.

## V115 — Practical TO evidence tooling

V115 adds a local CLI for canonical field templates, validation-only preflight and aggregate reporting through the existing V66/V75 model. Reports require fully valid cleaned input and an explicit working-day assumption; source files are unchanged and outputs cannot overwrite existing files. No persistent customer data store, network integration or final workflow is introduced. See `40_PLATFORM_FOUNDATION_BUILD/docs/V115_TO_FIELD_CLI.md`.

Pre-TO development now pauses under D-018 except for identified defects, evidence-tooling gaps or authorised integration tests. The next milestone is partner observations and evidence analysis; V116 is not a prerequisite for the TO. This is not a production-readiness claim.

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

## 2026-10-08 — Connector credential containment boundary — V61

V61 hardens the future live Graph/Proclaim credential path with strict managed-secret references, tenant/kind/purpose-bound brokered resolution, short-lived zeroised secret bytes, durable durable generation rollback protection after rotation, revocation/expiry checks, direct secret-egress blocking, registry secret rejection and public integration-response redaction. Production config now requires workload/federated identity to the managed secret store, no plaintext connector-secret cache and least-privilege connector identities; real-client-data mode additionally requires rotation/revocation/audit evidence. Platform: 1167/1167; production-shape contracts: 31/31; security policy: 10/10; regression scan clean. No live vault, Graph or Proclaim credential is introduced or claimed.


## 2026-10-08 — Security monitoring, audit integrity and incident detection — V62

V62 makes the synthetic audit ledger hash-chained and self-verifying, preserves append-only audit/security-alert records, and adds bounded incident signals for privileged connector actions, break-glass use, session-context changes, bulk reads, unusual cross-matter access and connector-failure bursts. Network/user-agent context is hashed rather than persisted raw. Production configuration now requires managed security monitoring, a managed central alert sink, strict redaction, server-generated incident correlation, explicit retention configuration and SHA-256 audit chaining; real-client-data mode additionally requires reviewed alerting, anomaly/exfiltration, break-glass, connector-abuse, retention and audit-chain evidence. Platform: 1178/1178; production-shape contracts: 33/33; security policy: 11/11; regression scan clean. No live SIEM/SOC or customer data is introduced or claimed.


## 2026-10-09 — Backup, restore and ransomware recovery resilience — V63
V63 adds a synthetic/reference recovery-safety boundary: immutable tenant-bound backup manifests, monotonic backup generations, separate credential/key boundaries, append-only hash-chained recovery evidence, two-person restore authorization, isolated restore targets and explicit integrity verification before a restore can be considered proven. Production configuration now fails closed without immutable managed backup, workload identity, separate KMS, two-person delete protection, PITR, durable recovery evidence, isolated ransomware recovery and clean restore targets. Real-client-data mode additionally requires reviewed evidence for immutability, PITR, credential/key isolation, restore integrity, dual control and a ransomware recovery drill. No live backup provider, live PITR or production recovery drill is claimed.


## 2026-10-09 — Generic work orchestration foundation — V64
V64 adds pre-TO workflow primitives without locking the product to assumed legal processes: typed work, explicit lifecycle states, user/role/team/pool ownership, optimistic concurrency, idempotent creation, matter-bound work, dependency graphs with cycle prevention, internal-wait/reactivation semantics, structured request responses, queue filtering and baseline flow telemetry. Production-shaped tables use tenant-composite foreign keys, forced RLS and append-only work events. Exact Legal Admin/Case Manager/Team Leader routing, SLAs, dashboards and escalation rules remain TO evidence decisions.


## 2026-10-09 — Versioned workflow runtime, feature flags and notification intents — V65
V65 adds generic post-TO execution infrastructure without defining the workflows themselves: finite validated workflow graphs, immutable published definitions, hash/version-pinned instances, bounded execution, idempotent signals, tenant feature flags for pilots/kill switches and notification intents for in-app/Teams surfaces. Workflow actions can create V64 work items or notification intents but cannot directly perform Graph/Proclaim writes. Exact legal processes remain evidence-driven.

## 2026-10-09 — Time-and-motion evidence and flow baseline foundation — V66
V66 converts the TO operating rules into workflow-agnostic evidence infrastructure: anonymised observation aliases, measured-versus-estimated timing, internal/external wait separation, dependency/request classifications, append-only correction history, task-family flow analysis and guarded annualisation. Annualisation refuses fewer than five measured timing samples and refuses interview-only frequency/headcount claims; independently validated frequency and roster/system evidence are required. No Co-op-specific workflow, SLA or automation conclusion is encoded.

## 2026-10-09 — Generic delegation and operational flow intelligence — V67
V67 adds time-bounded user/role/team/pool delegation with overlap/cycle protection, versioned revocation and append-only routing evidence. It also adds aggregate flow snapshots for queue age, overdue work, internal/external/blocked waits, active dependencies, request response latency and downstream work/matters blocked by each generic owner. Snapshots omit work titles and matter identifiers. No Co-op-specific escalation ladder, SLA or automatic reassignment policy is encoded before TO evidence.

## 2026-10-09 — Configurable response targets and escalation intents — V68
V68 adds versioned/published response-target policies over created/waiting/due clocks, bounded selectors and two safe outcomes: queue a notification intent to the current owner or create a separate escalation work item for a configured generic owner. Each policy-version/source-work pair deduplicates to one auditable intent; generated escalation work cannot recursively trigger itself, and the source work is never silently reassigned. No SLA values or role ladder are encoded before TO evidence.

## 2026-10-09 — Matter-aware work authorization — V69
V69 adds a reusable authorization boundary for V64–V68 work objects. Work access remains subordinate to tenant, matter, restricted-visibility and security-zone controls; self ownership is derived only from trusted USER/ROLE identity context, while TEAM/POOL membership is deliberately not inferred. Requesters may retain bounded read visibility without gaining owner mutation authority. Flow intelligence and policy administration use distinct capabilities, with recent step-up required for policy management by default. No firm-specific role hierarchy, team directory, API surface or TO conclusion is encoded.

## 2026-10-09 — Bounded work API — V70
V70 exposes the generic work/request model through authenticated create/read/list/event/state/respond/assign endpoints. All work access is mediated by V69 authorization; tenant, requester, actor and trace identity are server-owned; pagination and filters are bounded; stale optimistic mutations return bounded conflicts; and client-supplied identity fields are refused. The synthetic development server wires the API for test/demo use only. No final legal-admin/case-manager UI, firm queue design or TO-derived workflow is introduced.

## 2026-10-09 — Trusted organisation membership — V71
V71 adds generic TEAM/POOL group and membership evidence so shared work ownership can be authorized from server-side tenant data. Memberships are time-aware, revocable, overlap-protected and fail closed on directory errors; group/member identity is immutable through lifecycle transitions and directory events are append-only. V69 remains backward-compatible and only grants group-derived self authority when an explicit trusted resolver is injected. No Co-op team names, hierarchy or routing assumptions are encoded.

## 2026-10-09 — Durable response-policy evaluation worker — V72

V72 turns the generic V68 response-target policy definitions into a schedulable but still workflow-agnostic evaluation boundary. Jobs pin the exact published policy version/hash, scan bounded pages, emit continuation jobs, recover expired claims and preserve idempotent escalation materialisation. Individual item failures are isolated and recorded only as bounded evidence; retired or changed policies cannot be substituted after scheduling. Notification actions remain intents only and escalation actions do not reassign source work. No firm-specific SLA, scheduler cadence, hierarchy or live external delivery is introduced before TO evidence.

## 2026-10-09 — Bounded notification delivery containment — V73
V73 adds a tenant-scoped, lease-recoverable delivery boundary for generic V65 notification intents. External adapters receive only structured template/object references; arbitrary matter content and credential material are not passed through the delivery envelope. Provider delivery references are persisted only as SHA-256 hashes, raw adapter errors are suppressed, retries are capped, expired intents fail closed, and delivery evidence is append-only. In-app delivery remains local and Teams requires an explicitly injected adapter. No live Teams tenant, messaging credential, production transport or TO-derived notification policy is introduced.

## 2026-10-09 — Opaque work pagination and queue read-model hardening — V74
V74 removes numeric work-queue cursors from the authenticated API and replaces them with AES-256-GCM authenticated cursors bound to tenant, normalized queue filters and a short expiry. Tampered, expired, cross-tenant and cross-filter cursor reuse fails closed; pagination no longer reveals the underlying skipped offset when authorization filters hide work. The scan remains bounded per request and fixes the prior page-consumption bug that could skip unread items when a visible-page limit was reached. Production-shaped work indexes now cover user/group ownership, state/type ordering and matter queues. No final Legal Admin/Case Manager queue design, SLA or Co-op workflow is encoded.

## 2026-10-09 — TO field intake and evidence report — V75
V75 makes the V66 study model usable for the incoming partner fieldwork without changing its evidential rules. A canonical anonymised CSV format supports bounded preflight and row-isolated idempotent import; invalid rows return bounded codes without echoing raw field content, and PII-like notes, interview-as-measured timing, malformed aliases and inconsistent dependency fields still fail closed. The field report separately ranks observed task burden, internal dependency roles, role×task evidence and system use while carrying V66 annualisation gates forward. No automation score, labour-saving percentage, Co-op workflow conclusion or guessed frequency/headcount is generated.


## 2026-10-09 — Operational readiness and degraded-mode controls — V76
V76 separates process liveness from dependency-aware readiness. Critical dependency failure now produces a bounded `NOT_READY`/503 result while optional dependency failure is explicit `DEGRADED`; public readiness responses never expose dependency names or raw failures. Probe execution is finite, timed, cached and concurrency-coalesced so the public readiness endpoint cannot become an unbounded dependency-amplification path. Production configuration requires process-only liveness, dependency-aware readiness and fail-closed failure semantics. No live production topology, availability SLA, failover provider or TO-derived workflow is introduced or claimed.


## 2026-10-09 — Migration and release integrity — V77
V77 hash-pins the complete production-shaped SQL migration sequence and rejects changed history, gaps, unexpected files, symlink substitution and applied-schema order/checksum drift. Destructive data/schema SQL requires an explicit bounded review reference and schema compatibility can now fail V76 readiness closed when migrations are pending or drifted. Production configuration requires hash-pinned manifests, externally controlled migration execution, reviewed destructive changes and required schema readiness. No live production migration, downtime claim or rollback rehearsal is asserted.


## 2026-10-09 — Authenticated read-volume containment — V78
V78 adds a hard actor+tenant read-volume ceiling across protected authenticated collection/detail surfaces alongside V62 bulk-read monitoring. Visible record counts and distinct matter counts are accumulated across endpoints and checked before response egress; denied reads return a bounded 429 without the data payload, and rejected attempts do not partially mutate budget state. Work queue and work-event reads now feed the same monitoring/containment path. Production configuration requires managed shared read-volume enforcement; no role-specific quota or TO-derived productivity threshold is encoded.


## 2026-10-09 — Data lifecycle, legal holds and disposition approval — V79
V79 introduces tenant-scoped versioned retention policies without a default retention period, matter/resource legal holds, policy-pinned disposition intents and second-actor approval. Active holds are checked both when planning and approving; a newly published policy invalidates pending plans based on older retention evidence. Lifecycle evidence is append-only in the production shape and there is deliberately no automatic deletion worker. Production requires externally controlled disposition and real-client-data mode requires reviewed retention-policy, legal-hold and data-disposition procedure evidence. No firm-specific retention rule or legal conclusion is encoded.


## 2026-10-09 — Release and configuration provenance — V80
V80 adds a secret-free fingerprint over an explicit security-configuration allowlist and binds it with source revision, package version, artifact digest and migration-manifest digest into a canonical release identity. A readiness adapter fails closed on release drift, while bounded fleet assessment distinguishes mixed releases from configuration drift without returning environment content. Production requires verified provenance/fingerprint modes and real-client-data mode requires reviewed provenance/drift-monitoring evidence. No live attestation service, signed SBOM or production fleet is claimed.

## 2026-10-09 — Controlled data export and download containment — V81
V81 adds a generic data-egress boundary without defining a legal workflow or final export surface. Export requests contain only bounded resource references and are created only after server-owned per-resource authorization; manifests/packages are hash-bound, storage readiness requires managed evidence, and download grants are tenant/actor/export-bound, short-lived and single-use. Production-shaped storage uses tenant RLS, immutable resource identity and append-only export evidence; public links and arbitrary external delivery are disabled. No production renderer, live export bucket, customer export policy or post-TO reporting requirement is claimed.

## 2026-10-09 — Security incident interlocks and egress kill switches — V82
V82 adds generic tenant-scoped emergency interlocks over high-risk operation classes without changing legal workflow. Server-authorized controls can halt all egress or narrower Proclaim-write, external-notification, export, connector-use and new-session paths; interlocks do not silently expire, and release requires a distinct authorized actor. Production-shaped state is tenant/RLS-bound with immutable activation identity and append-only evidence. No live SOC control plane, customer incident process or automatic security decision is claimed.

## 2026-10-09 — Production change governance — V83
V83 adds workflow-agnostic dual-control for normal production behavior changes. Proposals are tenant/type/reference/SHA-256 bound, explicitly expiring, separately approved and single-use; changed targets fail closed. The reference boundary is consumed by workflow publication, response/escalation policy publication, feature-flag changes and retention-policy publication when configured, while V82 emergency interlocks remain immediate and independent. Production shape adds forced-RLS evidential change requests/events and production modes requiring hash-bound approval. Platform: 1,455/1,455; production-shape: 67/67; security policy: 19/19; regression scan clean; knowledge lint 0/0; demo reconciled. No Co-op-specific approver hierarchy, workflow, SLA or legal process is encoded before TO evidence.

## 2026-10-09 — Worker execution identity and exact claim binding — V84
V84 adds workflow-agnostic short-lived execution grants bound to tenant, worker type, exact queued object, service identity and trace. When configured, inbound processing, Proclaim writeback, response-policy evaluation and notification delivery claim only the grant-bound object rather than arbitrary next work; replay fails closed. Production shape stores only grant fingerprints and append-only execution evidence and requires managed workload identity plus durable single-use replay control. Platform: 1,466/1,466; production-shape: 69/69; security policy: 20/20; regression scan clean; knowledge lint 0/0; demo reconciled. No live workload-identity provider or production queue broker is claimed.

## 2026-10-09 — Audit checkpoint and rollback detection — V85
V85 extends the tamper-evident audit chain with externally anchorable, tenant-bound checkpoints that detect valid-but-shorter rollback/truncation and alternate-history forks. The platform stores only checkpoint/head hashes plus a hash of the external anchor reference; raw anchor references and audit contents are excluded. Production shape adds forced-RLS append-only checkpoint evidence and fail-closed production/real-data gates. No live external anchor provider or checkpoint cadence is claimed. Final validation counts are recorded in `40_PLATFORM_FOUNDATION_BUILD/TEST_RESULTS_V85.md`.

## 2026-10-09 — Secure document delivery — V86
V86 adds a generic server-resolved individual-document delivery boundary. Grants are short-lived, actor/tenant bound, single-use, tied to the authorized matter/document identity, and never expose raw object-storage references. Authorization and document binding are rechecked at redemption; storage integrity and V82 `ALL_EGRESS` interlocks are enforced. Production shape adds forced-RLS immutable grant/consumption evidence and append-only events. No public-link/CDN/viewer implementation or live distributed grant store is claimed. Final validation counts are recorded in `40_PLATFORM_FOUNDATION_BUILD/TEST_RESULTS_V86.md`.

## 2026-10-09 — Managed encryption key lifecycle metadata — V87
V87 adds generic tenant/purpose key-generation metadata for managed envelope encryption. Generations are monotonic; rotation makes prior generations decrypt-only; retirement requires external evidence and removes decrypt eligibility. Production shape enforces one ACTIVE generation, immutable identity, constrained transitions, forced RLS and append-only events. No key material, live KMS/HSM integration or completed production rotation is claimed. Final validation counts are recorded in `40_PLATFORM_FOUNDATION_BUILD/TEST_RESULTS_V87.md`.

## 2026-10-09 — Just-in-time support access — V88
V88 removes the need for a standing production support super-admin by introducing short-lived, exact-resource support grants. Request and approval both require recent step-up; the approver must be a different actor; access is bound to the requester, tenant, matter, scope and optional exact document; expiry is capped at 15 minutes and revocation fails access closed. Support access is read-only and can flow through the existing V86 secure document-delivery boundary rather than creating a raw-storage bypass. Production shape adds forced-RLS append-only request/approval/revocation/use evidence with hashed ticket, purpose and document references. No customer support hierarchy, ticketing provider, write privilege or tenant-wide support role is encoded. Final validation counts are recorded in `40_PLATFORM_FOUNDATION_BUILD/TEST_RESULTS_V88.md`.

## 2026-10-09 — Microsoft Graph webhook ingress authenticity and replay containment — V89
V89 separates external callback receipt/acknowledgement from trusted dispatch. Basic notifications require a known active server-side subscription, exact subscription binding, constant-time clientState validation and directory-tenant agreement; the internal application tenant is resolved only from the stored subscription. Rich notifications additionally require trusted validation-token claims bound to tenant, app and Microsoft Graph's notification publisher identity. Durable production evidence stores only hashes/fingerprints with forced RLS and append-only semantics. No live Microsoft Graph webhook, managed ingress queue or JWT/JWKS verifier is claimed. Final validation counts are recorded in `40_PLATFORM_FOUNDATION_BUILD/TEST_RESULTS_V89.md`.

## 2026-10-09 — Microsoft Graph subscription lifecycle and durable registry — V90
V90 adds the server-owned subscription lifecycle authority behind V89 webhook validation. clientState is generated server-side and held only through a managed secret reference; registry state binds tenant, directory tenant, resource hash, subscription identity, expiry and monotonic generation. `missed` events fail webhook resolution closed until separately evidenced recovery, `subscriptionRemoved` requires replacement, and renew/reauthorize operations are collision-guarded. Production shape adds forced-RLS registry state and append-only lifecycle evidence without raw Graph resources or clientState bytes. No live Microsoft Graph subscription API, managed secret provider or automatic renewal scheduler is claimed. Final validation counts are recorded in `40_PLATFORM_FOUNDATION_BUILD/TEST_RESULTS_V90.md`.

## 2026-10-09 — Durable Microsoft Graph webhook queue and validation worker — V91
V91 adds the managed-queue reference boundary behind V89/V90. Receipt performs only bounded ephemeral staging and acknowledgement; a lease-recoverable worker performs authenticity validation and dispatch. Retryable dependency/dispatch failures are retried without losing the notification fingerprint, while invalid notifications dead-letter. Duplicate/replayed notifications may be presented to an idempotent downstream dispatcher, which prevents transient post-validation failures from becoming permanent notification loss. Terminal queue items drop raw payload content and retain only bounded hash/state/count evidence. Production requires isolated managed queueing, workload identity, ephemeral payload retention and fingerprint-idempotent dispatch. No managed queue provider or live worker deployment is claimed. Final validation counts are recorded in `40_PLATFORM_FOUNDATION_BUILD/TEST_RESULTS_V91.md`.

## 2026-10-09 — Graph delta recovery and opaque checkpoint safety — V92
V92 adds bounded recovery for missed Microsoft Graph notifications. Opaque `nextLink`/`deltaLink` URLs are origin-pinned to Graph v1.0, terminal delta state is stored only through managed secret references, dispatch is explicitly retry/idempotency aware, and a V90 subscription cannot reactivate until a terminal checkpoint is secured. Production-shaped checkpoint/evidence tables are tenant-bound, forced-RLS and append-only. No live Graph credential, deployed delta worker, scheduler or production recovery drill is claimed.


## 2026-10-09 — Incident response evidence and containment lifecycle — V93
V93 adds a generic tenant-scoped incident authority around the existing V82 emergency interlocks. Incidents and evidence persist only bounded codes/hashes/references, containment reuses fail-closed interlocks, recovery is evidence-bound and closure requires a distinct actor after all active interlocks are released. Production-shaped incident evidence/events are append-only and real-client-data mode requires external incident-response validation. No live SIEM/SOAR, forensic repository, breach-notification procedure or regulatory conclusion is claimed.


## 2026-10-09 — Tenant configuration versioning and rollout safety — V94
V94 adds tenant-scoped immutable configuration bundles over server-validated workflow/policy/flag references. Bundles are version/hash bound, activation consumes an exact V83 approval, and reactivating an older published version creates append-only rollback evidence instead of editing live configuration in place. This provides a safe post-TO rollout mechanism without encoding any Co-op workflow or SLA before field evidence exists.


## 2026-10-09 — Synthetic workflow simulation and impact preview — V95
V95 adds side-effect-free execution of the same bounded V65 workflow definitions against caller-validated synthetic scenarios. It projects task/notification/branch behavior, stops at waits, returns context hashes rather than scenario values and supports before/after impact comparison. Production configuration requires isolated no-side-effect mode and synthetic-only data. This provides a safe way to validate TO-derived workflow designs before activation without using client data.


## 2026-10-09 — Synthetic regression certification for tenant configuration — V96
V96 requires exact-bundle synthetic regression evidence before V94 configuration activation. Certification is bound to tenant, bundle key/version/hash and scenario-suite hash; only bounded pass/fail counts, runner version and evidence hashes persist. Runner failure or any failed scenario produces no certification. This creates a software-regression gate for post-TO workflow rollout without treating synthetic tests as legal validation.


## 2026-10-09 — SBOM and build-provenance attestation boundary — V97
V97 adds a CycloneDX 1.7 SBOM shape and external-verifier attestation boundary over release artifact, SBOM, provenance and source-revision hashes. The application does not create or persist signing keys or raw signature envelopes; verified evidence is append-only digest/reference metadata and readiness can fail on deployment drift. The intended provenance shape aligns with SLSA v1.2, but no production SLSA level is claimed until external CI/build evidence exists.

## V98 — Vulnerability evidence and release gate
- Exact-SBOM external scan evidence is verified before release assessment.
- Critical/high findings block by default; only reviewed signed VEX `NOT_AFFECTED`/`FIXED` evidence can clear the exact finding.
- Durable evidence is append-only hash metadata; no embedded vulnerability database or raw scanner/VEX payload is claimed.

## V99 — Exact dead-letter recovery
- Failed background work can only be recovered by exact immutable job snapshot, never arbitrary payload replay.
- Retry attempts are preserved; high-risk recovery requires dual control and all recovery evidence is append-only/hash-bounded.

## V100 — Outbound egress / SSRF containment
- Server-owned purpose-specific HTTPS allowlists, DNS resolution pinning, private-network refusal and redirect blocking protect outbound integrations.
- Trusted private services require exact resolved-address configuration; this does not replace network-level egress controls.

## V101 — Dependency outage/backpressure containment
- Circuit and concurrency state is tenant+dependency isolated, with single half-open probes and bounded full-jitter retry guidance.
- Production requires a shared managed state implementation to prevent per-instance retry storms.

## V102 — Graceful deployment drain
- New ingress/background/side-effect work stops immediately during drain while existing leases complete.
- Readiness remains unready until an authorized resume; production requires shared managed drain state.

V103 adds a generic tenant lifecycle/offboarding boundary. New tenants begin PROVISIONING; ACTIVE tenants can be suspended without deleting evidence; OFFBOARDING blocks new ingress/background/side effects while preserving bounded read/support plus audit/recovery; OFFBOARDED preserves only audit/recovery. Completion requires externally evidenced export/retention readiness and no automatic deletion is introduced. No firm-specific offboarding or retention rule is encoded.

V104 adds workflow-agnostic access recertification evidence. Campaigns are bound to exact hashed membership snapshots, reviewer and closer duties are separated, every item receives an explicit RETAIN/REVOKE decision, and revoke candidates are surfaced for deliberate directory action rather than automatic access mutation. Review freshness is policy-driven with no hard-coded cadence.

V105 adds explicit field-level data classification/handling policy with deny-by-default sink projection. Unclassified fields fail closed; missing sink rules deny; and RESTRICTED values cannot be configured for raw logging or notification delivery. Policies are tenant-scoped/versioned and do not infer a firm-specific legal data taxonomy.

V106 adds tenant/resource admission quotas with no hard-coded business limit. Shared production enforcement is required; reservations prevent concurrent overcommit; failed operations release reservations; and idempotent work replay does not consume additional capacity. Generic work creation is the first consumer, providing noisy-neighbour containment without encoding TO-derived productivity thresholds.

V107 adds tenant-scoped service-level objectives/evaluations using aggregate good/total metrics only. Target ratio, window and minimum sample volume are explicitly configured with no platform default; insufficient volume reports NO_DATA rather than false health. Breaches create bounded alert intents and do not automatically change workflow or customer behavior.

V108 adds tenant-pinned data-residency policy/evidence without assuming any geography. Each tenant explicitly defines its primary/allowed regions; resource primary/replica placement must be externally attested inside that allowlist; policy changes make prior placement evidence stale until re-attested. Provider resource identifiers/actors are hashed in the bounded evidence view.

V109 adds exact required-control onboarding readiness certification and connects it to the optional V103 tenant-activation verifier. Every required control must carry current PASS evidence; changing the required control set invalidates older readiness hashes. The platform defines no universal customer checklist, so deployment/customer requirements remain externally configured.

V110 adds JIT-bound redacted support diagnostics. Diagnostic snapshots expose only allowlisted release/readiness/dependency/queue/count state, require an exact DIAGNOSTIC_READ support grant, reject arbitrary provider fields and store only hashed append-only evidence. No raw provider errors, client content or secret material are part of the diagnostic contract.

V111 adds managed-secret generation lifecycle evidence. Secret references are reduced to fingerprints; secret values never enter lifecycle state. New generations are staged with validation evidence, activated by a different actor, older active generations become retiring, and explicit revocation evidence is required before retirement. ConnectorCredentialBroker can consume this authority to reject provider generations that are not the exact active generation.

V112 adds bounded audit evidence-package manifests. A package must contain a contiguous tenant-scoped audit range whose internal chain verifies and whose final hash exactly matches a known checkpoint head. Durable package evidence stores hashes, positions and counts only; audit payloads remain outside this registry.

V113 adds exact-version offboarding export inventory certification. Each tenant explicitly defines required resource classes; each class receives item-count/inventory/package hash evidence; all current required classes must be evidenced before an export certificate is issued. Changing the required set invalidates older export certificates. V103 offboarding can consume the exact export evidence hash while retention proof remains independently verified.

V114 adds trusted clock-integrity evidence and a monotonic security-time reference. Externally trusted samples are checked against host wall time, stale or skewed samples fail readiness, trusted time cannot roll backwards, and security time advances from a monotonic source so a backward host-clock jump cannot extend a grant or lease. Durable evidence stores source/time fingerprints and bounded skew only.
