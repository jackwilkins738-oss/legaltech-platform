# TARGET CODE REPOSITORY STRUCTURE

## Recommended initial shape
Use a **modular monorepo / modular monolith**, not microservices.

```text
/
├─ CLAUDE.md
├─ README.md
├─ apps/
│  ├─ web/                    # browser UI
│  └─ worker/                 # async jobs / queues
├─ packages/
│  ├─ domain/                 # pure business/domain logic
│  ├─ db/                     # schema, migrations, repositories
│  ├─ authz/                  # policy / permission checks
│  ├─ api-contracts/          # API DTOs / schemas
│  ├─ events/                 # event contracts and idempotency
│  ├─ audit/                  # audit envelope / emitters
│  ├─ graph-adapter/          # Microsoft Graph boundary
│  ├─ proclaim-adapter/       # Proclaim boundary
│  ├─ document-pipeline/      # hostile-file handling
│  ├─ ai-gateway/             # provider/model abstraction
│  ├─ evals/                  # AI/eval harness
│  ├─ observability/          # logging/tracing/metrics helpers
│  └─ test-fixtures/          # synthetic data only
├─ infra/
│  ├─ environments/
│  │  ├─ dev/
│  │  ├─ test/
│  │  ├─ staging/
│  │  └─ prod/
│  └─ modules/
├─ docs/
│  ├─ adr/
│  ├─ runbooks/
│  ├─ api/
│  └─ security/
├─ scripts/
├─ .github/workflows/
└─ .claude/
   ├─ agents/
   └─ commands/
```

## Boundary rule
Packages expose interfaces/contracts. They do not reach into another package's database tables directly.

Example:
`graph-adapter` may emit an `InboundCommunicationReceived` event. It does not directly create Proclaim history rows.

## Why modular monolith first
- one deployment surface;
- simpler transactions;
- easier debugging;
- lower cost;
- strong boundaries still allow later extraction.

Do not introduce a new service unless a real operational reason exists:
- independent scaling;
- different security boundary;
- unsafe parser isolation;
- materially different runtime;
- external availability requirement.
