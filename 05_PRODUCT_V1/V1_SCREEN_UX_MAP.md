# V1 SCREEN / UX MAP

## Principle
The V1 is not a full PMS.
Every screen exists to reduce inbound admin or resolve exceptions.

## 1. Login / SSO
- Entra/OIDC
- MFA handled by IdP where enterprise
- tenant context

## 2. My Work
Default landing page.

Sections:
- urgent exceptions
- approvals
- failed writes
- deadline candidates
- assigned tasks

No giant dashboard clutter.

## 3. Inbound Queue
Columns:
- received
- sender
- likely matter
- type
- action
- confidence
- risk
- status

Bulk action only for low-risk homogeneous items.

## 4. Review Drawer
Single-item review.

Shows:
- source message
- attachments
- candidate matter
- match evidence
- classification
- extracted data
- proposed action
- confidence
- audit/context

Actions:
approve
edit
reject
escalate

## 5. Matter View
V1 subset:
- identity/header
- latest communications
- documents
- tasks
- deadline candidates
- exceptions
- Proclaim sync status

## 6. Exceptions
Filters:
- match
- classification
- deadline
- failed write
- security
- missing info
- stale

Sort:
- risk
- age
- deadline proximity

## 7. Team Leader
- team exceptions
- oldest
- highest risk
- queue volume
- automation rate
- backlog

## 8. Admin
- teams
- mailbox connections
- Proclaim connection
- document classes
- task types
- workflow versions
- approval policies
- AI policy

## 9. Audit
Searchable by:
- matter
- actor
- action
- date
- integration
- result

## UX acceptance philosophy
Each core V1 flow should be measured against:
- time
- interactions
- decision burden
- error rate
