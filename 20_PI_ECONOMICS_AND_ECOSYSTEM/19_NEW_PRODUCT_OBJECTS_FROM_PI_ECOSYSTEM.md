# NEW CANONICAL PRODUCT OBJECTS

## Proposed future objects

### ProtocolCase
- protocol
- portal_id
- stage
- due dates
- exit reason

### MedicalInstruction
- provider
- MedCo state
- appointment
- report
- invoice

### EvidenceRequest
- provider
- scope
- authority
- dates
- receipt completeness

### ExternalInstruction
- professional
- instruction
- fee
- SLA
- deliverable

### FundingArrangement
- type
- provider
- premium/facility
- obligations

### Disbursement
- supplier
- amount
- committed/paid/recovered

### Offer
- offer type
- amount
- dates
- status

### RehabilitationPlan
- provider
- needs
- treatment
- funding
- progress

### ClientFundingDisclosure
- agreement/version
- disclosure
- acknowledgement

### Complaint
- issue
- opened
- SLA
- outcome

### MatterEconomics
- staff cost
- disbursement exposure
- recoverable-cost state
- settlement/cash state

### ExternalPartyProfile
- organisation
- role
- references
- performance stats

## Architecture principle
These are canonical legal-operations objects.
Proclaim fields map into/out of them.

Do not make Proclaim's schema the domain model.
