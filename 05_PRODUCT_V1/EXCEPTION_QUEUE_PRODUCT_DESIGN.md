# EXCEPTION QUEUE — PRODUCT DESIGN

## Product philosophy
Routine work disappears into automation.
Humans work exceptions.

## Exception classes

### Match
"Cannot confidently identify matter."

### Classification
"Document type uncertain."

### Data conflict
"Claim reference conflicts with matter."

### Missing information
"Required medical record still missing."

### Deadline
"Potential legal deadline requires confirmation."

### Approval
"Outbound email awaiting approval."

### Workflow failure
"Proclaim write-back failed."

### Risk
"Restricted/conflict matter."

### Stale case
"No activity for configured period."

### SLA
"Third party has not responded."

## Priority score
Combine:
- legal risk
- deadline proximity
- client impact
- age
- financial impact
- confidence
- customer SLA

## Queue UX
User should see:
- why this is here
- evidence
- suggested action
- risk
- one-click decision where safe

## Manager UX
- exceptions by type
- oldest
- risky
- owner
- team load
- systemic failure

## Learning
Rejected/corrected suggestions feed evaluation metrics.

## Anti-pattern
Do not create another task list with 400 items.
The queue should exist specifically because automation has removed routine work.
