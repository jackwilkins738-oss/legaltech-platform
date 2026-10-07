# OIC / CLAIMS PORTAL OPERATIONS

## Official Injury Claim (OIC)
For qualifying low-value RTA claims, OIC provides a structured digital process.

Official data is published monthly and quarterly, including September 2026 data.

Source:
https://www.officialinjuryclaim.org.uk/resources-for-professionals/data/

Government guidance:
https://www.gov.uk/guidance/making-a-personal-injury-whiplash-claim

## Whiplash
For accidents on/after 31 May 2025, updated statutory tariffs apply.

Medical evidence is required before settlement.

Source:
https://www.gov.uk/government/publications/the-whiplash-tariff-and-minor-psychological-injuries/the-whiplash-tariff-and-guidance-on-minor-psychological-injuries

## Claims Portal
Low-value EL/PL protocol requires structured CNF, responses, medical evidence, Stage 2 settlement and specific time periods.

Source:
https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/pre-action-protocol-for-low-value-personal-injury-employers-liability-and-public-liability-claims

## Product model
Future `ProtocolCase` object:
- protocol;
- portal claim ID;
- stage;
- stage entered;
- response due;
- liability status;
- settlement pack status;
- exit reason;
- court-pack state.

## Product opportunity
**Portal Operations Monitor**
- reconcile Proclaim vs portal stage;
- deadline reminders;
- detect missing portal action;
- prepare data/document packs;
- exception when portal state diverges.

## Critical caution
Do not assume every portal provides a supported public API.
Use official integrations/API only.
Avoid fragile browser automation for high-impact submissions.
