# INFORMATION BARRIER / MATTER SECURITY DATA MODEL

## Regulatory rationale
SRA confidentiality guidance addresses situations where the firm possesses material confidential information concerning a client/former client whose interests are adverse to another client.

The product must support effective barriers rather than assuming every employee of a firm may view every matter.

## Core concepts

### SecurityZone
Represents a restricted information domain.

Fields:
- id
- tenant_id
- name
- reason
- created_by
- approved_by
- status

### SecurityZoneMember
- zone_id
- user/team
- access type
- expiry
- approval

### MatterSecurity
- matter_id
- visibility:
  - standard
  - team restricted
  - private
  - security zone
- zone_id
- break_glass_policy

### DocumentSecurity
Document may be more restricted than matter:
- inherits matter
- specific restriction
- privileged subclass
- ethical wall

### ConflictFlag
- parties
- related matters
- reason
- severity
- status
- reviewer

## Authorisation order
Before return/access:
1. tenant match
2. account active
3. baseline permission
4. matter membership/role
5. security-zone rule
6. document override
7. legal hold does not grant read access
8. break-glass only if authorised

## Search
Search index must never reveal:
- title
- snippet
- client name
- existence of restricted matter
unless user's effective policy permits it.

## Reporting
Aggregated reporting must avoid inference attacks:
Example:
an unauthorised user should not infer a secret client from dashboard filters.

## Break-glass
If implemented:
- reason mandatory
- step-up MFA
- time-limited
- high-priority alert
- audit
- retrospective review

## Source
SRA confidentiality:
https://www.sra.org.uk/solicitors/guidance/confidentiality-client-information/
