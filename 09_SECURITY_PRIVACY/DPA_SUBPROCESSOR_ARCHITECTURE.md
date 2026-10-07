# DPA & SUBPROCESSOR ARCHITECTURE

## Likely primary relationship
Law firm:
Controller

Our platform:
Processor

This must be verified per processing activity.

## Processor contract must cover
- subject matter
- duration
- nature
- purpose
- personal data types
- data subject categories
- controller rights/obligations
- documented instructions
- confidentiality
- security
- subprocessors
- data subject rights assistance
- breach/DPIA assistance
- deletion/return
- audits/information

## Subprocessor model
Maintain public/current list:
| Vendor | Purpose | Data | Region | Critical? | Transfer mechanism |

Examples:
- cloud
- database
- monitoring
- email
- OCR
- AI
- support
- authentication

## Product architecture implication
Subprocessors should be minimised.

AI provider should receive only:
- necessary content
- temporary scope
- no broad database access

## Change process
Before adding subprocessor:
1. security assessment
2. privacy assessment
3. data-flow update
4. contract/DPA
5. transfer assessment
6. customer notification/authorisation as contract requires
7. vendor register

## Failure scenario
If vendor fails:
- export?
- switch?
- delete?
- rotate credentials?
- continue degraded service?

## ICO source
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/
