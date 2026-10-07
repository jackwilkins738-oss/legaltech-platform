# PROCLAIM SPIKE RUNBOOK

## Question
Can our platform safely augment the real target firm's Proclaim installation through supported interfaces?

## Before touching system
Obtain:
- named authorisation,
- test matter(s),
- API/web-service docs available to customer,
- version/module information,
- service/integration account,
- restriction on production write tests.

## Test sequence

### Stage 0 — environment discovery
Capture:
- Proclaim version
- hosting
- REST/SOAP endpoints
- auth model
- API modules/licensing
- task/document server details
- CaseMatters Evo plans

### Stage 1 — read only
1. exact matter lookup
2. selected fields
3. matter history
4. document metadata
5. test-document retrieval
6. tasks/diary if available

Do not move to writes until read behavior and permissions are understood.

### Stage 2 — low-risk write
Use dedicated authorised test matter.

1. create history note
2. read it back
3. repeat same request via our idempotency layer
4. verify no unintended duplicate

### Stage 3 — file email/document
Test:
- email body/history metadata
- attachment/document
- filename/type
- read-back.

### Stage 4 — task/field
Only if authorised:
- create test action/task
- update non-critical test field
- verify.

### Stage 5 — failure recovery
For a test write:
- simulate client timeout after request;
- query/read back before retry;
- prove adapter does not blindly duplicate.

## Required output
Per capability:
GREEN / AMBER / RED / UNKNOWN

Also record:
- supported?
- documented?
- permission needed?
- latency
- external ID
- read-back
- retry behavior
- implementation notes

## Architectural decision
If write-back is unsafe but reads are strong:
do not abandon project automatically.

Consider:
- read-only intelligence + user-triggered Proclaim action;
- customer-side connector;
- staged migration;
- Microsoft add-in flow.

## Fail gate
Do not build around undocumented production write behavior we cannot reconcile.
