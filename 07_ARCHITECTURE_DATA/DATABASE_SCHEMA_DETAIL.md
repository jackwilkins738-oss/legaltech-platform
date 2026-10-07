# V1 DATABASE SCHEMA — DETAILED LOGICAL DESIGN

## tenants
id UUID PK
name
status
region
created_at

## branches
id
tenant_id FK
name

## teams
id
tenant_id
branch_id
name

## users
id
tenant_id
external_identity_id
email
status
created_at

## roles
id
tenant_id
name

## user_roles
user_id
role_id
scope_type
scope_id

## security_zones
id
tenant_id
name
reason
status

## security_zone_members
zone_id
principal_type
principal_id
expires_at

## matters
id
tenant_id
external_reference
practice_area
canonical_stage
status
responsible_user_id
team_id
security_zone_id nullable
opened_at
closed_at
created_at
updated_at

Indexes:
tenant_id
tenant_id + external_reference
tenant_id + status
tenant_id + team_id

## parties
id
tenant_id
entity_type
display_name
email
phone

## matter_parties
matter_id
party_id
role_type

## communications
id
tenant_id
matter_id nullable until matched
source
external_id
conversation_external_id
direction
sender_party_data
subject
body_storage_reference
received_at
match_status
classification
sensitivity
created_at

Unique:
tenant_id + source + external_id

## documents
id
tenant_id
matter_id nullable
communication_id nullable
current_version_id
classification
sensitivity
security_zone_id nullable
retention_policy_id nullable
legal_hold_state

## document_versions
id
tenant_id
document_id
storage_key
sha256
mime_type
size_bytes
source_filename
created_at
created_by

## tasks
id
tenant_id
matter_id
task_class
task_subtype
title
owner_user_id
team_id
status
priority
due_at
source_event_id
workflow_run_id
risk_level

## deadlines
id
tenant_id
matter_id
title
candidate_date
confirmed_date nullable
status
source_object_type
source_object_id
source_locator
rule_id nullable
confidence nullable
confirmed_by nullable

## inbound_events
id
tenant_id
source
external_event_id
type
status
received_at
processed_at
attempt_count
payload_reference

## automation_decisions
id
tenant_id
matter_id nullable
source_object
decision_type
engine_type
model_name nullable
model_version nullable
rule_version nullable
confidence
proposed_output_json
policy_result
human_status
reviewed_by
created_at

## exceptions
id
tenant_id
matter_id nullable
type
severity
source_object
owner
status
reason
created_at
resolved_at

## integration_connections
id
tenant_id
provider
credential_reference
scope_json
status
last_success_at
last_error_at

## external_mappings
id
tenant_id
provider
canonical_type
canonical_id
external_id
external_version

Unique:
tenant_id + provider + canonical_type + external_id

## audit_events
append-oriented
id
tenant_id
timestamp
actor_type
actor_id
action
object_type
object_id
matter_id nullable
outcome
trace_id
metadata_json

## workflow_definitions
id
tenant_id
name
version
status
definition_json
published_at

## workflow_runs
id
tenant_id
workflow_definition_id
workflow_version
matter_id
trigger_event_id
status
started_at
completed_at

## Key design constraints
- all tenant-owned rows contain tenant_id
- foreign-key tenant consistency enforced where practical
- RLS/policies as defence in depth
- no unrestricted cross-tenant service role in ordinary app requests
