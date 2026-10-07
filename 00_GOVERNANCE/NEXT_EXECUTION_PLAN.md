# NEXT EXECUTION PLAN — AFTER NON-TO SCOPING

## Priority 1 — Run real evidence collection
### Partner firm
- complete 5-day TO observation
- capture role/task/frequency/time/rework/exceptions
- map real Proclaim setup
- identify workflow with highest annual admin-capacity cost

### External firms
Interview minimum 5, ideally 10:
- 3+ current Proclaim PI firms
- 1 satisfied Proclaim user
- 1 firm considering/using Evo or another system

## Priority 2 — Run technical spikes in parallel
These are permitted before TO because they answer feasibility without committing to broad product scope.

### Spike 1 — Microsoft Graph
Prove approved mailbox subscription, webhook, fetch email/attachments, delta reconciliation and restricted mailbox scope.

### Spike 2 — Safe file pipeline
Prove MIME validation, malware scan, PDF/text extraction, quarantine and audit.

### Spike 3 — Proclaim
On an authorised test environment prove matter lookup, read history, post history/email, upload document, create task if supported, update a safe field and read back result.

### Spike 4 — Canonical model
Prove one email can flow Graph → canonical communication/document → review → Proclaim mapping.

### Spike 5 — Evaluation harness
With synthetic/deidentified data test match candidates, classification, extraction, confidence and human correction.

## Priority 3 — Make first wedge decision
Only after TO + external validation + Proclaim feasibility.

Score:
- annual capacity value
- frequency
- technical feasibility
- error consequences
- pilot simplicity
- willingness to pay
- expansion value

## Priority 4 — Pilot-ready build
Only if gates pass:
- tenant isolation
- SSO/IAM baseline
- exception queue
- audit
- Graph
- Proclaim
- monitoring
- backup
- security testing

## Stop conditions
Do not force inbound-email wedge if task frequency is low, ambiguity is too high, safe Proclaim write-back is impractical, firms will not grant access, buyers assign little value, or Evo/Proclaim already solves it adequately.
