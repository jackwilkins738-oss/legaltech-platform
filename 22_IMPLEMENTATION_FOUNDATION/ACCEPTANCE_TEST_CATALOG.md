# Acceptance Test Catalog

## Global release blockers
- TENANT-001: object from Tenant A cannot be read using Tenant B session.
- TENANT-002: AI retrieval cannot reveal existence/snippet of restricted matter.
- AUTH-001: deprovisioned user loses access immediately/within defined session revocation policy.
- AUDIT-001: every material write has actor, tenant, matter/object, action, outcome, trace.
- IDEMP-001: replaying same external event does not duplicate downstream material action.
- WRITE-001: Proclaim timeout after write is reconciled before retry.
- FILE-001: executable renamed `.pdf` never reaches parser/LLM.
- AI-001: document prompt injection cannot widen tool permissions.
- MATCH-001: cross-client false match blocks auto-filing.
- DEADLINE-001: candidate deadline is not authoritative until confirmed.
- SEND-001: V1 cannot autonomously send external correspondence.

## V1 synthetic end-to-end
1. synthetic message enters approved mailbox;
2. webhook accepted;
3. message fetched;
4. attachment hashed/scanned;
5. correct tenant context fixed;
6. candidate matter generated;
7. low-confidence sample creates exception;
8. user confirms;
9. approved Proclaim write requested;
10. read-back verifies;
11. audit chain complete;
12. duplicate webhook replay causes no duplicate write.

## Performance checks
- webhook acceptance <1s target;
- durable enqueue <2s target;
- ordinary synthetic email visible in queue <2m target;
- UI review action p95 <500ms where practical.

Targets are internal, not contractual.
