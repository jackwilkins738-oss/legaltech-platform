# PERFORMANCE, SCALABILITY & FINOPS

## Why now
AI/document systems can look cheap in pilots then become uneconomic at volume.

## Workload model
Model separately:
- webhook events/sec;
- emails/day;
- attachments/day;
- pages/day;
- OCR pages;
- embedding tokens;
- LLM calls;
- Proclaim writes;
- search queries;
- storage growth.

## Capacity assumptions
Never size from users alone.
A 100-user PI firm may produce far more documents/events than a 300-user advisory firm.

## Latency budgets
Example internal targets:
- webhook acceptance <1s;
- durable enqueue <2s;
- ordinary message visible in queue <2m;
- ordinary classification <5m;
- review action UI <500ms p95 where possible;
- Proclaim write attempt <2m after approval.

These are engineering targets, not contractual promises.

## Cost ledger per event
Record:
- OCR;
- LLM;
- embeddings;
- storage;
- egress;
- queue/compute;
- third-party API.

Create:
`cost_per_processed_email`
`cost_per_document_page`
`cost_per_automated_action`
`cost_per_customer_month`

## FinOps guardrails
- per-tenant budget alerts;
- runaway-workflow protection;
- maximum file/page limits;
- model tiering;
- caching only within secure scope;
- batch where appropriate;
- AI call dedupe;
- token/input truncation with provenance.

## Scale tests
Before >10 customers:
- 10x pilot event volume;
- queue backlog recovery;
- connector outage recovery;
- 10GB+ matter/document simulations.

Before enterprise:
- noisy-neighbour tests;
- DB connection saturation;
- search-index rebuild;
- large export;
- bulk migration.

## Unit economics gate
Software gross margin should eventually be >75%.
AI/OCR must not silently make high-volume customers loss-making.
