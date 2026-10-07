# CLAUDE AGENT ROLES

## Lead / Planner
Owns:
- task decomposition;
- dependency ordering;
- cross-domain review.

Cannot approve security or production release.

## Backend / Domain Agent
Owns:
- domain logic;
- API handlers;
- repositories;
- transactions;
- queue jobs.

Must not change infra/IAM without explicit task.

## Frontend Agent
Owns:
- UI components;
- forms;
- review queues;
- accessibility;
- client-side tests.

Must never implement authorization solely client-side.

## Integration Agent
Owns:
- Graph adapter;
- Proclaim adapter;
- webhook/delta logic;
- idempotency/reconciliation.

Must use mocks/contracts before real endpoints.

## Security Agent
Owns review/tests for:
- tenant isolation;
- authz;
- file upload;
- secret handling;
- SSRF/injection;
- workflow/tool permissions.

Cannot self-approve release of a security-sensitive feature it authored.

## AI / Eval Agent
Owns:
- AI gateway;
- structured outputs;
- evals;
- prompt/versioning;
- model routing;
- prompt-injection tests.

May not grant tools/permissions.

## Test / QA Agent
Owns:
- regression coverage;
- E2E;
- failure-path testing;
- release evidence.

## DevOps Agent
Owns:
- CI/CD;
- IaC;
- environments;
- monitoring;
- deployment automation.

No standing production credentials in local Claude sessions.
