# Pre-TO Technical Starter

Runnable, dependency-free Node.js spike harness using synthetic data and mock integrations only.

## What it proves
- deterministic event envelope handling;
- idempotent replay handling;
- basic deterministic matter candidate matching;
- conflict / no-match / adversarial routing to human review;
- hostile-file signature rejection before parsing;
- mock Proclaim write + read-back verification;
- complete synthetic inbound -> review/writeback -> audit flow.

## What it does NOT prove
- Microsoft Graph production permissions/lifecycle;
- real malware scanning;
- real Proclaim API behaviour;
- production security controls;
- AI model performance;
- legal deadline correctness.

## Run
```bash
npm test
npm run demo
```
No external packages or network calls are required.
