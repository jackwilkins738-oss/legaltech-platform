# AI PROVIDER BENCHMARK — PROVISIONAL DECISION

## Decision
Do not choose a permanent model provider before evaluation.

Build one internal AI gateway and benchmark at least:
- OpenAI;
- Anthropic;
- one alternative enterprise provider if useful.

## Current candidate tiers

### High-volume classification/extraction
Use low-cost model/rules first.

OpenAI currently publishes low-cost models such as GPT-5.6 Luna at $0.20/M input and $1.20/M output, while newer GPT-6 family pricing varies by tier/processing.

### General professional reasoning
Benchmark:
- OpenAI GPT-5.6/6 Sol-class models;
- Anthropic Sonnet/Opus-class models.

Anthropic's published 2026 pricing lists Sonnet 4.6 around $3/M input and $15/M output and Opus-class models around $4–5/M input and $20–25/M output depending version/tier.

## Selection dimensions
Weight:
- wrong-client/matter risk: 25%
- structured extraction accuracy: 20%
- legal-document reasoning: 15%
- prompt-injection/tool safety: 15%
- latency/reliability: 10%
- privacy/residency/retention: 10%
- cost: 5%

Cost should not dominate safety-sensitive use cases.

## Routing hypothesis
Rules/deterministic:
exact matter reference, dates, known metadata.

Cheap model:
classification, low-risk extraction.

Strong model:
ambiguous matter reasoning, complex summary.

Human:
conflict, high-impact, uncertain.

## Current price sources
- OpenAI API: https://developers.openai.com/api/docs/pricing
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing

## Gate
No auto-action threshold is selected until representative evals exist.
