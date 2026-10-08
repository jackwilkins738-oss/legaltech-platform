# Security Policy

This repository contains a pre-production legal-operations platform and research corpus.

## Do not commit
- customer/client data
- real legal matter data
- access tokens, API keys, private keys/certificates, passwords or connection strings
- production exports or mailbox content

Use synthetic/anonymised data only unless an explicitly authorised customer environment and approved secure workflow exist.

## Real-client-data gate
`ALLOW_REAL_CLIENT_DATA` is fail-closed. Enabling it requires reviewed evidence for production OIDC/session controls, managed secrets/KMS and infrastructure, network isolation, monitoring/audit export, encrypted backup and restore, hostile-file scanning and isolated parsing, authorised Graph/Proclaim validation, and an independent penetration test. Environment values are interlocks and are not evidence by themselves.

## Repository protections
Security-sensitive files have CODEOWNERS. CI Actions are expected to be pinned to immutable 40-character commit SHAs, checkout credentials must not persist, and dependency/security workflows must remain required checks before merge. Repository branch-protection rules are an external GitHub setting and must require review plus successful security/CI checks on `main`.

## Reporting a vulnerability
Do not open a public GitHub issue for a suspected vulnerability. Report privately to the repository owners and record remediation in the security workstream.

## Current status
The repository contains security controls, tests and design targets. It does not claim production certification, completed penetration testing, or regulatory compliance.
