# V1 INTEGRATION TEST PLAN

## Microsoft Graph

### Authentication
- admin consent
- revoked consent
- expired token
- wrong tenant
- insufficient scope

### Webhooks
- validation
- duplicate notification
- delayed notification
- missed notification
- invalid clientState
- subscription expiry
- lifecycle event

### Mail
- shared mailbox
- user mailbox
- large attachment
- unsupported attachment
- thread
- forwarded email
- reply
- multiple recipients
- encrypted/S-MIME edge case
- deleted/moved email

### Reconciliation
- delta replay
- missed event
- duplicate event

## Proclaim

### Read
- valid matter
- invalid matter
- closed matter
- restricted matter if API exposes restriction

### Write
- history
- email
- document
- task
- field

### Conflict/failure
- Proclaim unavailable
- timeout
- authentication failure
- version mismatch
- duplicate write
- partially completed operation
- stale data

## End-to-end
Email arrives
→ Graph event
→ fetch
→ classify
→ match
→ approval
→ Proclaim write
→ read-back validation
→ audit event

## Acceptance
No action considered successful until:
- target system confirms
- canonical system records result
- audit event exists

## Chaos/failure tests
- Graph outage
- Proclaim outage
- AI outage
- queue outage
- worker crash
- repeated webhook
- database transaction failure

System must avoid duplicate outbound actions.
