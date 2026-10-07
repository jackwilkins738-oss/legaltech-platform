# CONDITIONAL V1 PRODUCT REQUIREMENTS DOCUMENT

## Status
DO NOT treat as final product scope.

Activate this PRD only if TO + external validation confirm inbound legal operations as the first wedge.

## Product
Working name:
Legal Operations Inbound Layer

## Problem
High-volume legal teams repeatedly:
- receive email/documents,
- determine matter,
- file content,
- update matter history,
- create work,
- identify missing information,
- chase next steps.

The hypothesis is that these repeated manual touches consume enough capacity to justify a dedicated automation layer.

## V1 user
Primary:
legal admin / file handler.

Secondary:
fee earner / team leader.

Buyer:
operations director / COO / practice head with IT approval.

## Primary workflow
1. email arrives in approved mailbox;
2. safe ingestion;
3. matter candidates;
4. classification;
5. extraction;
6. proposed action;
7. policy determines auto/review/block;
8. human resolves exception where required;
9. approved write to Proclaim;
10. audit + metric.

## Must-have
- tenant isolation
- authentication
- selected mailbox Graph integration
- attachment quarantine
- matter matching
- classification
- review queue
- approved Proclaim filing
- canonical event/audit
- failed-write queue
- basic team metrics

## Should-have
- proposed task creation
- candidate deadlines
- simple draft reply
- configurable document classes
- workflow policy

## Explicitly out
- full PMS replacement
- accounting
- autonomous legal advice
- autonomous court filing
- unrestricted sending
- broad client portal
- generalized research AI

## Product success
Must measure:
- baseline handling min/event
- post-product human min/event
- auto-processed %
- human-review %
- correction %
- write-back success
- wrong-matter incidents
- exception age
- user adoption

## Kill criteria
Do not ship if:
- net time saving is weak after review;
- wrong-matter risk cannot be controlled;
- Proclaim write-back cannot be reconciled;
- firms will not grant practical access;
- pilot value cannot support intended pricing.

## Expansion hooks
V1 events must support later:
- Matter Command
- Evidence Completeness
- Records Orchestration
- Client Updates
- Matter Intelligence
