# TOP-SPEC PERSPECTIVE AUDIT

## Purpose
This is the mandatory quality gate for the LegalTech / Proclaim-replacement project. The project is not considered a "top spec" merely because it contains many files. Every perspective below must contain evidence, decisions, measurable acceptance criteria and an owner.

## Current status
The repository is currently a **knowledge-base scaffold plus selected researched files**. It is not yet a completed business/product/security specification. Most files are templates waiting to be populated.

## Perspective 1 — Customer / End User
Must understand the real daily experience of legal admins, case managers, fee earners, supervisors, accounts and partners.

Required evidence:
- time-and-motion studies
- click counts and context switches
- top 50 repetitive tasks
- top 50 failure/friction points
- interruption load
- queue/waiting time
- error/rework rate
- training burden
- accessibility needs
- role-by-role jobs-to-be-done
- current vs target workflow maps

Gate: product requirements must trace back to observed customer problems, not founder assumptions.

## Perspective 2 — Proclaim / Competitor Intelligence
Must distinguish official capability, technical limitation, configuration issue, anecdote and repeated complaint.

Required:
- current Proclaim capabilities
- current prerequisites and architecture
- pricing/TCO
- support/change model
- workflow model
- Outlook/email model
- reporting/SQL model
- document management
- integrations/API
- migration/export options
- CaseMatters Evo positioning
- current user-reported Evo migration pain
- competitor alternatives and switching triggers

Gate: every high-impact competitor claim needs source/evidence and software version/date where relevant.

## Perspective 3 — Product / UX
The target is not "Proclaim but prettier". Every workflow must minimise cognitive load and human touches.

Required:
- task-first information architecture
- exception-based work queues
- global search
- timeline/history redesign
- document intelligence
- email intelligence
- approvals
- bulk actions
- keyboard efficiency
- accessibility
- responsive/browser-first operation
- configurable workflows without specialist engineering
- explainable automation

Gate: define measurable targets for clicks, time, error rate and training time on core workflows.

## Perspective 4 — Legal Workflow / Domain Accuracy
The platform must model legal operations correctly without pretending to replace lawyers' professional judgement.

Required:
- matter lifecycle by practice area
- limitation/deadline handling
- conflict checking support
- client onboarding
- AML support
- document/evidence lifecycle
- correspondence
- court/tribunal deadlines
- supervision and approvals
- undertakings-sensitive workflows where applicable
- legal accounting boundaries
- file closure/retention

Gate: every legal workflow has an explicit "automation allowed" vs "human judgement required" boundary.

## Perspective 5 — Cybersecurity / Red-Team
Security must be designed for a hostile environment in which a successful attacker would gain access to privileged client information.

Required:
- threat model
- trust boundaries
- tenant isolation
- identity/service identity
- least privilege
- MFA/SSO
- privileged-access management
- secrets management
- encryption/key management
- API security
- browser security
- file upload security
- malware scanning
- SSRF protections
- injection protections
- deserialisation protections
- supply-chain security
- endpoint/admin security
- CI/CD controls
- runtime protection
- logging/SIEM
- detection/response
- ransomware resilience
- insider-threat controls
- data exfiltration controls
- abuse prevention
- DDoS/WAF/rate limiting
- secure deletion
- disaster recovery
- red-team testing

Required adversarial exercises:
- compromised user
- compromised admin
- compromised developer
- stolen session/token
- malicious tenant
- cross-tenant exploit
- malicious document
- prompt injection via legal document
- compromised AI provider
- compromised integration
- compromised CI/CD dependency
- ransomware
- insider data theft
- supply-chain compromise

Gate: security claims require architectural evidence and test evidence, not policies alone.

## Perspective 6 — Privacy / UK GDPR
The platform may process special-category and highly confidential information. Privacy must be operational, not just legal documentation.

Required:
- controller/processor mapping
- Records of Processing Activities
- lawful bases
- Article 9 conditions where relevant
- DPIAs
- data minimisation
- purpose limitation
- retention/deletion
- data subject rights support
- breach support
- international transfers
- subprocessors
- privacy-by-design
- automated decision safeguards
- AI data-use controls
- deletion/return at termination
- audit evidence

Gate: every personal-data flow has an owner, purpose, retention, location and access policy.

## Perspective 7 — Legal Professional / SRA Risk
Law-firm confidentiality is broader than ordinary SaaS privacy.

Required:
- confidentiality-by-design
- client/matter segregation
- conflict-aware information barriers
- role-based access
- former-client confidentiality
- privileged material handling
- mistaken disclosure controls
- export/sharing controls
- auditability
- customer-side governance guidance

Gate: system architecture must make it difficult to accidentally disclose one client's information to another.

## Perspective 8 — AI Safety / Governance
AI must be treated as an untrusted component that cannot bypass ordinary authorisation.

Required:
- AI system inventory
- model/provider inventory
- data-flow mapping
- prompt injection defence
- tool-use permissions
- output validation
- human review policy
- confidence thresholds
- hallucination evaluation
- retrieval security
- document poisoning controls
- model drift monitoring
- provider outage/failover
- no-training/no-retention contractual controls where required
- audit logs
- AI incident response
- ISO 42001 management system

Gate: every AI action has a defined maximum blast radius and a human-approval rule where legal judgement or material external action is involved.

## Perspective 9 — Architecture / Scale
The design must work from a 10-user pilot to thousands of concurrent users and very large document/email volumes.

Required:
- tenant architecture
- regional/data-residency strategy
- stateless application design where appropriate
- async job architecture
- event model
- queues
- idempotency
- retry/dead-letter strategy
- caching
- search/index architecture
- object storage
- database scaling
- partitioning strategy
- rate limits
- observability
- capacity model
- cost model

Gate: define target scale, latency SLOs, throughput and cost-per-matter at each major growth stage.

## Perspective 10 — Reliability / SRE
A legal system cannot fail like an ordinary consumer app.

Required:
- SLOs/SLIs
- RTO/RPO
- backups
- restore testing
- multi-zone resilience
- disaster recovery
- incident command
- on-call
- degradation modes
- dependency failure handling
- status communications
- post-incident review

Gate: prove recovery with tests; do not rely on backup existence as proof of recoverability.

## Perspective 11 — Migration / Switching
Migration is a product, not a consulting side-project.

Required:
- discovery
- data mapping
- document migration
- matter history
- email migration
- users/roles
- workflow migration
- custom fields
- integrations
- permissions
- archive strategy
- reconciliation
- dry runs
- parallel run
- rollback
- customer sign-off
- exit/export

Gate: define measurable data-integrity and workflow-equivalence targets.

## Perspective 12 — Integrations / Ecosystem
A Proclaim replacement lives inside a larger law-firm stack.

Required:
- Microsoft 365 / Graph
- Outlook
- calendar
- identity/SSO
- e-signature
- payments
- document generation
- accounting
- telephony where relevant
- OCR
- email delivery
- storage
- reporting/BI
- APIs/webhooks
- sandbox environments
- connector permissions
- integration failure handling

Gate: every integration needs least-privilege scopes, health monitoring, retries and a failure mode that does not corrupt matters.

## Perspective 13 — Engineering / Secure SDLC
Required:
- branch protection
- peer review
- automated tests
- SAST
- dependency scanning
- secret scanning
- container/image scanning where applicable
- IaC scanning
- DAST where appropriate
- SBOM
- signed builds/releases where appropriate
- environment separation
- change control
- rollback
- vulnerability management
- security regression tests

Gate: production changes must be attributable, reviewable, testable and reversible.

## Perspective 14 — Procurement / Enterprise Trust
The customer will buy assurance as much as features.

Required:
- security questionnaire library
- architecture diagrams
- data-flow diagrams
- subprocessors
- certifications
- penetration-test summary
- BCP/DR summary
- incident process
- vulnerability disclosure
- insurance
- contractual schedules
- SLA
- DPA
- trust centre
- customer security documentation

Gate: a 100–500 person law firm must be able to complete vendor due diligence without bespoke founder explanations every time.

## Perspective 15 — Sales / Marketing
The product must solve an expensive problem clearly.

Required:
- buyer hierarchy
- trigger events
- quantified pain
- ROI calculator
- proof points
- pilot offer
- objection handling
- replacement vs augmentation positioning
- competitor battlecards
- security messaging
- migration promise
- case studies
- reference strategy
- land-and-expand strategy

Gate: the product must have a one-sentence value proposition tied to measurable business outcomes.

## Perspective 16 — Adoption / Change Management
The best software fails if staff refuse to use it.

Required:
- migration UX
- training plan
- role-specific onboarding
- champions programme
- in-product education
- workflow change management
- adoption metrics
- feature discoverability
- rollback/contingency
- support during go-live

Gate: define adoption targets by role and workflow.

## Perspective 17 — Business Model / Unit Economics
The platform must become economically better as it scales.

Required:
- pricing
- COGS
- AI inference cost
- storage cost
- email cost
- support cost
- onboarding cost
- migration cost
- implementation cost
- certification cost
- insurance
- sales cycle
- CAC
- payback
- gross margin
- net revenue retention
- expansion paths

Gate: demonstrate a path to strong gross margins without degrading service/security.

## Perspective 18 — Capital / Speed of Execution
The product must be designed to become large quickly without taking existential risks.

Required:
- bootstrapping scenario
- pilot-funded development
- seed scenario
- hiring plan
- founder time allocation
- build-vs-buy matrix
- critical-path dependencies
- milestones
- kill criteria
- runway model
- capital-efficient sequencing

Gate: each stage must have an explicit "what proves the next stage is justified" criterion.

## Perspective 19 — Moat / Long-Term Defensibility
A better UI is not a moat.

Required:
- workflow data advantage
- integration depth
- migration tooling
- customer-specific workflow learning
- domain models
- trust/certification moat
- distribution moat
- partner moat
- switching-cost analysis
- network effects where real
- IP strategy

Gate: define why a well-funded competitor cannot copy the product six months later.

## Perspective 20 — Operations / Support
Enterprise software creates an operational business, not just a software product.

Required:
- L1/L2/L3 support
- severity model
- escalation
- customer communications
- knowledge base
- status page
- incident SLAs
- implementation team model
- customer success
- renewals
- health scoring

Gate: support must scale without founders becoming the permanent help desk.

## Perspective 21 — Insurance / Liability / Contracting
Required:
- professional indemnity
- cyber insurance
- technology E&O
- contractual liability limits
- indemnity structure
- data breach obligations
- security commitments
- AI disclaimers/allocations of responsibility
- consequential-loss position
- service credits
- termination assistance
- data export

Gate: liability profile must be reviewed alongside the architecture and sales promise.

## Perspective 22 — Financial / Operational Legal Accounting
If the system handles legal accounting, this is a separate high-risk domain.

Required:
- client money boundaries
- office/client account concepts
- ledgers
- reconciliations
- approvals
- audit trail
- segregation of duties
- integration with specialist accounting systems where appropriate
- product scope decision on what not to own initially

Gate: do not build high-risk financial functionality merely to match a feature list; define risk-adjusted scope.

## Perspective 23 — Accessibility / Inclusion
Required:
- WCAG target
- keyboard navigation
- screen-reader support
- colour contrast
- focus management
- error messaging
- accessibility testing
- assistive technology support
- reduced-motion support where relevant

Gate: accessibility is part of release acceptance, not post-launch polish.

## Perspective 24 — Data Governance / Information Lifecycle
Required:
- data classification
- canonical data model
- data lineage
- metadata
- retention schedules
- legal holds
- deletion policies
- archival
- exports
- correction/reconciliation
- immutable audit records

Gate: every major data class has a lifecycle from creation to deletion/export.

## Perspective 25 — Product Analytics / Evidence of Value
Measure whether the platform actually improves legal work.

Required:
- task completion time
- admin hours saved
- automation rate
- exception rate
- false-positive/false-negative automation
- SLA performance
- matter progression
- document processing time
- email filing accuracy
- user adoption
- support tickets
- customer ROI

Gate: every major automation feature has a measurable success metric before it is declared successful.

## Perspective 26 — Research Integrity / Anti-Confirmation Bias
The founders are predisposed to see Proclaim as bad. The research process must actively try to disprove the thesis.

Required:
- evidence grading
- independent interviews
- positive Proclaim cases
- competitor strengths
- customer switching objections
- lost-pilot reasons
- product failures
- alternative explanations for complaints

Gate: include a deliberate "why we might be wrong" section in every major strategic decision.

## Perspective 27 — Geographic / Jurisdiction Expansion
The initial market may be UK legal, but future expansion must not be accidentally blocked.

Required:
- UK-first requirements
- jurisdiction-specific rules
- data residency options
- language/locale
- tax/invoicing
- local legal workflow differences
- regional hosting
- international transfer architecture

Gate: separate genuinely UK-specific product logic from configurable product rules.

## Perspective 28 — Vendor / Supply Chain Concentration
Required:
- cloud concentration risk
- AI-provider concentration risk
- identity provider dependency
- email dependency
- payment dependency
- OCR dependency
- open-source dependencies
- exit plans
- portability
- failure simulations

Gate: no single third party should create an unbounded single point of failure for customer confidentiality or availability.

## Perspective 29 — Founder Governance
Required:
- equity
- IP assignment
- founder responsibilities
- vesting
- deadlock/tie-break mechanism
- decision rights
- key-person risk
- access control after founder departure
- business continuity

Gate: the company must survive a founder disagreement or departure without losing control of the product.

## Perspective 30 — Exit / Strategic Options
Designing for a large outcome requires knowing what an acquirer would eventually value.

Required:
- recurring revenue quality
- retention
- gross margin
- security certifications
- clean IP ownership
- clean cap table
- audit trails
- enterprise contracts
- customer concentration
- proprietary workflow/data assets
- integration ecosystem
- strategic acquirer map

Gate: future acquisition readiness must be preserved through normal operations rather than retrofitted later.

# FINAL QUALITY GATE

The project may only be called a "top spec" when:

1. Every perspective above has a populated owner, evidence, decisions, requirements and acceptance criteria.
2. Material claims have authoritative or repeated user evidence.
3. Security architecture has been threat-modelled and independently tested.
4. Customer pain has been observed in real workflows.
5. The business model has been stress-tested against realistic support, cloud, AI, migration and sales costs.
6. The product has a clear wedge before full Proclaim replacement.
7. Migration has been designed as a first-class product.
8. The roadmap contains explicit kill criteria and stage gates.
9. The documentation is maintained as living operational evidence, not aspirational prose.
10. Claude is instructed to challenge the founders when evidence contradicts assumptions.

## Current verdict
**NOT YET TOP SPEC.**

The repository structure is strong enough to become the top spec, but it must now be populated with real research, decisions and evidence. The existence of a 480-file structure is not itself evidence that the work has been done.
