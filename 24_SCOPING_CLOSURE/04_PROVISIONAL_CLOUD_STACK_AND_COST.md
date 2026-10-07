# PROVISIONAL CLOUD STACK & COST

## Prototype / technical spike
Recommended provisional:
- Vercel Pro for web delivery;
- Supabase/Postgres for canonical data;
- private object storage;
- queue/worker platform;
- separate AI/OCR provider gateway.

## Current published baseline
Vercel Pro:
approximately $20/month plus usage.

Supabase:
- Pro starts at $25/month;
- Team starts at $599/month;
- Enterprise custom;
- PITR currently listed from about $100/month per 7 days;
- Team adds SOC 2 / ISO 27001-facing platform features, longer logs and stronger team controls.

Sources:
- https://vercel.com/pricing
- https://supabase.com/pricing

## Scenarios

### Developer prototype
Indicative infrastructure:
$50–$200/month before AI/OCR, depending on environments and workers.

### Controlled pilot
Indicative:
$500–$2,000/month before heavy AI/OCR and enterprise contract uplift.

Why range is wide:
- Team/Enterprise tiers;
- staging;
- PITR;
- log drains;
- monitoring;
- scanning/OCR;
- private networking.

These are planning ranges, not quotes.

## Replatform trigger
Move components to Azure/AWS or enterprise-managed offering when:
- customer requires private networking;
- procurement requires stronger SLA/control;
- data residency cannot be demonstrated;
- workload economics favour it;
- observability/KMS/control is insufficient.

## Decision
Convenience stack is allowed to prove the wedge.
Architecture must remain portable.
