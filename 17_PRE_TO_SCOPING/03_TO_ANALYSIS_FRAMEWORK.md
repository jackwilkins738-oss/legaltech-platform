# TIME-AND-MOTION ANALYSIS FRAMEWORK

## Objective
Capture work at enough resolution to calculate annual cost and identify safe automation boundaries.

## Unit of observation
A **task event**.

Do not record:
"worked on file."

Record:
"opened Outlook email → searched Proclaim → identified matter → dragged email to history → renamed attachment → created action."

---

# Fields to capture

## Context
- date
- role
- team
- practice area
- matter type
- task category
- trigger

## Task execution
- start time
- end time
- active minutes
- waiting minutes
- systems touched
- number of system switches
- approximate clicks/steps
- copy/paste?
- re-keying?
- template used?
- search required?

## Inputs
- email
- attachment
- scanned document
- phone call
- client portal
- internal instruction
- court notice
- Proclaim task
- other

## Outputs
- history item
- saved document
- task
- field update
- email
- call
- letter
- diary/deadline
- approval
- other

## Judgement
0 — none
1 — simple known rule
2 — contextual choice
3 — experienced admin judgement
4 — legal judgement
5 — senior legal judgement

## Exception
- normal path?
- exception?
- what made it exceptional?
- frequency estimate?

## Rework/error
- task previously done incorrectly?
- duplicate?
- missing info?
- correction needed?
- supervisor review?

## Pain
Ask worker:
- annoying?
- slow?
- risky?
- why?
Do not translate annoyance directly into commercial value.

---

# Categorisation

Every task receives a canonical category:
- FILE
- CLASSIFY
- MATCH
- EXTRACT
- DATA_ENTRY
- CREATE_TASK
- CHASE
- CLIENT_UPDATE
- DRAFT
- REVIEW
- DEADLINE
- EVIDENCE
- INTAKE
- BILLING
- SEARCH
- REPORT
- OTHER

---

# Automation classification

## A0 — no automation
Primarily professional judgement.

## A1 — assist
AI/automation prepares information.

## A2 — propose
System recommends task/action for approval.

## A3 — reversible internal automation
System performs safe internal action.

## A4 — controlled external automation
System communicates externally within approved constraints.

## A5 — high-impact
Normally requires explicit human authorisation.

---

# Calculations

For each task family:

Observed events/day/team

× average active minutes

× working days

= annual active minutes

÷ 60

= annual hours

× loaded hourly cost

= annual capacity cost

Then add:
- rework capacity
- supervisor review
if separately measurable.

---

# Wait-time analysis
Track separately:
- time waiting for provider
- time waiting for insurer
- time waiting for client
- time waiting for expert
- internal queue delay

This can reveal high-value services even when human labour is low.

Example:
A 3-minute chase may not save much labour, but automating it may shorten a 30-day evidence delay.

---

# Confidence rules

## MEASURED
Observed directly enough times to establish a stable estimate.

## OBSERVED
Seen directly but low sample.

## REPORTED
Employee estimates.

## ASSUMED
Founder/research assumption.

Opportunity ranking must display confidence.

---

# Minimum useful sample tomorrow

Do not chase statistical perfection on day one.

Target:
- 30+ task events
- 3+ roles if available
- repeated observations of top task families
- at least one normal case and one exception for important workflows

Then continue over multiple days.

---

# What we want to learn tomorrow

1. Which repeated tasks dominate active minutes?
2. Which tasks cause the most context switching?
3. Which tasks occur outside Proclaim?
4. Which tasks already have templates/workflows?
5. Which tasks require true judgement?
6. Which tasks frequently wait on third parties?
7. Which errors/rework recur?
8. Which tasks would staff happily stop doing?
9. Which tasks are supervisors repeatedly checking?
10. Which workflow creates the strongest measurable business case?
