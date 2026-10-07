# HMCTS / COURT INTEGRATION FEASIBILITY

## Current landscape
MyHMCTS is a professional case-management gateway for a range of civil/family/tribunal services. It requires firm registration, user accounts and often Payment by Account.

Updated registration guidance:
https://www.gov.uk/guidance/register-for-myhmcts-online-case-management-for-professionals

HMCTS also publishes a Court and Tribunal Hearings Service (CaTH) API framework for third-party hearing information:
https://www.gov.uk/government/publications/hmcts-third-party-courts-and-tribunals-data-licence/court-and-tribunal-hearings-service-application-programming-interface-api-requirements

## Important conclusion
Do NOT assume MyHMCTS offers a general public API for every professional filing workflow.

Many workflows are portal/user-account based.

## Near-term court strategy
Build:
- ingest court correspondence;
- extract hearing/deadline candidate;
- human confirm;
- calendar/task;
- link to MyHMCTS.

## Later
Investigate service-specific API/partner access.

## Never
Automate browser filing through fragile UI scripting for high-impact court submissions without explicit support and risk review.

## Opportunity
CaTH hearing data may eventually improve:
- hearing monitoring;
- matter timeline;
- reminders.
