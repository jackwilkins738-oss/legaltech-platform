# MEDICAL RECORDS / EVIDENCE REQUEST MECHANICS

## Current UK mechanics
For a living person, health-record access is generally exercised through data-protection subject-access rights. A solicitor/representative can submit on a person's behalf with evidence of authority/consent.

NHS Digital guidance:
https://digital.nhs.uk/data-and-information/information-governance/guidance/subject-access-requests/guidance-for-patients-and-service-users

NHS England:
https://www.england.nhs.uk/contact-us/common-questions/how-do-i-get-a-copy-of-my-health-medical-records/

For deceased patients, the Access to Health Records Act 1990 remains relevant:
https://www.legislation.gov.uk/ukpga/1990/23/section/3

## Operational complexity
Request target varies:
- GP practice;
- NHS trust/hospital;
- PCSE in limited GP-record circumstances;
- private provider.

## Product implication
Records orchestration needs provider-specific state, not one generic "records requested" flag.

Suggested state:
DRAFT
AUTHORITY_REQUIRED
SENT
IDENTITY_QUERY
ACKNOWLEDGED
PARTIAL_RECEIVED
COMPLETE_RECEIVED
REDACTION/REVIEW
MISSING_RANGE
CHASE_DUE
CLOSED

## Required metadata
- patient/client;
- provider;
- authority/consent version;
- requested date range;
- requested record type;
- sent date;
- statutory/expected response date;
- received coverage;
- missing coverage;
- disclosure restrictions.

## Safety
Medical records = special-category data.
Do not expose in generic analytics or support tooling.

## Opportunity
Automation should focus on:
- request assembly;
- state tracking;
- chasing;
- receipt reconciliation;
not making medical/legal causation judgments.
