# V117 — Enforced API admission and PostgreSQL verification

STATUS: CURRENT
DOMAIN: platform_build / security_privacy

V117 fixes the reviewed readiness/admission bypass and ignored asynchronous HTTP security callbacks. It adds production probe coverage requirements and executable database verification, including a migration for six tables that enabled RLS without forcing it. This is an authorised security-defect exception under D-018. Customer-data deployment remains blocked pending the actual production composition and deployed evidence.

## Resulting API behaviour

When a readiness coordinator is configured, all routes except GET `/api/v1/health` and GET `/api/v1/ready` require READY or DEGRADED admission. NOT_READY, thrown errors, malformed results and stalled status adapters produce a generic 503 without authenticating or dispatching a domain operation. Static files, session exchange/logout and unknown routes are included. A second check after asynchronous authentication, tenant admission and monitoring prevents a detected failure during that interval from reaching a domain route. Session exchange is checked again before its cookie is returned. Production health/readiness routes bypass the shared IP limiter so its outage cannot make liveness depend on that store; readiness reports that outage through the critical RATE_LIMIT_STORE probe. Restrict operational probe access at the deployment gateway.

`NODE_ENV=production` always enforces production mode; `productionMode:false` cannot disable it. Explicit `productionMode:true` also enforces it in a staging test process. Production startup requires a registered coordinator from `createProductionReadiness`, rejects the built-in reference Platform/SQLite store/local object store, static auth, in-memory limiter and development worker routes. Production requests require OIDC or SERVER_SESSION context. This blocks accidental promotion of the synthetic server; it does not prove an arbitrary supplied adapter is durable or secure.

HTTP IP/tenant/read limits, read/request monitoring and connector mutation audit callbacks are now awaited. A rejected asynchronous limit prevents dispatch/disclosure. A rejected connector ATTEMPT audit prevents its mutation. A provider side effect followed by a failed SUCCESS audit is still an uncertain outcome requiring production reconciliation; awaiting alone does not make external effects transactional.

Readiness checks are bounded and concurrent calls coalesce. Production success/failure cache TTL is 250–1,000 ms, default 250 ms. Immediate containment/drain changes should call `invalidate()`; an older healthy in-flight result cannot overwrite or satisfy a newer generation. Detection can lag until cache expiry and admission does not cancel an already executing operation. Operation-specific authorization, interlocks and transactional claims remain mandatory. The outer HTTP status deadline defaults to 1,500 ms, configurable 100–6,000 ms; configure it above the dependency probe timeout, which is 100–5,000 ms.

## Required production probes

Every probe is critical; missing, unknown or non-function registrations are rejected. Failure cannot be downgraded to DEGRADED in this production suite.

| Probe | Deployment binding that must be exercised |
| --- | --- |
| DATABASE_RUNTIME | Actual API runtime connection pool and PostgreSQL role/catalog posture |
| SCHEMA | Actual applied migrations against the checksum-pinned manifest |
| IDENTITY | Configured verified identity service and directory resolution |
| SESSION_STORE | Shared session/revocation authority |
| RATE_LIMIT_STORE | Shared IP/tenant/read admission authority |
| AUDIT_SINK | Required durable audit commit path |
| OBJECT_STORAGE | Private managed storage and workload permissions |
| QUEUE | Managed queue and worker delivery permissions |
| DOCUMENT_SECURITY | Required scanning/quarantine/evidence authority |
| SECURITY_INTERLOCK | Shared current containment/kill-switch state |
| WORKER_AUTHORIZATION | Workload verification and durable one-use execution authority |
| DEPLOYMENT_DRAIN | Shared deployment admission/drain state |
| CLOCK_INTEGRITY | Trusted clock source and evidence freshness |

Registration validates coverage and deadlines, not the honesty of supplied callbacks. The deployment root must bind probes to the same adapters that execute the operations and exercise meaningful provider permissions/state. Constant success callbacks, mode labels and local mocks are not production evidence. This release does not supply PostgreSQL domain adapters, managed Redis/session implementations, live provider bindings or a production entry point. Existing synchronous domain/store interfaces must not be wired directly to asynchronous PostgreSQL driver methods.

## Database verification

See `30_PRODUCTION_SHAPE_SCAFFOLD/docs/V117_RUNTIME_DATABASE_VERIFICATION.md` for executable commands and fixture conditions. `createPostgresRuntimeProbe` is intended for the DATABASE_RUNTIME registration using the actual restricted-runtime pool; errors redact to DATABASE_RUNTIME_UNVERIFIED, aborted/error connections are discarded, and no further queries run after abort. Configure finite pool acquisition/connect deadlines and bounds too. The probe checks catalog posture only; separate SCHEMA and isolation/operational checks are still required.

Migration `046_runtime_rls_enforcement.sql` forces RLS on security incident records/evidence/events and tenant configuration bundles/activations/certifications. The checksum manifest now contains 46 migrations. The migration identity must apply it through controlled deployment; applying the Git patch does not execute SQL or alter any live role.

## Limits and rollback

The reviewed admission bypass is closed in the source. Shared single-use grants, revocation/containment, transactional auditing, runtime connection context and live database/cloud controls remain unverified until real adapters are composed and tested. No readiness probe result, unit-test pass count or GitHub merge certifies production readiness.

If a rollback is necessary, keep customer-data traffic blocked and correct the failed deployment/probe binding. Removing the gate or replacing probes with success stubs would restore the reviewed failure. Reverting migration 046 is not part of the application rollback; forced RLS should remain enabled and migration history must remain checksum-consistent.
