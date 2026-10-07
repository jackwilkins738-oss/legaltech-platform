# DEFINITION OF DONE

A task is DONE only when applicable items are complete:

## Requirement
- acceptance criteria satisfied;
- scope not silently expanded.

## Code
- follows boundaries/standards;
- no dead debug code;
- no hardcoded secret/customer data.

## Tests
- happy path;
- relevant failure path;
- security tests where relevant;
- AI eval where relevant.

## Operations
- logs/metrics;
- retry/error state;
- alert/runbook for material failure.

## Security/privacy
- authorization;
- minimization;
- audit;
- retention impact reviewed.

## Docs
- API/config/runbook changed where needed;
- ADR/decision updated for material architecture change.

## Release
- rollback/forward-fix understood.

A feature demo is not Definition of Done.
