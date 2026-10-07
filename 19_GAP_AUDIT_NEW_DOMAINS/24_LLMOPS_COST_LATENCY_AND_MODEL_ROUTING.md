# LLMOPS: COST, LATENCY, ROUTING & FALLBACK

## Missing layer
AI governance exists, but operational model management also needs engineering rules.

## AI gateway responsibilities
- use case;
- provider/model;
- prompt version;
- tool policy;
- token/cost;
- latency;
- retries;
- region;
- retention mode;
- fallback;
- evaluation version.

## Routing
Do not use the most expensive model for:
- deterministic extraction;
- simple classification;
- template completion.

Possible tiers:
- rules/deterministic;
- small model;
- strong model;
- human.

## Fallback
If model unavailable:
- queue;
- degraded manual review;
- alternate model only if evaluation-approved.

Never silently switch to weaker/unapproved model for high-risk workflow.

## Cost controls
- max tokens;
- context selection;
- dedupe;
- prompt caching where confidentiality allows;
- structured output;
- batch low-priority jobs;
- per-tenant quotas.

## Drift
Monitor:
- accuracy;
- correction;
- refusal;
- latency;
- cost;
- output length;
- safety failure.

## Release
Provider/model update = controlled software change.
