# API / ECOSYSTEM GOVERNANCE

## Goal
Become extensible without becoming an uncontrolled integration platform.

## API principles
- `/api/v1`;
- explicit versioning;
- stable IDs;
- idempotency keys;
- cursor pagination;
- machine-readable errors;
- tenant-scoped auth;
- least-privilege OAuth scopes.

## Integration certification
Every connector classified:
- first-party;
- verified partner;
- customer-built;
- unsupported.

## Partner app permissions
Scopes such as:
- matters.read
- documents.read
- tasks.write
- communications.write

No blanket `admin`.

## Webhooks
Need:
- signing;
- replay protection;
- delivery ID;
- retries;
- DLQ;
- customer retry visibility.

## Breaking changes
Policy:
- deprecation notice;
- migration guide;
- parallel version window;
- telemetry of old-version usage.

## Marketplace governance
Before public marketplace:
- security questionnaire;
- privacy/subprocessor impact;
- support owner;
- rate limits;
- test tenant;
- incident contact;
- kill switch.

## Strategic rule
We own orchestration and canonical context.
Specialists can own fulfilment.
