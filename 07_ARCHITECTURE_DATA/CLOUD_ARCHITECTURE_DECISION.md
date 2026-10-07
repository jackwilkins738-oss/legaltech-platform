# CLOUD ARCHITECTURE DECISION RECORD

## Decision
Use managed services early, preserve portability, move security-critical infrastructure toward a major-cloud-controlled environment as enterprise requirements justify.

## Early stack option
- Vercel: web/app delivery
- Supabase: Postgres/auth/storage selectively
- external queue/worker if needed
- dedicated secrets manager
- central monitoring

## Why not overbuild immediately
- two-founder team
- no proven load
- no paying pilot yet
- operational complexity reduces speed

## Why not lock in
Enterprise legal requirements may later demand:
- private networking
- strict UK region
- customer-specific networking
- dedicated KMS
- private endpoints
- advanced SIEM
- mature IAM
- workload identities
- multi-region DR
- customer-managed keys

## Target mature architecture
Likely major cloud:
AWS or Azure are natural UK legal-enterprise candidates.

### Azure advantage
Microsoft/Entra/Graph ecosystem alignment.

### AWS advantage
broad mature infrastructure/security ecosystem.

## Decision trigger to migrate/replatform
Any of:
- customer procurement requirement
- private networking requirement
- regulatory/residency issue
- scale/cost
- observability gap
- enterprise key-management requirement
- platform reliability/control limitation

## Principle
Migration path must exist before trigger occurs.
