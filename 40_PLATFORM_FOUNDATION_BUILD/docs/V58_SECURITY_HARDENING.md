# V58 — Security hardening and production evidence gates

## Scope
V58 hardens security boundaries already present in V57. It does not add legal workflow scope, autonomous legal actions, live customer access or production credentials.

## What is implemented in code/config now
1. **Database tenant integrity** — tenant-owned foreign keys use composite tenant/object relationships; restricted data cannot structurally point at another tenant's actor, matter, event or security zone.
2. **Authorization architecture** — restricted matters require explicit membership plus security-zone access; document restrictions can be stricter than their parent matter; break-glass is matter-bound, step-up verified and limited to 15 minutes.
3. **Production identity boundary** — live authentication has an `OidcAuthProvider` contract that only accepts claims returned by an injected cryptographic verifier. Static bearer sessions remain synthetic-only.
4. **Hostile content boundary** — basic upload inspection is renamed `BASIC_INGEST_ACCEPTED` and explicitly does not claim malware/parser safety. Real-data use requires clean managed malware evidence plus isolated parsing.
5. **Secrets/infrastructure interlock** — production configuration refuses mock auth, local secret/object/queue/session/rate-limit/audit modes and owner-style database roles.
6. **Graph connector boundary** — constant-time client-state checking, bounded notification batches, opaque credential references and a rejection of broad `MAILBOX_ALL` configuration.
7. **Proclaim connector boundary** — live credentials must be secret references and write capability cannot be configured without read-back capability.
8. **Abuse controls** — bounded API collection reads, stable 429 handling, IP/tenant synthetic rate limiting and connector payload limits.
9. **CI/supply chain** — GitHub Actions are immutable-SHA pinned, checkout credentials are not persisted, security workflows have explicit permissions, CodeQL/dependency-review workflows are present, Dependabot is configured, and the custom secret scanner covers private credential files and modern token forms.
10. **Offensive regression tests** — local attack-path tests cover compromised-user authorization, document restrictions, forged trace IDs, OIDC verifier failure, rate limits, connector client state/configuration and hostile-file evidence.
11. **Independent pen-test requirement** — the system cannot enable real-client-data mode unless an external pen-test evidence status is `PASS`.
12. **Real-data fail-closed gate** — real client data additionally requires reviewed evidence for session revocation/step-up, managed secrets/KMS, network isolation, monitoring, audit export, encrypted backups/restore, managed malware scanning, parser isolation, and live Graph/Proclaim validation.

## What V58 does NOT claim
The following are deliberately still external evidence gaps rather than simulated successes:
- a real Microsoft Entra tenant and production session-revocation flow;
- managed KMS/secrets, private networking, managed Postgres/object storage/queue/session store/rate limiter/audit sink;
- an operating malware scanner and isolated parser service;
- authorised live Microsoft Graph and Proclaim tests;
- restore/DR evidence and production monitoring evidence;
- independent penetration testing.

Environment status values are safety interlocks only. Setting a variable to `PASS` does not create evidence; each gate must be backed by reviewed artefacts.

## Security invariant
A compromise of one ordinary authenticated employee must not automatically grant another tenant, a restricted matter, privileged documents, connector administration, or authority to write to Proclaim without the existing approval/reconciliation controls.
