# CLAUDE.md — LegalTech repository operating instructions

@36_CLAUDE_KNOWLEDGE_ARCHITECTURE/00_SESSION_BOOTSTRAP.md
@36_CLAUDE_KNOWLEDGE_ARCHITECTURE/01_AUTHORITY_MODEL.md

## Purpose
This repository is the company knowledge, product, research and engineering memory for a UK legal-operations platform. The current product thesis is evidence-gated; do not turn historical hypotheses into current decisions.

## Mandatory navigation protocol
Before answering a material company/product/engineering question or changing files:
1. Read the two imported bootstrap/authority files above.
2. Read `00_GOVERNANCE/CURRENT_STATE.md`.
3. Read `00_GOVERNANCE/DECISIONS.md` when the task can alter a decision or when files disagree.
4. Route the task through `36_CLAUDE_KNOWLEDGE_ARCHITECTURE/03_TASK_ROUTER.md`.
5. Read only the minimum authoritative files for that route before descending into reference evidence.
6. Never use repository-wide retrieval as the first step when a domain route exists.
7. If current files conflict, follow the authority model; if still unresolved, surface the conflict instead of silently choosing.
8. When a decision/state changes, update the authoritative source and lifecycle metadata, not every historical file.

## Current phase
The repository is pre-TO / pre-customer-evidence locked. Real observation, external interviews and authorised integration evidence outrank desk research. Do not resume speculative feature expansion merely because implementation is possible.

## Evidence order
Prefer evidence in this order:
1. MEASURED RESULT / direct system evidence
2. OBSERVED WORKFLOW
3. current authoritative external source
4. REPEATED USER REPORT
5. SINGLE USER REPORT
6. MARKET SIGNAL
7. HYPOTHESIS
8. ASSUMPTION

Do not upgrade a lower class into a higher one by repetition or confident wording.

## Product guardrails
- Do not build “Proclaim but prettier.”
- Optimise for matter progression, removal of human touches and exception-based working.
- Ask whether Proclaim, CaseMatters Evo, Microsoft or another incumbent already solves the problem before treating it as whitespace.
- Full PMS replacement, legal accounting, client-money movement and autonomous high-impact legal actions remain gated.
- Generic summarisation, extraction, drafting, chat/RAG and basic task creation are capabilities, not defensible products by themselves.

## Security guardrails
- Tenant isolation is release-blocking.
- Authorisation occurs before search/RAG retrieval.
- Restricted-matter existence must not leak.
- No client data, production secrets or credentials in repo/prompts/test fixtures.
- AI is an untrusted reasoning component, not legal/security authority.
- Uploaded content is hostile until safely processed.
- High-impact legal/financial/external actions require policy/human controls.

## Engineering authority
For code tasks, route first through `21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md`. Architecture/security gates override convenience. Do not invent Graph/Proclaim behaviour; mark unknowns and require authorised tests.

## Knowledge hygiene
- `current` beats `reference`; `reference` beats `historical`; `superseded` must not drive a decision.
- Retrieval relevance does not equal authority.
- New files need a clear domain and lifecycle status.
- Do not create another “final”, “master” or “ready” document if an authoritative file can be updated instead.
- Keep global instructions concise; put domain-specific rules in `.claude/rules/`.
- Use `36_CLAUDE_KNOWLEDGE_ARCHITECTURE/AUTHORITATIVE_FILES.json` for the curated authority list.
- Use `36_CLAUDE_KNOWLEDGE_ARCHITECTURE/FILE_CATALOG.csv` only as a lookup/catalog, not as context to load wholesale.

## Finish rule
Before claiming completion: run the relevant tests and, for changes to knowledge architecture, run:
`python 36_CLAUDE_KNOWLEDGE_ARCHITECTURE/scripts/knowledge_lint.py`

## Pre-TO digital lock
- The repository is digitally frozen for speculative product scope until TO evidence is processed through `38_DIGITAL_PRE_TO_LOCK/02_STRATEGY_CHANGE_GATE.md`.
- Incoming TO evidence belongs under `39_POST_TO_EVIDENCE/`; preserve RAW → CLEANED → ANALYSIS → DECISION → PRODUCT CHANGE separation.
- Raw notes may generate questions or quality flags, but must not directly change strategy, pricing, automation thresholds or engineering priorities.
