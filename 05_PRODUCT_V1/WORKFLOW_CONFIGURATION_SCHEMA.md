# WORKFLOW CONFIGURATION SCHEMA / DSL

## Goal
Human-readable, validated, versionable workflow configuration.

## Conceptual YAML example

workflow:
  id: inbound_insurer_response
  version: 3
  trigger:
    event: communication.classified
    where:
      classification: insurer_response

  conditions:
    - field: match.confidence
      operator: gte
      value: 0.98

  actions:
    - type: create_task
      parameters:
        task_class: REVIEW
        subtype: REVIEW_LIABILITY_RESPONSE
        assignee: matter.responsible_user
      risk: internal_reversible

    - type: require_approval
      when:
        extracted.admission_status: unknown

## Allowed primitives
TRIGGER
IF
ELSE
WAIT
CREATE_TASK
UPDATE_METADATA
CREATE_DRAFT
NOTIFY
REQUEST_APPROVAL
CALL_APPROVED_CONNECTOR
STOP
ESCALATE

## Forbidden
- arbitrary shell/code
- arbitrary SQL
- unrestricted HTTP
- arbitrary secret access
- bypass authorization

## Validation
Before publish:
- schema
- references
- permissions
- cycles
- unreachable branches
- action risk
- integration capability
- tests

## Simulation
Input historical/synthetic event.
Show:
- branches
- actions
- side effects without executing

## Versioning
Published version immutable.
New edit creates next version.

## Rollback
Switch future executions to previous valid version.
Do not rewrite historical workflow-run identity.
