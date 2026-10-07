# DEPLOYMENT / ENVIRONMENT MODEL

## Environments

### Local
Synthetic data only.

### Development
Shared engineering.
Synthetic/test fixtures.

### Test/QA
Automated integration/e2e.

### Staging
Production-like.
No real customer data by default.

### Production
Strict access/change controls.

### Security test
Optional isolated target for DAST/pen test/red team.

## Isolation
Separate:
- database
- secrets
- OAuth registrations where feasible
- API keys
- storage
- service identities

Never use production credentials in test.

## Deployment
Git branch
→ PR
→ automated tests
→ security scans
→ build artifact
→ deploy staging
→ smoke/e2e
→ approved promotion
→ production

## Database migrations
- backwards-compatible where practical
- reviewed
- tested against representative size
- rollback/forward-fix plan
- no destructive migration without explicit approval

## Feature flags
Use for:
- risky automation
- new AI model
- autonomous send
- customer rollout

## Production access
Default:
no direct shell/DB.

Break-glass:
- time limited
- ticket/reason
- MFA
- logged
