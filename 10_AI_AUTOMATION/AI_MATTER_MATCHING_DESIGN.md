# AI / HYBRID MATTER MATCHING DESIGN

## Risk
Wrong-matter filing can disclose one client's information to another.

Treat matching as security-sensitive.

## Architecture
Use hybrid deterministic + probabilistic matching.

## Signal groups

### Strong deterministic
- exact matter number
- exact external claim reference
- unique court reference
- unique portal reference
- conversation previously confirmed for matter

### Identity
- sender email
- known client
- known insurer
- opponent solicitor
- expert
- provider

### Thread
- conversation ID
- prior confirmed messages
- references in quoted thread

### Content
- client name
- accident date
- DOB where permitted
- employer
- defendant
- location
- medical provider

### Semantic
- embedding similarity to matter metadata/recent communications

Semantic evidence is supporting evidence, not sole authority.

## Candidate process
1. tenant constrain
2. retrieve candidates
3. deterministic score
4. entity score
5. thread score
6. semantic score
7. conflict checks
8. calibrated confidence
9. rank

## Hard safety rules
- candidate search never crosses tenant
- restricted matters excluded unless user/worker authorised
- if two clients share similar names, confidence reduced
- conflicting unique references force review
- new sender alone cannot auto-match
- semantic-only match cannot auto-file

## Human feedback
Capture:
- accepted match
- changed match
- no match
- new matter

Use for evaluation and later model improvement.

## Evaluation
Track:
- top-1 accuracy
- top-3 recall
- wrong-client rate
- wrong-matter same client
- human correction rate
- confidence calibration

## Auto-file threshold
Do not choose until real evaluation exists.
For legal confidentiality, threshold should be extremely conservative.
