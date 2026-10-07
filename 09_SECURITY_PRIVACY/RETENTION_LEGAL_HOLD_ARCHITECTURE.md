# RETENTION & LEGAL HOLD ARCHITECTURE

## Principle
Retention is policy-driven and customer-configurable.
Never assume one universal duration is legally correct for all records.

## SRA considerations
SRA closing-practice guidance says:
- old files should not be held indefinitely
- firms need proper destruction plans
- confidentiality remains
- ownership of papers may differ
- originals such as wills should not simply be destroyed
- data protection requirements apply to stored files

## Data model

### RetentionPolicy
- tenant
- record class
- practice area
- trigger
- period
- review rule
- disposition
- approval requirement

### RetentionInstance
Applied to:
- matter
- document
- communication
- audit data
- finance record

### LegalHold
- scope
- reason
- authority
- applied_at
- released_at
- owner
- affected records

Legal hold overrides ordinary destruction.

## Lifecycle
Active
→ closed
→ retention running
→ destruction review
→ authorised destruction
→ tombstone/audit evidence

## Deletion architecture
Must consider:
- transactional DB
- documents
- search
- derived OCR
- thumbnails
- caches
- analytics
- AI temporary copies
- integration caches
- backup expiry

## Backup nuance
A deleted record may persist in immutable backup until backup rotation expires.
Document this clearly.
Do not silently "restore" previously deleted records into live product during disaster recovery without deletion reconciliation.

## Client export
Before end-of-contract deletion:
- customer export
- integrity manifest
- export audit
- confirmation
- retention countdown

## Source
SRA closing practice guidance:
https://www.sra.org.uk/solicitors/guidance/closing-down-your-practice/
