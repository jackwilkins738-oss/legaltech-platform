# V1 SCREEN-BY-SCREEN SPECIFICATION

## Design rule
V1 exists to resolve inbound operations and exceptions.
Do not build a full PMS navigation system.

---

# SCREEN 1 — MY WORK

## Purpose
User immediately sees only work requiring human attention.

## Sections
1. Critical
2. Due today
3. Match/classification review
4. Approvals
5. Failed write-backs
6. Assigned tasks

## Each item
- matter/client display
- reason
- source
- risk
- age/due
- recommended action

## Actions
- open review
- approve
- assign
- snooze where allowed

No vanity charts above work.

---

# SCREEN 2 — INBOUND QUEUE

Columns:
- received
- source mailbox
- sender
- subject
- candidate matter
- classification
- proposed action
- confidence
- state

Filters:
- unmatched
- low confidence
- quarantined
- ready
- failed
- processed

Bulk action:
Only where risk policy explicitly allows.

---

# SCREEN 3 — REVIEW DRAWER

## Left
Original email/document.

## Centre
System understanding:
- candidate matter
- evidence for match
- class
- extracted entities
- candidate dates
- proposed tasks

## Right
Decision:
- approve
- edit
- reject
- assign/escalate

Display:
"Why?"
for every material proposal.

---

# SCREEN 4 — MATTER OPERATIONS VIEW

Not a full PMS.

Header:
- matter ref
- client
- responsible handler
- canonical stage
- Proclaim sync

Tabs:
- Activity
- Documents
- Tasks
- Exceptions
- Deadline candidates

Highlight:
- what changed
- what is waiting
- next human action

---

# SCREEN 5 — EXCEPTION QUEUE

Types:
- MATCH
- CLASSIFICATION
- SECURITY
- DEADLINE
- WRITEBACK
- MISSING_INFO
- WORKFLOW_FAILURE

Columns:
- priority
- matter
- type
- reason
- created
- due/risk
- owner

Must explain priority.

---

# SCREEN 6 — TEAM LEADER

KPIs:
- open exceptions
- oldest exception
- overdue tasks
- inbound volume
- auto-processed %
- manual-review %
- failed writes
- queue by user

Then:
ranked intervention list.

---

# SCREEN 7 — ADMIN / CONFIG

Sections:
- users/teams
- mailboxes
- Proclaim connection
- matter mappings
- document classes
- task types
- approval policies
- workflows
- AI policy

Every production change:
- version
- actor
- time
- audit

---

# SCREEN 8 — WORKFLOW BUILDER

WHEN
IF
THEN
ELSE
WAIT
APPROVE
ESCALATE

Features:
- draft
- validation
- synthetic test
- historical replay simulation
- publish
- rollback

---

# SCREEN 9 — AUDIT

Search:
- actor
- matter
- action
- integration
- workflow
- date
- outcome

Audit event should be readable by compliance/IT, not only engineers.

---

# V1 UX success tests

Measure against current workflow:
- seconds per review
- clicks/interaction count
- correction rate
- training time
- queue completion
- failed/abandoned actions

The goal is not "looks modern."
The goal is fewer decisions and fewer repeated actions.
