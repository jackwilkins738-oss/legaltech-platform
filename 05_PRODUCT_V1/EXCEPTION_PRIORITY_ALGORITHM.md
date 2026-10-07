# EXCEPTION PRIORITY ALGORITHM

## Goal
Rank work by operational/legal urgency, not simple creation time.

## Inputs

### Legal risk
0–5

### Deadline proximity
0–5

### Confidentiality/security risk
0–5

### Client impact
0–5

### Financial impact
0–5

### Confidence deficit
0–5

### Age
0–5

### Workflow blockage
0–5

## Initial weighted model
Priority =
Legal Risk × 25%
+ Deadline × 20%
+ Security × 20%
+ Client Impact × 10%
+ Workflow Blockage × 10%
+ Age × 5%
+ Financial × 5%
+ Confidence Deficit × 5%

## Hard overrides
Always critical/high:
- cross-client match conflict
- restricted matter uncertainty
- candidate statutory/court deadline near threshold
- failed high-impact external action
- possible confidentiality incident

## Customer configuration
Weights may vary, but:
- customers cannot reduce platform security incidents below minimum severity
- legal-deadline safety floor remains

## Explainability
UI should show:
"High because:
court deadline candidate tomorrow
+ uncertain matter match"

Do not expose opaque AI-only risk scores.
