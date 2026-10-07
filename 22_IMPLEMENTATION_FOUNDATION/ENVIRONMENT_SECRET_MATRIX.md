# Environment & Secret Matrix

| Capability | Local | Dev | Test | Staging | Prod |
|---|---|---|---|---|---|
| Real client data | NO | NO | NO | Only explicitly approved test data | YES |
| Synthetic data | YES | YES | YES | YES | Limited |
| Graph tenant | Dev/test tenant | Dev/test | Dev/test | Customer test if approved | Customer prod |
| Proclaim | Mock | Mock/test | Test env | Customer test | Customer prod |
| AI keys | Dev scoped | Dev scoped | Test scoped | Staging scoped | Prod scoped |
| Prod DB access by developer | NO | NO | NO | NO | NO standing access |
| Debug raw content logs | NO | NO | NO | NO | NO |

## Secret classes
- app runtime
- integration credential
- encryption/KMS
- CI/CD deploy
- break-glass
- third-party AI/OCR

## Rules
- no secrets in Git/Claude/chat;
- per-environment credentials;
- tenant-specific integration credentials where possible;
- rotation procedure;
- revocation tested;
- production credentials unavailable to ordinary coding agents.
