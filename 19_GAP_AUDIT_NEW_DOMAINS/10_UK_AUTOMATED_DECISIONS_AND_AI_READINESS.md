# UK AUTOMATED DECISION-MAKING READINESS — 2026

## Legal change
The Data (Use and Access) Act 2025 amended UK GDPR automated-decision rules. Relevant provisions came into force on 5 February 2026.

Current law defines a solely automated decision by absence of meaningful human involvement and defines significant decisions by legal or similarly significant adverse effect.

For significant solely automated decisions, safeguards can include:
- information to the person;
- ability to make representations;
- human intervention;
- ability to contest.

Special-category data remains more constrained.

Sources:
- https://www.legislation.gov.uk/ukpga/2025/18/section/80
- https://ico.org.uk/about-the-ico/ico-and-stakeholder-consultations/2026/03/ico-consultation-on-the-draft-guidance-about-automated-decision-making-including-profiling/

ICO final guidance was still being updated in late 2026.

## Product boundary
Most V1 actions should not be significant decisions about individuals.

Examples safer:
- classify email;
- file document;
- create internal task;
- flag missing evidence.

Higher concern:
- accept/reject client;
- legal entitlement decision;
- settlement outcome;
- fraud/high-risk label affecting person;
- significant prioritisation without human review.

## Requirement
Maintain an `AI_DECISION_IMPACT_CLASS` for automated actions:
- operational/non-significant;
- potentially significant;
- significant.

Potential/significant classes require privacy/legal review.
