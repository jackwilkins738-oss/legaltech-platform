# AI MODEL / PROVIDER DECISION FRAMEWORK

## Do not standardise on provider from reputation alone.

## Score each provider/model on:

### Quality
- classification
- extraction
- matter matching assistance
- summarisation
- drafting
- structured output
- long-document handling

### Security/privacy
- business data training default
- zero-data-retention availability
- abuse-monitoring retention
- data residency
- regional inference
- subprocessor transparency
- encryption
- enterprise key management if available

### Control
- structured outputs
- tool calling
- system instruction hierarchy
- model pinning/versioning
- eval tooling
- deterministic constraints where possible

### Operations
- latency
- rate limits
- uptime
- support
- incident transparency
- regional capacity

### Commercial
- input cost
- output cost
- caching
- batch
- enterprise commitments

## Architecture rule
All model calls go through AI Gateway.

AI Gateway decides:
- approved provider
- model
- data minimisation
- region/project
- ZDR policy
- prompt
- tools
- logging
- cost
- fallbacks

## Provider concentration
At least architect so one provider can be substituted for:
- classification
- extraction
- summarisation
without rewriting business logic.

## Current OpenAI facts to verify at contracting time
OpenAI currently states:
- API/business data is not used for training by default unless opted in
- qualifying customers may access Zero Data Retention controls
- regional data-residency options exist for eligible API projects
- endpoint eligibility/retention differs by capability

Do not assume every endpoint inherits ZDR.

## Sources
https://developers.openai.com/api/docs/guides/your-data
https://openai.com/enterprise-privacy/
https://openai.com/index/introducing-data-residency-in-europe/
