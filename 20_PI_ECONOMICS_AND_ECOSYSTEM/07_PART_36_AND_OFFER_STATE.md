# PART 36 & OFFER STATE

## Current framework
CPR Part 36 governs formal settlement offers with specified costs consequences.

Part 36 offers may be made before proceedings.
The relevant period is typically 21 days, subject to rules/exceptions.

Source:
https://www.justice.gov.uk/courts/procedure-rules/civil/rules/part36

## Product model
`Offer`:
- type (Part 36 / protocol / ordinary);
- made by;
- amount;
- served;
- relevant-period end;
- withdrawn?;
- superseded?;
- accepted?;
- acceptance date;
- costs implication status;
- source document.

## Product opportunity
**Offer Intelligence**
- extract offer;
- classify;
- calculate candidate response/relevant-period date using rules;
- flag new offer;
- compare current vs prior;
- show current live offer state.

## High-risk boundary
The system must NOT autonomously advise:
- accept/reject;
- litigation strategy;
- valuation.

It can structure facts and deadlines for solicitor review.

## Why valuable
Offer information is often buried in correspondence.
A missed/poorly tracked offer can have material cost implications.
