# CANONICAL MATTER-STAGE MODEL — PI

## Principle
Do not encode every customer stage name directly into core logic.

Use canonical stages + customer labels/mappings.

## Canonical PI stages

1. PROSPECT
2. INTAKE
3. ACCEPTED_ONBOARDING
4. INVESTIGATION
5. LIABILITY
6. MEDICAL_EVIDENCE
7. QUANTUM_EVIDENCE
8. NEGOTIATION
9. PRE_ISSUE
10. LITIGATION
11. SETTLEMENT
12. COSTS_COMPLETION
13. CLOSED
14. ARCHIVED

## Customer mapping
Example:
Customer stage "MOJ Stage 1" may map to:
LIABILITY

Customer stage "Medical Requested" may map to:
MEDICAL_EVIDENCE

## Stage state
Matter may also carry parallel status dimensions:
- liability status
- medical status
- quantum status
- litigation status
- client-contact status

Avoid forcing one stage field to encode the entire state of the matter.

## Stage transitions
Each transition:
- source
- user/workflow
- time
- required fields
- blockers
- audit

## Why
This lets:
- multiple firms use their own terminology
- analytics compare across firms
- workflows remain configurable
- migration mapping remain feasible
