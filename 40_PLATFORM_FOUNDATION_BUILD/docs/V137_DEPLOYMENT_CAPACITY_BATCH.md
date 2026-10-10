# V137 — Fleet connection budgets and capacity admission

## Behaviour

The durable root previously separated pools/roles without bounding the sum of
configured connections across replicas. Nine pools become fourteen with Graph,
review decisions and review reading. Small defaults can exceed a modest quota.

The root now **requires `capacity`** and checks its actual pools without opening
connections. Invalid/over-budget configuration is refused before construction.
Mandatory database readiness inspects settings/counters before and after the
existing database probe. Existing schema, role and catalog checks remain required.

This fixes an identified deployment boundary gap under the D-018 defect/integration
exception. The pre-TO freeze, customer-data gate and V131 pause remain in force.

## Configuration

```js
const capacity = {
  connectionLimit: 120,
  reservedConnections: 20,
  maxConcurrentReplicas: 3,
  maxWaitingPerPool: 32,
}; // SYNTHETIC example, not a provider entitlement or recommendation.
const root = createDurablePostgresProcessingService({
  ...existingDeploymentOptions,
  capacity,
});
```

`sum(pool.options.max) × maxConcurrentReplicas + reservedConnections <= connectionLimit`

- `connectionLimit`: operator-verified effective ordinary-connection ceiling;
  account for provider restrictions and privileged reservations, not headline limits.
- `reservedConnections`: positive fleet-wide provision for other clients,
  auth/audit/session adapters not enumerated here, maintenance and headroom.
  Include scaling of those clients. This is not a PostgreSQL setting.
- `maxConcurrentReplicas`: simultaneous live replicas including rolling updates,
  canary and recovery overlap, not only desired replicas.
- `maxWaitingPerPool`: queued-checkout threshold. Equality is permitted; exceeding
  it makes capacity unavailable until real queue clearance.

The module cannot discover cloud quota, hidden pools, fleet counts or pooler mapping.
Operators must establish these facts and enforce replica limits. A shared budget is
not a distributed lease. Assess each applicable quota when databases/poolers differ.

Validation uses bounded safe integers: ceiling/reservation at most 100,000, replicas
and queued checkouts at most 1,000, pool maximum at most 10,000. These bounds are
not recommendations. Missing/extra fields, getters and sparse arrays are rejected.

## Inventory and runtime observation

Base: `DOMAIN`, `RELAY`, `PRODUCER`, `WORKER`, `DOMAIN_READER`, `QUEUE_READER`,
`DRAIN_WORKER`, `DRAIN_OPERATOR`, `DRAIN_READER`. Graph adds its full group:
`GRAPH_PRODUCER`, `GRAPH_WORKER`, `GRAPH_READER`. Review optionally adds `REVIEW`
and/or `REVIEW_READER`. The factory derives all names from actual bindings; callers
cannot omit feature pools. Pools remain distinct.

Each pool exposes its own data `options.max` and `options.connectionTimeoutMillis`.
Checkout timeout must be explicitly between 100 and 10,000 ms; unbounded defaults
are refused. `pg.Pool` counters `totalCount`, `idleCount`, `waitingCount` must be
observable nonnegative safe integers.

The guard snapshots the options object/max/timeout. Changed configuration,
impossible counters or failed observation latch uncertainty. Restoring an earlier
setting does not clear it: correct the deployment and reconstruct the root.
Ordinary queue overload is recoverable after actual clearance.

This is a trusted adapter boundary. Fake pools/callbacks can lie; registration is
not independent provider attestation. Do not invent options on opaque wrappers to
bypass checks. Verify actual adapter and pooler behaviour.

## Ownership and lifecycle

`DATABASE_RUNTIME` joins the guard. Failures/malformed results stay failures. Public
codes are fixed and status contains numeric summaries/flags, not credentials,
endpoints, errors or tenant data.

One original database probe may be owned at a time. Cancellation retains ownership
until the callback settles. Readiness preserves its existing deadlines/cache window;
these observations are not continuous monitoring.

Startup/restart refuses unhealthy capacity or owned probes. Shutdown preserves the
underlying result and refuses `drained: true` while a callback remains owned. It
never force-closes pools or terminates provider work. Recheck after settlement before
closing resources. Configuration uncertainty blocks restart but does not invent
unsettled effects after the underlying service/callback have drained.

## Offline plan check

```sh
# From 40_PLATFORM_FOUNDATION_BUILD
npm run deployment:capacity -- deployment/capacity.synthetic.json
```

The synthetic fourteen-pool example has maximum two per pool, three replicas and
twenty reserved: 84 fleet connections and 16 headroom under 120.

The CLI accepts one regular UTF-8 JSON file, reads at most 32,769 bytes and rejects
plans over 32 KiB. Fields: `profile`, `pools`; pool fields: `name`, `max`,
`connectionTimeoutMillis`. Never include credentials. Success is `VALID_PLAN`,
not `READY`. Failure emits only `INVALID_PLAN`, exiting nonzero. CI checks the example.

This does not open databases, attest accounts, enable GitHub protections or prove
recovery. Reconcile the plan with actual constructed pools and deployment settings.

## Evidence and limits

Sixty synthetic regressions cover arithmetic, inventories, unsafe declarations,
drift, queue pressure, cancellation/non-overlap, readiness timeout, lifecycle and CLI.
Two connected PostgreSQL cases exercise real driver queue pressure and HTTP
readiness/start refusal after drift; existing roots receive explicit synthetic budgets.

Local: 2,705 platform and 140 scaffold pass. Native PostgreSQL cannot run locally;
the full PostgreSQL 17 CI suite must pass before merge. No migration/dependency added.

Outstanding: actual quota/fleet evidence, other adapter budgets, pooling mode,
representative load, deployed roles, release protections, file/key restore drills
and approved customer-data release. V131 remains paused.
