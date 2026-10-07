# PROCLAIM CONNECTOR INTERFACE SPEC

## Purpose
Hide Proclaim-specific quirks behind one adapter.

Application code should not know whether a customer uses:
- Proclaim REST
- SOAP
- later CaseMatters Evo interface

## Interface

getMatter(externalMatterId)
→ CanonicalMatterSnapshot

searchMatter(criteria)
→ Candidate[]

getMatterHistory(id, cursor)
→ HistoryItem[]

createHistoryItem(matterId, payload, idempotencyKey)
→ ExternalWriteResult

uploadDocument(matterId, document, metadata, idempotencyKey)
→ ExternalWriteResult

postEmail(matterId, message, idempotencyKey)
→ ExternalWriteResult

createTask(matterId, task, idempotencyKey)
→ ExternalWriteResult

updateFields(matterId, fieldPatch, idempotencyKey)
→ ExternalWriteResult

healthCheck()
→ ConnectorHealth

## ExternalWriteResult
- external_id
- status
- submitted_at
- verified_at
- raw_reference
- retryable
- error_code

## Connector rules
- tenant connection explicit
- no global credentials
- secrets stored outside DB values
- read/write scopes separated where possible
- retry only known retryable failures
- idempotency enforced internally if Proclaim lacks native idempotency
- write-read verification for critical operations
- audit every write

## Reconciliation
Scheduled:
- pending writes
- failed writes
- externally changed state
- stale mapping
- missing history/document

## Unsupported operation
Return explicit capability error.
Never silently emulate dangerous behavior.

## Capability discovery
Per customer record:
- API version
- operations supported
- limits
- endpoint/config
- last validated
