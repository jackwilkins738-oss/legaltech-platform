# V1 PERMISSION / AUTHORIZATION MATRIX

## Capabilities

### Ordinary user
- view assigned/permitted matters
- view permitted documents
- work own/team tasks
- review assigned exceptions
- create ordinary drafts

### Team leader
Plus:
- team queue
- reassign tasks
- approve low/medium internal workflow actions
- view team analytics

### Fee earner / responsible lawyer
- confirm legal deadline
- approve material correspondence
- approve matter-specific high-impact changes

### Operations admin
- manage workflows/configuration
- cannot automatically view restricted matter contents unless separately permitted

### Firm security/admin
- users
- roles
- SSO
- security zones
- audit access

### Support staff — our company
No default customer-content access.

Temporary support access:
- customer authorised
- time limited
- purpose
- logged
- restricted scope

### Internal platform engineer
No standing production customer-content access.

## Sensitive actions
Require elevated permission:
- export matter
- bulk export
- delete
- legal hold
- add/remove security-zone membership
- break-glass
- change Graph integration
- change Proclaim integration
- publish workflow
- enable autonomous external send

## Step-up authentication
Consider for:
- bulk export
- break-glass
- privileged role change
- integration secret change
- sensitive security config

## Separation of duties
Where customer wants:
maker != approver for:
- workflow publish
- security barrier modification
- autonomous send policy
