# AUDIT EVENT TAXONOMY

## Principle
Two logs:
1. operational/debug logs
2. immutable or strongly protected audit/security events

Do not rely on normal application logs for legal-grade audit.

## Event envelope
Every audit event:
- event_id
- timestamp
- tenant_id
- actor_type
- actor_id
- session/service identity
- action
- object_type
- object_id
- matter_id if applicable
- outcome
- reason
- source
- request/trace ID
- IP/device metadata where proportionate
- before/after references where appropriate
- approval ID
- automation/model version if applicable

## Identity events
- login success/failure
- MFA challenge
- password reset
- session revoke
- SSO config change
- SCIM provisioning/deprovisioning

## Access events
- matter viewed
- restricted document viewed
- document downloaded
- search returning sensitive object
- break-glass request/use
- permission denied

## Permission events
- role changed
- team changed
- matter access granted/revoked
- security barrier created/changed
- privileged role granted

## Data events
- matter created
- field changed
- document uploaded
- version added
- delete requested
- legal hold applied
- export created

## Communication events
- email imported
- recipient mapped
- draft created
- outbound approved
- outbound sent
- send blocked

## Workflow events
- workflow published
- workflow version changed
- automation triggered
- action proposed
- action approved/rejected
- action executed
- retry
- failure
- kill switch used

## AI events
- provider/model
- prompt template/version
- source objects
- output type
- confidence
- tool requests
- policy denial
- approval
Do not log unnecessary raw privileged content.

## Admin/support
- support access granted
- impersonation/session initiated
- production query
- config change
- secret rotated

## Retention
Audit retention should be separately defined from ordinary app logs.
Audit logs themselves contain personal/confidential metadata and require controlled access.
