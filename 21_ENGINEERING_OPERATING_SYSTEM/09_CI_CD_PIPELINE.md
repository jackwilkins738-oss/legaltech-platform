# CI/CD PIPELINE

## Pull request pipeline
1. formatting/lint;
2. typecheck;
3. unit tests;
4. contract tests;
5. migration validation;
6. dependency/secret scan;
7. SAST;
8. tenant-isolation/security tests where touched;
9. build artifacts.

## Merge to main
- immutable build artifact;
- deploy dev/test automatically;
- staging deployment;
- smoke/E2E;
- AI eval suite if AI/retrieval/prompt/model changed;
- manual approval for production while early-stage.

## Production
Deploy exact artifact tested in staging.
No rebuilding from mutable source during production deploy.

## Emergency hotfix
Still requires:
- issue/incident reference;
- focused tests;
- reviewer;
- post-merge regression;
- incident/postmortem if material.

## Rollback
Application + config + workflow + DB impacts considered together.
