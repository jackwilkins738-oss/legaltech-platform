# TEST STRATEGY

## Required layers
### Unit
Pure domain/policy/transform logic.

### Contract
Graph, Proclaim, AI, OCR adapter contracts with fixtures/mocks.

### Integration
DB, queue, object store, authz, event processing.

### E2E
Synthetic vertical slices.

### Security
Cross-tenant, IDOR/BOLA, permissions, hostile files, workflow abuse.

### AI evaluation
Separate benchmark suite with fixed dataset/version.

## Golden V1 E2E
1. create synthetic tenant/user/matter;
2. inject synthetic inbound email;
3. fetch/store safe metadata;
4. process attachment;
5. generate candidate matter;
6. human accepts;
7. mock/authorized Proclaim write;
8. read-back;
9. audit;
10. duplicate event does not duplicate action.

## Failure-path tests
Mandatory for integrations:
- timeout;
- 429/rate limit;
- auth revoked;
- malformed payload;
- duplicate;
- downstream unavailable;
- unknown write outcome.

## Coverage
Do not chase arbitrary percentage.
Critical policy/domain logic should have high branch coverage and explicit abuse cases.
