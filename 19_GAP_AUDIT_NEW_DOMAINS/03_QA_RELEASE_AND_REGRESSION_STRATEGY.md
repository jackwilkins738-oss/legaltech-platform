# QA, RELEASE & REGRESSION STRATEGY

## Test pyramid

### Unit
- policy logic;
- scoring;
- transformations;
- parsers;
- adapter logic.

### Contract
- Graph adapter;
- Proclaim adapter;
- AI provider;
- OCR;
- storage.

### Integration
- queue → worker;
- DB → object store;
- permission → search;
- workflow → connector.

### End-to-end
Synthetic:
email → matter match → review → write-back → audit.

### Security
Abuse tests from security pack.

### AI evaluation
Separate from ordinary software tests.

## Required pre-release gates
1. unit/contract tests pass;
2. DB migration dry-run;
3. backwards compatibility;
4. AI regression suite where affected;
5. tenant-isolation test;
6. critical workflow E2E;
7. staging smoke;
8. rollback path;
9. observability present.

## Customer configuration regression
Workflow configuration can break customers without code changes.

Therefore version:
- workflow;
- taxonomy;
- prompt;
- model;
- permission policy;
- mapping.

Maintain customer-specific regression fixtures.

## Canary strategy
Initially:
- internal/test tenant;
- pilot tenant;
- broader tenants.

Use feature flags for:
- new models;
- auto-action thresholds;
- connector versions.

## Rollback
Application rollback is insufficient if:
- workflow already acted;
- DB migration destructive;
- external action sent.

Design compensating/reconciliation procedures.

## Release evidence
For each release:
- change list;
- risk;
- tests;
- approvals;
- migrations;
- rollback;
- incident link if hotfix.
