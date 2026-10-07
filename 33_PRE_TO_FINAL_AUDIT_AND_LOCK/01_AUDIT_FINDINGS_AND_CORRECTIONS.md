# FINAL PRE-TO AUDIT — FINDINGS AND CORRECTIONS

## Critical corrections made

### 1. Observation timing and volume were mixed
Previous workbook structure allowed active minutes, estimated events/day and estimated headcount to live in each observation row and then be averaged into annual economics.

Risk:
- an estimate repeated 10 times could appear more evidenced than one estimate;
- broad task categories could mix very different workflows and roles;
- annual capacity could be over/understated.

Correction:
- direct observations remain in `TO Observations`;
- frequency/headcount validation moves to `Volume Validation`;
- annualisation occurs at `Task Family × Role` in `Task Family Analysis` only when volume is independently marked validated.

### 2. Task category was too broad for wedge economics
`FILE`, `CHASE`, `EVIDENCE` etc. are useful taxonomy labels but not sufficiently specific for economics.

Correction:
add `Task Family` such as:
- file insurer liability email;
- chase GP records;
- create task after medical report;
- client status update after liability admission.

### 3. Sampling method was not recorded
Without session/sample context, targeted observation could be mistaken for natural prevalence.

Correction:
add `Session Log` and `Sample Mode`:
- CALIBRATION
- CONTINUOUS
- TARGETED_REPEAT
- FOLLOW_UP

### 4. Timing contamination was not explicit
Interruptions, batching and abnormal cases can distort handling time.

Correction:
record:
- normal path?;
- interrupted?;
- batch size;
- handoffs;
- include/exclude decision.

### 5. Waiting time was under-specified
A single `Waiting Minutes` field cannot cleanly describe multi-day external delay and risks confusing cycle time with labour.

Correction:
retain the old field for backward compatibility but add:
- wait duration;
- wait unit;
- waiting on.

External waiting must never be added directly to labour hours.

### 6. Native Proclaim capability was not captured per task
The repo challenges configuration-vs-product globally, but the observation row did not force the question.

Correction:
record:
- native Proclaim automation?;
- why manual?

### 7. Economic/non-labour consequence was not captured per task
A low-labour workflow may still matter if it delays settlement, capital recovery, deadlines or client service.

Correction:
record impact type and severity, without monetising unverified risk.

### 8. Opportunity scorecard could inherit weak annualisation
The scorecard automatically referenced broad Task Summary economics.

Correction:
annual capacity input is now gated/manual and must come from validated Task Family × Role analysis.

### 9. Thirty observations could be over-interpreted
Thirty events is a useful first review trigger, not a market/statistical validation threshold.

Correction:
Day-1 sheet and methodology explicitly label it as hypothesis generation only.

### 10. Employee/privacy boundary needed to be stronger
A process study can accidentally become employee monitoring or capture client data.

Correction:
process-level only, no covert recording, no employee ranking, anonymised case identifiers, authorisation required.

## Clarification
The Day-0 workbook does contain the role-cost lookup formula. The visible £25 in blank rows is the intended fallback/cached value before a Role is selected; it was not a missing formula.

## No further pre-TO engineering is necessary
Additional application code before the first TO evidence is now lower value than preserving attention for observation quality and rapid post-TO analysis.
