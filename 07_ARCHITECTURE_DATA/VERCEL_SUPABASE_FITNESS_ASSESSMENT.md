# VERCEL + SUPABASE FITNESS ASSESSMENT

## Vercel

### Good for
- fast web deployment
- previews
- frontend
- early application/API workload

### Concerns to validate before enterprise legal production
- exact regional execution/storage behavior for every product used
- log retention/data
- private networking
- workload identity
- customer security requirements
- incident/forensics access
- egress dependencies

## Supabase

### Good for
- Postgres foundation
- rapid development
- Row Level Security
- storage
- auth capability
- SQL portability

### Strong design rule
Use standard Postgres semantics wherever possible.
Do not make critical business logic depend on hard-to-port proprietary features.

### Concerns to validate
- region
- backups/PITR
- restore workflow
- support SLA
- private network options
- production access model
- log/SIEM export
- encryption/key options
- enterprise contracts

## Decision
Suitable candidates for prototype/early pilot if contractual/security requirements are satisfied.
Not automatically approved for every future enterprise deployment.

## Exit plan
Maintain:
- SQL migrations
- database dump/restore procedure
- storage export
- standard OAuth/identity abstractions
- infrastructure docs
