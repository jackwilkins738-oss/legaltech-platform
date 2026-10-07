# DEADLINE ENGINE DESIGN

## Risk
A missed or incorrectly calculated deadline can have severe legal consequences.

Therefore V1 should not allow an LLM alone to create authoritative legal deadlines.

## Deadline sources
- explicit court order
- protocol
- statute/rule
- correspondence
- appointment
- customer-defined SLA

## Deadline object
- matter
- title
- date/time
- jurisdiction/timezone
- source document/event
- source text/excerpt reference
- source type
- calculation rule
- confidence
- status:
  candidate / confirmed / superseded / completed
- confirmed_by
- reminders
- escalation

## Extraction workflow
Document/email
→ identify candidate date/deadline
→ classify source
→ extract source citation
→ compare rule engine if known
→ present candidate
→ authorised human confirms
→ authoritative deadline created

## Rule engine
For procedural deadlines where product eventually supports calculation:
- rule ID
- jurisdiction
- effective date
- trigger event
- duration
- business-day rules
- court closures
- service rule
- exceptions
- rule version

## Change management
Legal/procedural rules change.
Every rule must include:
- effective date
- source
- version
- reviewer
- test cases

## V1
Prefer:
- extract explicit dates
- flag candidate deadlines
- human confirmation

Later:
rule-calculated deadlines after specialist validation.
