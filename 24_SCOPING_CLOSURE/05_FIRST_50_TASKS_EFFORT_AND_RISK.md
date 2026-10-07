# FIRST 50 ENGINEERING TASKS — EFFORT & RISK

## Estimation method
Use relative engineering points, not fake calendar precision.

1 = trivial/bounded
2 = small
3 = moderate
5 = substantial
8 = high uncertainty / integration/security work

Claude Code can execute a large fraction, but human review burden differs.

## Phase estimates

### Foundation ENG-001–010
Approx 27 points.
Main risks:
tenant isolation, authz, audit/idempotency.

### Graph ENG-011–020
Approx 34 points.
Main risks:
permissions, lifecycle events, reconciliation.

### Document safety ENG-021–028
Approx 27 points.
Main risks:
hostile files, malware, parser isolation.

### Matter matching/review ENG-029–038
Approx 34 points.
Main risks:
wrong-matter UX/policy, auth in review UI.

### Proclaim ENG-039–045
Approx 34 points.
Highest uncertainty because real environment is unknown.

### AI/evals/E2E ENG-046–050
Approx 21 points.
Risk:
evaluation quality and false confidence.

## Total
~177 relative points.

This is NOT 177 hours.

## Human-review intensity
Mandatory senior review:
- tenancy;
- permissions;
- Proclaim writes;
- hostile file pipeline;
- AI tool authorization;
- production migrations.

## Build-order conclusion
No reason to wait for TO to build:
foundation + mocks + synthetic eval harness.

Do wait for evidence before:
productionising a specific automation or building expansion modules.
