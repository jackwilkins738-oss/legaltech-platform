# SECRETS / KEY MANAGEMENT DESIGN

## Secret classes
- database credentials
- Graph app credentials
- Proclaim integration credentials
- AI provider API credentials
- webhook secrets
- signing keys
- encryption keys
- SMTP/notification credentials

## Principles
- dedicated secret manager
- references in application config, not raw values
- per environment
- per customer where customer-specific
- least privilege
- rotation
- audit
- emergency revoke

## Graph
Prefer certificate/managed workload identity where supported over long-lived shared secrets.

## Encryption keys
Managed KMS.
Application should not store master key material.

## Key hierarchy
Cloud/KMS root
→ key-encryption key
→ data keys where application-level encryption justified

## Rotation
Document:
- normal interval
- compromise rotation
- overlapping validity where needed
- dependent-service update

## Claude/AI coding rule
Never paste:
- production secret
- customer credential
- private key
into prompts/chat.

Use placeholders and secret references.

## Secret scanning
CI + repository scanning.
Push protection enabled where supported.

## Emergency
Runbook:
- identify scope
- revoke
- rotate
- redeploy
- inspect logs
- notify customers if required
