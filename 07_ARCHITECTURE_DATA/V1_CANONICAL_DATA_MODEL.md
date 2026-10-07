# V1 CANONICAL DATA MODEL

## Rule
Do not copy Proclaim's schema.
Model the business domain cleanly.

## Tenant
- id
- name
- jurisdiction
- configuration
- status
- residency region

## Branch
- id
- tenant_id
- name

## Team
- id
- tenant_id
- branch_id
- name

## User
- id
- tenant_id
- identity_provider_id
- status

## Role
- id
- tenant_id
- permissions

## Matter
- id
- tenant_id
- external_ids
- practice_area
- status
- stage
- responsible_user
- team
- opened_at
- closed_at

## Party
Generic entity relationship:
- person/organisation
- role in matter
Examples:
client, opponent, insurer, expert, solicitor, court.

## Communication
- id
- tenant_id
- matter_id
- type
- external_id
- direction
- participants
- subject
- body reference
- timestamp
- classification
- filing status

## Document
- id
- tenant_id
- matter_id
- source
- current_version_id
- type/classification
- security classification
- retention
- legal_hold

## DocumentVersion
- id
- document_id
- storage_key
- hash
- MIME
- size
- created_by
- created_at

## Task
- id
- tenant_id
- matter_id
- type
- owner
- due
- priority
- state
- source_event
- approval_policy

## Deadline
Separate from generic task:
- legal significance
- source
- calculation
- confirmed_by
- confidence
- date
- reminders
- risk

## MatterEvent
Append-oriented domain timeline:
- event_type
- actor
- source
- timestamp
- structured payload

## WorkflowDefinition
- tenant
- version
- state
- triggers
- rules
- actions
- approvals

## WorkflowRun
- workflow version
- matter
- trigger
- state
- steps
- failures
- retry

## AutomationDecision
- input references
- model/rule version
- output
- confidence
- approved/rejected
- approver
- reasoning metadata
- timestamp

## IntegrationConnection
- tenant
- provider
- scopes
- secret reference
- status
- last_sync

## ExternalMapping
Maps canonical objects to:
- Proclaim
- Graph
- other vendors

## AuditEvent
Security/business audit:
- tenant
- actor
- action
- target
- source IP/device where appropriate
- timestamp
- outcome
- trace

## Important
Every sensitive row must inherit tenant ownership.
Permissions should not rely solely on UI filtering.
