# WORKFLOW ENGINE REQUIREMENTS

## Objective
Give authorised operations teams powerful automation without requiring legacy specialist coding.

## Core primitives

### Trigger
- matter created
- field changed
- email received
- document received
- deadline approaching
- task completed
- time elapsed
- integration event

### Condition
- matter type
- stage
- role
- field value
- document present/missing
- elapsed time
- confidence
- risk class

### Action
- create task
- assign
- update metadata
- create draft
- request document
- notify
- call integration
- wait
- require approval
- branch

## Safety
- versioned definitions
- draft/published state
- test mode
- preview
- dry-run
- approval
- rollback
- kill switch
- tenant scope
- service identity
- max permissions
- audit

## Idempotency
Every workflow execution/action needs stable idempotency key.

## Failure handling
- retries
- exponential backoff
- DLQ
- visible failure
- manual retry
- no duplicate external send

## Builder UX
Operations user should see:
WHEN
IF
THEN
ELSE
WAIT
APPROVE

Avoid forcing technical scripting for ordinary workflows.

## Enterprise governance
Customer can require:
- maker/checker
- workflow approval
- deployment windows
- test evidence
- change notes

## Metrics
Per workflow:
- executions
- success
- failure
- manual intervention
- time saved
- exceptions
