# PI V1 — INBOUND EVENT-BY-EVENT SPECIFICATION

## Event 0 — Graph notification received
Input:
- tenant
- subscription
- resource reference

System:
- validate source/client state
- record event ID
- dedupe
- queue fetch

Failure:
- invalid notification → reject/log
- queue unavailable → retry

Audit:
GRAPH_NOTIFICATION_RECEIVED

---

## Event 1 — Email fetched
Input:
- Graph message ID

System:
- fetch approved mailbox message
- retrieve metadata/body/attachments
- hash relevant content
- persist source reference

Output:
InboundCommunication

Failure:
- not found
- token expired
- Graph unavailable

Audit:
EMAIL_INGESTED

---

## Event 2 — Attachment security pipeline
For each attachment:
- MIME sniff
- extension mismatch
- file-size policy
- malware scan
- archive safety
- quarantine if suspicious

Output:
Safe / Quarantined / Unsupported

No AI processing on quarantined content.

---

## Event 3 — Matter candidate retrieval
System uses tenant-scoped:
- explicit matter ref
- claim ref
- sender/recipient
- conversation history
- entities
- content signals

Output:
ranked candidates

---

## Event 4 — Match decision
If deterministic/confidence policy met:
- provisional match

Otherwise:
- MATCH_REVIEW exception

No write-back yet.

---

## Event 5 — Classification
Classify email and attachments:
- client
- insurer
- liability
- medical
- expert
- court
- quantum
- offer
- onboarding
- finance
- other

Output:
classification + confidence

Low confidence:
CLASSIFICATION_REVIEW exception

---

## Event 6 — Structured extraction
Potential fields:
- claim reference
- date
- amount
- response/admission
- appointment
- person
- provider
- explicit deadline
- requested item

All extracted fields retain source provenance.

---

## Event 7 — Action detection
Possible proposed actions:
- file only
- create task
- chase
- update non-critical field
- create draft
- candidate deadline
- escalate to fee earner

---

## Event 8 — Policy engine
Inputs:
- action type
- confidence
- matter security
- user policy
- document sensitivity
- external impact

Output:
AUTO
REVIEW
BLOCK

---

## Event 9 — Human review
Reviewer sees:
- source email
- evidence
- candidate matter
- classification
- proposed actions
- confidence
- reason

Actions:
approve/edit/reject

---

## Event 10 — Canonical commit
Create/update:
- communication
- document
- matter event
- task
- candidate deadline
- audit

Use transaction where appropriate.

---

## Event 11 — Proclaim write-back
Only approved/allowed actions.

Each write:
- idempotency key
- source canonical ID
- response/result
- verification/read-back where practical

Failure:
WRITEBACK_EXCEPTION

---

## Event 12 — Completion
Mark source event:
PROCESSED / REVIEWED / PARTIAL / FAILED

Metrics:
- end-to-end latency
- human minutes
- automation count
- exception count
