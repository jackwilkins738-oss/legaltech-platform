# SYNTHETIC LEGAL TEST CORPUS

## Goal
Create repeatable evaluation data without using real client files.

## Initial fictional PI matters
Create 25 matters.

Fields:
- matter ID
- client
- DOB
- accident date
- defendant
- insurer
- claim reference
- handler
- stage
- known providers
- opposing solicitor
- expected evidence

## Ambiguity design
Include:
- two clients with same surname;
- two matters for same client;
- insurer sending about multiple matters;
- missing matter number;
- wrong/outdated reference;
- forwarded email;
- reply chain with old matter reference;
- attachment whose content points to correct matter while subject does not;
- restricted fictional matter;
- duplicate email;
- generic provider sender.

## Email set
Minimum 150 synthetic inbound messages:
- 50 straightforward exact references
- 30 identity/thread matches
- 20 attachment-dependent matches
- 20 ambiguous
- 10 no-match/new enquiry
- 10 deliberate conflicting references
- 10 adversarial/prompt-injection

## Documents
At least:
- medical records
- medical report
- insurer liability response
- wage evidence
- signed authority
- court order
- settlement offer
- expert invoice
- client ID
- irrelevant attachment

## Ground truth
Every example has:
- correct matter / no-match
- correct class
- key extracted facts
- expected proposed actions
- risk class
- whether human review is mandatory

## Why
We need to compare:
- model versions;
- deterministic rules;
- embedding strategies;
- thresholds;
- OCR providers;
without changing the test every time.
