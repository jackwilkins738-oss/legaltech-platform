# AI GOVERNANCE AND SAFETY

## Principle
AI cannot bypass normal authorisation.

## Use-case classes
### Low risk
- summarise
- classify
- suggest labels
- extract candidate fields

### Medium
- draft correspondence
- suggest tasks
- suggest deadlines
- suggest matter match

### High
- send external communication
- update critical case status
- create deadline relied upon by lawyers
- make legal-risk recommendations

### Very high / generally human-authorised
- legal submissions
- financial transfers
- client commitments
- conflict decisions
- legal advice
- destructive data operations

## Required safeguards
- model inventory
- provider inventory
- approved use cases
- prompt/data separation
- prompt injection defences
- tool allowlists
- least-privilege service tokens
- retrieval authorization
- tenant-aware RAG
- no cross-tenant embeddings/search
- confidence thresholds
- source display
- human approval
- output validation
- evaluation datasets
- hallucination tracking
- false-positive/false-negative tracking
- audit logs
- kill switch
- provider outage mode
- provider breach plan
- no external-model training on customer data where required
- retention settings
- regional processing review

## Competitive reality
Clio already markets:
- permission-aware AI
- no external model training
- human review checkpoints
- document-to-deadline actions
Therefore "safe AI" is table stakes, not differentiation.
