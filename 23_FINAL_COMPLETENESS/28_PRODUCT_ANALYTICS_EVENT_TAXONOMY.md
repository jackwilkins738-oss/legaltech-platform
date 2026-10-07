# PRODUCT ANALYTICS EVENT TAXONOMY

## Principle
Operational analytics without raw legal content.

## Events
- user.logged_in
- inbound.received
- inbound.review_opened
- match.accepted
- match.corrected
- classification.corrected
- exception.created
- exception.resolved
- writeback.succeeded
- writeback.failed
- workflow.started/completed/failed
- feature.used
- training.completed

## Properties
Allowed:
- tenant pseudonymous ID;
- role;
- feature;
- duration;
- result;
- model/workflow version;
- error code.

Avoid:
- client names;
- email body;
- medical content;
- document text.

## Metrics
- funnel;
- review time;
- correction;
- adoption;
- reliability.

## Consent/lawful basis
Assess analytics stack and cookies separately for public website vs authenticated product.

## Benchmark use
Cross-customer aggregation is separate from ordinary product telemetry and requires governance/contract/privacy analysis.
