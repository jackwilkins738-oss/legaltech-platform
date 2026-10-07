# SECURE SEARCH & RAG ARCHITECTURE

## Security principle
Authorisation happens before retrieval.

Never:
retrieve across tenant/matter → give all to model → tell model not to reveal.

## Ingestion
Document/email
→ permissions resolved
→ chunks
→ metadata:
  tenant_id
  matter_id
  security_zone
  sensitivity
  document_id
  version
→ index

## Query
User
→ auth
→ effective policy
→ permitted tenant/matters/security zones
→ filtered retrieval
→ rerank
→ model
→ cited output

## Isolation
At minimum:
- tenant filter mandatory
- matter/access filter mandatory
- security-zone filter mandatory

For high assurance consider:
- separate tenant namespaces/indexes
- per-tenant encryption/keys where commercially justified

## RAG poisoning
Documents are untrusted.

Do not let document text:
- alter system policy
- change tool permissions
- request secrets
- authorize external actions

## Citations
Every factual answer from customer documents should cite source document/page/chunk where practical.

## No-result behavior
If user lacks access:
system should not reveal that restricted results exist.

## Caching
Cache key includes:
- tenant
- effective access scope
- query
- policy version

Never share generated/retrieved confidential cache across authorization contexts.

## Evaluation
- cross-tenant retrieval tests
- restricted matter tests
- stale permission tests
- deleted document tests
- prompt-injection corpus
