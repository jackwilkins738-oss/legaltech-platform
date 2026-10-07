# ENVIRONMENTS, SECRETS & ACCESS

## Environments
LOCAL
DEV
TEST
STAGING
PROD
SECURITY-TEST where useful.

Each has separate:
- DB;
- storage;
- secrets;
- OAuth/app registrations where practical;
- service identities.

## Data
LOCAL/DEV/TEST: synthetic only.
STAGING: synthetic/deidentified unless approved otherwise.
PROD: customer data.

## Secrets
Dedicated secret manager.
No `.env` secrets committed.
No secrets pasted into Claude prompts/chat/repo docs.

## Production access
No standing developer DB/content access.
Use:
- support tooling;
- scoped diagnostics;
- customer-approved support grant;
- break-glass with reason, MFA/step-up, expiry, audit.

## Claude Code
Local Claude sessions receive only dev/test credentials.
Production deploy identity belongs to CI/CD, not developer laptop.
