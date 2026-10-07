# PERSONAL INJURY — PUBLIC-SOURCE WORKFLOW MODEL

## Purpose
Create an initial legal-operations workflow model without pretending to replace solicitor judgement.

## Important
There are different protocols depending on claim type/value.
The system must classify the correct procedural route rather than assume one universal PI workflow.

## Core high-level workflow

### 1. Intake
- claimant identity
- accident/event
- date
- location
- injury
- defendant
- insurer where known
- employment/public/RTA context
- funding
- conflict checks
- limitation candidate

Automation opportunities:
- form extraction
- missing-information detection
- conflict-search preparation
- duplicate-client detection
- matter creation draft

Human judgement:
- merits
- legal route
- funding/acceptance

### 2. Protocol/routing
Potential routes include:
- general Personal Injury Protocol
- low-value RTA
- EL/PL
- RTA small claims
- disease/illness
- other specialist protocol

Automation:
- route recommendation
- required-field checklist
- form population

Human:
- confirm route

### 3. Notification / claim initiation
Depending on route:
- Claim Notification Form
- Letter of Claim
- insurer identification
- defendant notification

Automation:
- populate standard information
- chase missing data
- prepare submission/draft
- track acknowledgement

### 4. Liability phase
- defendant/insurer response
- admission/denial
- requested documents
- evidence collection

Automation:
- inbound classification
- response-date tracking
- liability response extraction
- task generation
- chase

Human:
- analyse liability

### 5. Medical evidence
- obtain records
- identify expert
- instruction
- appointment/report
- questions/amendments
- disclose report where required

Automation:
- record request
- chase
- incoming record classification
- chronology assistance
- expert instruction pack preparation
- report receipt tracking

Human:
- expert strategy
- medical/legal interpretation

### 6. Loss / quantum evidence
- earnings
- expenses
- treatment
- care
- future losses
- supporting evidence

Automation:
- checklist
- receipt/document classification
- spreadsheet extraction
- missing-evidence chase

### 7. Settlement
- valuation
- offers
- Part 36 where relevant
- negotiation
- settlement pack

Automation:
- offer logging
- deadline monitoring
- pack assembly
- comparison summary

Human:
- valuation/advice/acceptance

### 8. Proceedings
If not settled:
- issue
- service
- directions
- disclosure
- witness evidence
- experts
- hearings/trial

Automation:
- court-order extraction
- deadline creation
- document bundles
- chronology
- task escalation

Human:
- litigation strategy/legal advice

### 9. Completion
- damages receipt
- costs
- deductions
- client communication
- file closure
- retention

## Why PI is attractive
- repetitive formal stages
- high inbound/outbound communications
- repeated evidence collection
- repeated third-party chasing
- deadline-driven
- high matter volume in specialist firms

## Sources
General PI protocol:
https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/prot_pic

Low-value RTA:
https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/pre-action-protocol-for-low-value-personal-injury-claims-in-road-traffic-accidents-31-july-2013

EL/PL:
https://www.justice.gov.uk/courts/procedure-rules/civil/protocol/pre-action-protocol-for-low-value-personal-injury-employers-liability-and-public-liability-claims
