# CLAUDE.md — LegalTech Master Repository

## Mission
Build a secure, enterprise-grade UK legal operations platform that first removes measurable administrative work from Proclaim-based law firms and may later replace Proclaim where evidence supports doing so.

## Repository status
This repository consolidates the researched material created through Blocks 1–8 plus the security master and perspective audit. It intentionally excludes the hundreds of old empty scaffold templates.

The current first-product hypothesis is **Inbound Legal Operations for high-volume UK personal-injury teams using Proclaim**:

Microsoft Graph / document input → secure ingest → matter match → classify/extract → detect work → policy → human review where required → Proclaim write-back → audit.

This is a hypothesis until the TO study, external interviews and real integration tests pass the relevant gates.

## Authority order when files conflict
1. `00_GOVERNANCE/CURRENT_STATE.md` and `00_GOVERNANCE/DECISIONS.md`
2. `09_SECURITY_PRIVACY/SECURITY_MASTER_SPEC.md` for security baseline
3. later, more-specific researched specification files in this repository
4. earlier hypothesis files
5. old external scaffold material — not authoritative

Never silently choose between conflicting files. If a conflict is material and not resolved by the authority order, record it in `00_GOVERNANCE/OPEN_QUESTIONS.md`.

## Evidence vocabulary
Use exactly these labels where practical:
- VERIFIED FACT — authoritative/current source or direct measured behaviour
- OBSERVED WORKFLOW — directly observed real workflow
- MEASURED RESULT — actual timing/count/log/financial result
- REPEATED USER REPORT — multiple independent reports
- SINGLE USER REPORT — one user/firm
- MARKET SIGNAL — relevant but indirect market evidence
- HYPOTHESIS — unvalidated product/market proposition
- ASSUMPTION — temporary input
- DECISION — deliberate company choice

Never present USER REPORT, HYPOTHESIS or ASSUMPTION as verified fact.

## Non-negotiable product rules
- Do not build “Proclaim but prettier.”
- Optimise for removal of human touches and exception-based work.
- AI is an untrusted reasoning component, not an authority.
- High-impact legal, financial or external actions require the defined human/policy gate.
- Matter matching is confidentiality-sensitive. Semantic similarity alone cannot auto-file.
- Deadline extraction is candidate-only in V1 unless a validated rule/human confirmation promotes it.
- Full legal accounting is out of V1.
- Client-money movement is out of V1.
- Full PMS replacement is blocked until the replacement gate is passed.
- Migration and exportability are first-class product capabilities.

## Non-negotiable security rules
- Tenant isolation is release-blocking.
- Authorisation must be server-side and apply before search/RAG retrieval.
- Restricted matter existence must not leak through search, errors, logs or AI.
- No production secrets or client data in Git, prompts, test fixtures or docs.
- No standing developer access to production customer content.
- Use time-limited, audited break-glass access where production access is unavoidable.
- Separate inbound read authority from outbound send authority where practical.
- Customer data is not model-training data by default.
- Every privileged/material action must be auditable.
- Uploaded documents and emails are hostile input until processed safely.

## Current architecture direction
- Browser-first
- Modular monolith initially
- Managed Postgres canonical store
- Private object storage
- queue/workers for async ingest
- Graph connector
- Proclaim connector/adaptor
- AI gateway
- OCR/document-processing abstraction
- permission-filtered search/RAG
- append-oriented audit events
- infrastructure designed for later portability to a major cloud footprint

Vercel/Supabase are allowed for early prototype/pilot only if customer/security requirements are met. Do not make core domain logic dependent on hard-to-port proprietary features.

## Current ICP hypothesis
Prioritise high-volume UK personal-injury firms, especially approximately 50–250 Proclaim users with Microsoft 365, central case/admin teams and repetitive email/document workflows.

Do not call an account a verified Proclaim customer without current/recent evidence.

## Build permissions before TO/customer validation
### Allowed
- technical spikes
- synthetic-data prototype
- Graph proof of concept
- Proclaim connector proof on authorised test environment
- eval harness
- UX mockups
- canonical schema
- auth/tenant/security foundations
- target-account research

### Blocked
- full PMS build
- legal accounting
- mass feature expansion
- expensive certification programme
- large engineering team
- autonomous high-impact legal actions
- production promises not backed by testing

## TO-blocked decisions
Do not invent answers for:
- actual task frequency
- actual handling time
- click counts
- real error/rework rate
- true exception rate
- real automation ceiling
- actual £ value per workflow
- final wedge ranking
- real user adoption
- partner firm's exact Proclaim configuration
- willingness to pay

See `16_TO_RESEARCH/WHAT_REMAINS_UNKNOWN_WITHOUT_TO.md`.

## How Claude should work
1. Read this file.
2. Read `00_GOVERNANCE/CURRENT_STATE.md`.
3. Read `00_GOVERNANCE/DECISIONS.md`.
4. Read only the smallest task-relevant files.
5. Check `01_RESEARCH_EVIDENCE/MASTER_SOURCE_REGISTER.md` for factual sourcing.
6. Check security requirements before implementing anything involving data, identity, files, AI, integrations or permissions.
7. Implement the smallest change that satisfies the accepted requirement.
8. Test the change.
9. Update documentation when implemented state changes.
10. Record material architecture/product/security decisions in `00_GOVERNANCE/DECISIONS.md` or an ADR.

## Mandatory challenge behaviour
Actively challenge founder assumptions. In particular ask:
- Could Proclaim already do this when configured properly?
- Could CaseMatters Evo remove the gap?
- Does a competitor already solve this?
- Is the customer pain measured or merely disliked?
- Is the automation actually safer/faster after exceptions?
- Does this increase support/implementation burden enough to damage margins?
- Is this feature part of the wedge or premature platform expansion?

## Definition of “top spec”
The project is not top-spec because many files exist. It becomes top-spec only when the perspective audit gates are met with evidence, owners, decisions, acceptance criteria, customer observation, tested security, working migration, viable economics and explicit kill criteria.


# Engineering execution authority
When implementing code, also treat `21_ENGINEERING_OPERATING_SYSTEM/` as authoritative engineering policy.

Engineering conflict order:
1. root `CLAUDE.md`;
2. `00_GOVERNANCE/CURRENT_STATE.md` and `DECISIONS.md`;
3. `21_ENGINEERING_OPERATING_SYSTEM/04_ARCHITECTURE_GUARDRAILS.md`;
4. `21_ENGINEERING_OPERATING_SYSTEM/11_SECURITY_RELEASE_GATES.md`;
5. task-specific accepted requirements.

Before coding the first task, read `21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md`.
Use `21_ENGINEERING_OPERATING_SYSTEM/18_ENGINEERING_TASK_TEMPLATE.md` for engineering tickets.
Use `21_ENGINEERING_OPERATING_SYSTEM/21_FIRST_50_ENGINEERING_TASKS.md` as the initial build sequence.

Claude Code must not:
- use production/customer credentials unless a task explicitly supplies an authorised, scoped mechanism;
- weaken tests/auth/security to make a task pass;
- create autonomous high-impact legal/financial actions;
- invent Proclaim/Graph behaviour;
- merge architecture changes without an ADR/human decision where required.


## Implementation foundation authority
Before implementing APIs, events, adapters, tenant configuration, acceptance tests or the first 50 tasks, read `22_IMPLEMENTATION_FOUNDATION/`.

Machine-readable contracts in that directory are provisional implementation references. They do not override `00_GOVERNANCE/DECISIONS.md`, the security master, or evidence gates.

Do not invent a new API/event shape if a reference contract exists without creating an ADR explaining why.
Do not execute Proclaim tasks marked `blocked_by_evidence=true` without authorised test access.

## Production-shape scaffold authority
Before implementing Postgres persistence, RLS, authentication/session boundaries, worker lifecycle or observability, read `30_PRODUCTION_SHAPE_SCAFFOLD/`.

The SQL is a prototype until executed against a real Postgres development instance. Do not claim runtime RLS validation from static tests alone. Production database roles must not be owner/superuser roles that can bypass RLS.

## Developer control plane
Before coding in the pre-TO repository, run `31_DEV_REPRODUCIBILITY_AND_CONTRACTS/scripts/dev-check.mjs` or the equivalent npm command from that directory. Do not cross `PRE_TO_ENGINEERING_STOP_LINE.md` without new evidence or authorised access.

## Pre-TO final authority
Before interpreting, modifying or analysing TO data, read `33_PRE_TO_FINAL_AUDIT_AND_LOCK/00_PRE_TO_COMMAND_CENTRE.md` and `04_MEASUREMENT_AND_ANNUALISATION_RULES.md`.

During PRE_TO_LOCKED status:
- do not resume speculative application engineering merely because capacity exists;
- do not use broad Task Category averages as decision-grade annual economics;
- keep measured timing separate from reported/assumed frequency and population;
- use Task Family × Role for provisional annualisation;
- treat targeted-repeat samples as timing evidence, not prevalence evidence;
- preserve contradictory evidence and native-Proclaim disconfirmation.
