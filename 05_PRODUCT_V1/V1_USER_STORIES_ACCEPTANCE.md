# V1 USER STORIES & ACCEPTANCE CRITERIA

## Story 1 — Receive email
As a legal admin,
I want incoming approved mailbox emails to enter the system automatically,
so I do not manually import them.

Acceptance:
- approved mailbox only
- duplicate notifications do not duplicate records
- attachment security scan completes before processing
- source trace retained
- failure visible

## Story 2 — Matter match
As a legal admin,
I want likely matter identified with evidence,
so I can confirm quickly.

Acceptance:
- candidate never outside authorised tenant
- confidence displayed
- evidence displayed
- ambiguous match enters exception queue
- human can correct
- correction audited

## Story 3 — Classification
As a case handler,
I want correspondence classified,
so downstream work can be created.

Acceptance:
- class + confidence
- human override
- source retained
- low confidence reviewed

## Story 4 — Proposed task
As a fee earner,
I want required action suggested from correspondence.

Acceptance:
- task source shown
- proposed due date/source shown
- user can edit
- no legal deadline becomes authoritative without policy/human confirmation

## Story 5 — Proclaim write-back
As an admin,
I want approved item filed back to Proclaim.

Acceptance:
- idempotent
- result verified
- failure visible
- retry does not duplicate
- audit exists

## Story 6 — Exception queue
As a team leader,
I want risky/uncertain items prioritised.

Acceptance:
- reason shown
- risk/age
- owner
- evidence
- approve/edit/reject
- resolved state

## Story 7 — Restricted matter
As a firm,
I need restricted matters not to leak.

Acceptance:
- unauthorized user cannot search/list/read
- AI cannot retrieve
- logs do not expose sensitive title unnecessarily
- break-glass audited if enabled
