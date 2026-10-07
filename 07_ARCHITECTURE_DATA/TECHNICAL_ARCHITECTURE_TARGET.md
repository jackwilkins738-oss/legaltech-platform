# TECHNICAL ARCHITECTURE TARGET

## Architectural goals
- browser-first
- API-first
- event-driven where valuable
- strong tenant isolation
- observable
- reversible deployments
- minimal desktop dependencies
- scalable background processing
- explicit workflow engine

## Logical services
- Identity
- Tenant/firm
- Users/roles
- Matters
- Contacts
- Documents
- Communications
- Tasks
- Workflow
- Search
- Notifications
- Reporting
- Audit
- Integrations
- AI orchestration

## Storage
- relational DB for canonical transactional data
- object storage for documents
- search index for permission-filtered retrieval
- queue for async work
- immutable/append-oriented audit events

## Non-negotiable technical patterns
- every object tenant-bound
- authorization server-side
- idempotent external-event handling
- retries with backoff
- dead-letter queues
- no direct model access to DB
- no standing developer production DB access
- IaC
- environment separation
- structured logs
- trace IDs
- explicit data retention

## Supabase/Vercel warning
They may be suitable early tools, but the company must not design around convenience if:
- tenancy controls become difficult
- residency cannot meet requirements
- observability is weak
- scaling cost becomes poor
- enterprise networking/control is insufficient

Architecture should be portable.
