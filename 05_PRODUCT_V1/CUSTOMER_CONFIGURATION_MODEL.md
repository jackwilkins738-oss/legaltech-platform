# CUSTOMER CONFIGURATION MODEL

## Goal
Powerful configuration without custom-code chaos.

## Configuration layers

### Firm
- terminology
- retention
- security
- notification
- AI policy
- defaults

### Practice area
- stages
- document classes
- task types
- workflows
- SLAs

### Team
- queues
- assignments
- escalation

### Matter type
- required fields
- checklists
- templates
- automations

## Every config object
- ID
- tenant
- version
- draft/published
- created by
- reviewed by
- effective date
- schema validation
- audit

## Deployment
Draft
→ validate
→ test tenant/sandbox
→ preview affected workflows
→ approval
→ publish
→ rollback available

## Guardrails
Customers cannot configure:
- cross-tenant access
- bypass of core security
- arbitrary code execution
- arbitrary external network calls
- unrestricted AI tools

## Extension
Later:
approved connector/actions marketplace.

## Strategic advantage
The customer can change operations without:
- vendor consultancy ticket
- obscure scripting
- production-only trial and error
