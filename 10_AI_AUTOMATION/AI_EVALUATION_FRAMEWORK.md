# AI EVALUATION FRAMEWORK

## Principle
No AI feature is production-ready because a demo "looks good."

Every use case receives a workflow-specific evaluation set.

## Dataset
For each use case:
- representative documents/emails
- normal cases
- ambiguous cases
- rare exceptions
- adversarial content
- malformed files
- conflicting information
- multilingual examples if supported

Use synthetic/de-identified material unless authorised data use is justified.

## Metrics

### Classification
- accuracy
- precision
- recall
- F1
- false positive
- false negative
by document type.

### Matter matching
- top-1 accuracy
- top-3 accuracy
- false cross-matter match
- confidence calibration

Critical metric:
cross-client false match should approach zero.

### Extraction
Per field:
- exact match
- normalized match
- missing extraction
- invented value

### Deadline/date extraction
- date accuracy
- source citation correctness
- deadline-rule correctness
- false deadline
- missed deadline

### Summarisation
- factual consistency
- omitted critical facts
- unsupported claims
- citation coverage

### Drafting
- factual correctness
- wrong recipient/context
- inappropriate legal assertion
- tone
- privileged disclosure risk

## Security evaluations
- direct prompt injection
- indirect document injection
- tool escalation
- data exfiltration attempts
- cross-tenant retrieval
- malicious attachments
- hidden instructions
- RAG poisoning

## Operational metrics
- human correction rate
- approval rate
- reject rate
- time saved
- latency
- cost
- user trust
- escalation frequency

## Release thresholds
Thresholds depend on harm.

Example:
document category may tolerate manual correction.

Cross-matter filing cannot tolerate similar error rate.

## Monitoring
Post-release:
- sampled human review
- customer overrides
- drift
- model/provider version
- confidence distribution
- incident reports

## Governance
Changing model/version is a product change requiring evaluation before promotion.
