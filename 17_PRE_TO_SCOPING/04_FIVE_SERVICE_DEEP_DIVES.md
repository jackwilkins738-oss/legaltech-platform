# FIVE HIGHEST-PRIORITY SERVICE DEEP DIVES

These are not approved build commitments. They are the five most strategically attractive expansions to scope before TO data ranks them.

---

# 1. MATTER COMMAND / CASE HEALTH RADAR

## User
- team leader
- fee earner
- operations manager

## Job
"Show me which matters require attention and why."

## Inputs
- matter stage
- tasks
- emails
- documents
- deadlines
- last activity
- external dependencies
- workflow state
- client-update history

## Signals
- no activity for N days
- insurer response overdue
- records outstanding
- task overdue
- evidence incomplete
- unresolved exception
- candidate deadline
- client not updated
- Proclaim write-back failed

## Output
Ranked intervention queue.

## ROI
- supervision time
- fewer forgotten/stalled files
- lower queue age
- reduced manual file review

## Risk
Medium.
Do not imply legal negligence/risk without validated rules.

## Prerequisites
Canonical events + tasks + exception data.

## Expansion value
Extremely high.
Could become daily home screen.

## Competitor signal
CARET, Clio, Litify, Actionstep.

## Build hypothesis
P1 after inbound pipeline starts producing reliable events.

---

# 2. EVIDENCE COMPLETENESS ENGINE

## User
Fee earner / legal admin.

## Job
"Tell me exactly what evidence is expected, what we have and what is missing."

## Inputs
- practice pack
- matter stage
- matter type
- documents
- requests
- provider/date coverage

## Example
Expected:
GP records 2023–2026
Hospital records Feb–Apr 2026
Wage evidence
Signed authority

System:
GP records complete.
Hospital records missing March discharge notes.
Wage evidence not received.
Authority complete.

## ROI
- fewer manual file audits
- fewer delayed matters
- quicker evidence gathering
- reduces repeated checking

## Risk
Moderate:
false "complete" is more dangerous than false "missing."

## Safety
Completeness model must be conservative and evidence-cited.

## Prerequisites
document classification + practice pack + structured requests.

## Expansion value
High; directly feeds records orchestration and case health.

---

# 3. EVIDENCE / RECORDS ORCHESTRATION

## User
Legal admin / records team.

## Job
"Request evidence, chase it, reconcile what arrives and escalate only exceptions."

## Workflow
request created
→ provider
→ acknowledgement
→ chase schedule
→ receipt
→ document classification
→ date-range completeness
→ missing-items exception
→ matter updated

## Build vs partner
Build:
- orchestration
- state
- chasing
- reconciliation
- exception UX

Partner:
- fulfilment network
- specialist record retrieval

## ROI
Measure:
- staff touches/request
- days to complete record set
- chase count
- incomplete-return rate

## Risk
Sensitive health data; security/privacy high.

## Expansion value
Very high for PI/clinical negligence.

---

# 4. FIRM SKILLS / WORKFLOW AGENT BUILDER

## User
Operations / applications / practice head.

## Job
"Encode how our firm handles a repeated situation without asking a developer."

## Example
When insurer denial received:
- classify denial
- create review task
- set liability state
- notify handler
- prepare client update
- if limitation < X days, escalate

## Design
Natural-language assisted authoring
→ constrained workflow DSL
→ validation
→ simulation
→ approval
→ versioned publish.

## Never allow
- arbitrary code
- arbitrary SQL
- unrestricted web calls
- unrestricted AI tool choice
- hidden security bypass

## ROI
- less vendor consultancy
- faster operational changes
- reusable best practice
- creates customer-specific stickiness

## Strategic moat
Extremely high.

## Risk
A workflow engine is privileged.
Requires test/sandbox/audit/kill-switch.

---

# 5. MATTER INTELLIGENCE WORKSPACE

## User
Fee earner / supervisor.

## Job
"Understand a file without manually opening 40 documents."

## Queries
- What happened since last review?
- What are we waiting for?
- What did the insurer admit?
- Show the treatment chronology.
- Which documents support loss of earnings?
- What actions are outstanding?

## Requirements
- retrieval filtered before model
- source citations
- no restricted-matter leakage
- no unsupported assertion
- no direct autonomous high-impact action

## ROI
- review time
- handover time
- supervision
- chronology creation

## Risk
Hallucination / privilege / permissions.

## Differentiation
Do not make this just chat.
Answers should offer governed next actions:
"Create review task"
"Open source"
"Add to chronology"
"Request missing evidence"

## Expansion value
High.

---

# Initial strategic ranking before TO

1. Matter Command
2. Evidence Completeness
3. Firm Skills
4. Records Orchestration
5. Matter Intelligence

But **TO data may reorder 1–5**.
