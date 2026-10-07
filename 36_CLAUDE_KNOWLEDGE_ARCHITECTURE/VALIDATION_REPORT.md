# Claude knowledge architecture validation

## Structural checks
- Root `CLAUDE.md`: 66 lines (target <200).
- Curated authority entries: 51.
- Task routes: 12.
- Supersession mappings: 7.
- Catalog is regenerated after architecture changes and checked by lint.

## Routing acceptance tests
- PASS — TO analysis after observation: expected `to_observation`, top route `to_observation`.
- PASS — Proclaim feasibility: expected `proclaim`, top route `proclaim`.
- PASS — Security review: expected `security_privacy`, top route `security_privacy`.
- PASS — Competitive product: expected `competition`, top route `competition`.
- PASS — Pilot pricing: expected `commercial_sales`, top route `commercial_sales`.
- PASS — Engineering build: expected `engineering_execution`, top route `engineering_execution`.

## Design result
- Claude Code receives a concise always-on root instruction set.
- Domain rules load by path instead of bloating every session.
- Claude Projects can use the dedicated project-instructions file while RAG retrieves reference material.
- Retrieval relevance is explicitly separated from document authority.
- Known superseded artifacts cannot silently override current state if the protocol is followed.
- The full catalog exists for lookup but is explicitly excluded from normal context loading.
