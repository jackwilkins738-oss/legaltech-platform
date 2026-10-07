# DOCUMENT CLASSIFICATION TAXONOMY — PI V1

## Goal
Create enough structure for automation without creating hundreds of brittle categories.

## Tier 1 — source/function
- client
- opponent/defendant
- insurer
- medical
- expert
- court
- counsel
- finance/disbursement
- internal
- authority/ID
- other

## Tier 2 — document type

### Client
- instruction
- questionnaire
- signed authority
- statement
- evidence
- correspondence

### Liability
- CNF / Letter of Claim
- acknowledgement
- liability admission
- liability denial
- disclosure/evidence

### Medical
- GP records
- hospital records
- treatment records
- medical report
- prognosis
- rehabilitation

### Expert
- instruction
- report
- supplementary report
- questions/answers
- invoice

### Quantum
- wage evidence
- payslip
- benefits
- receipt
- schedule of loss
- care evidence

### Offers
- Part 36
- settlement offer
- counteroffer
- acceptance/rejection

### Court
- claim form
- particulars
- defence
- order
- directions
- application
- witness statement
- disclosure
- hearing notice
- judgment

### Identity / onboarding
- ID
- address
- funding
- CFA
- client-care
- consent

## Classification output
- primary class
- secondary class
- confidence
- extracted metadata
- sensitivity
- privilege candidate
- requires review?

## Rule
Customer must be able to:
- add labels
- map labels
- disable classes
without changing the underlying canonical model.
