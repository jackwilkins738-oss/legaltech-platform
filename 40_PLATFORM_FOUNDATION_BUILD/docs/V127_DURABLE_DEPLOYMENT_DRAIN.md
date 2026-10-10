# V127 — Durable PostgreSQL deployment drain

Migration 055 and `PostgresDeploymentDrainBackend` provide a real shared deployment control store. `createDurablePostgresProcessingService` binds the existing HTTP/domain/outbox/worker/canary service to six processing pools plus three separately authenticated drain pools. Construction performs no provisioning, initialization or resume.

## Durable invariants

Every mutation locks the deployment row. Acquisition and beginning a drain therefore serialize: work either holds a recorded lease or is rejected after admission closes. Draining becomes drained only when every recorded lease has been released. Resume requires the exact current generation and globally zero held leases. Control operation identifiers have immutable actor, principal and request bindings; replay cannot reset or reopen a deployment.

Lease records bind deployment, operation, stable process owner UUID, actual database session principal, kind, random token and acquisition generation. Retries return the original lease; release requires its exact credentials. Records and audit events contain metadata only. An absence lookup writes a durable tombstone, so a delayed acquisition cannot arrive after reconciliation has accepted absence. Released receipts persist for lost-reply recovery. No expiry, automatic lease reaping or forced release exists.

A lost connection or acknowledgement leaves managed readiness unready until explicit reconciliation obtains an exact durable outcome. Another process owner cannot adopt the lease. Preserve the original owner UUID securely for deliberate process reconstruction; establish that all corresponding external effects have settled before releasing. A database receipt establishes lease state, not completion of a provider effect. A crashed process with unsettled effects must remain drained and undergo operator reconciliation.

Managed status also rechecks local uncertainty after asynchronous database reads and rejects rollback behind locally held lease generations. The durable readiness probe verifies all three drain credentials and the supplied current deployment probe; the remaining thirteen-gate readiness and full synthetic canary contracts still apply.

## Credential and database boundaries

`legaltech_drain_worker`, `legaltech_drain_operator` and `legaltech_drain_reader` are separate NOLOGIN capability groups. Supply three distinct login roles and pools, each inheriting only its respective group. Worker credentials acquire, release and reconcile their own leases; operators initialize, begin and resume; readers observe global metadata. Processing and session-broker roles cannot execute this API or access its tables.

The dedicated NOLOGIN `legaltech_drain_owner` owns five forced-RLS tables and three fixed functions. The only exposed function is `drain_security.operate(text,text,jsonb)`. It is SECURITY DEFINER with a fixed `pg_catalog, pg_temp` search path, explicit schema qualification, row security enabled, current session-principal scope checks and exact input validation. Internal helper execution and all direct table/sequence access are revoked from applications and PUBLIC. The backend verifies role separation, owner posture, exact RLS policy, function signatures, source hashes, configuration and ACLs before every operation. This is an intentionally narrow security-definer exception; trusted migration administration remains outside the application boundary.

## Provisioning and lifecycle

Apply pinned migrations through 055 using trusted administration. Create three nonprivileged login roles through the existing secret provisioning mechanism and grant the corresponding capability groups. Revoke public database/schema CREATE as required by the existing PostgreSQL posture. Do not grant table access or ownership to these principals. A trusted administrator must provision `drain_security.principal_scopes` with the exact deployment ID and actual login role names: worker access `WORKLOAD`, operator access `CONTROL`, reader access `READ`, with `active=true`. These are server configuration, never HTTP client inputs. Revocation takes effect at the next API check and deliberately prevents release through a revoked principal until authorization is restored or trusted recovery is arranged.

Bind an immutable deployment ID and stable process owner UUID in the backend constructor. Supply current `authorizeBackend` and managed-drain `authorize` callbacks; backend authorization runs at admission, dispatch and commit, with the actual principal role and cancellation signal. Configure the original readiness probes and all existing identity, provider, audit and artifact dependencies.

Call `initialize` explicitly with an immutable operation ID and authorized actor ID. New deployments start DRAINED, generation 1. Use an authorized compare-and-set resume before starting the service. Normal shutdown closes admission, waits for every owner's work, then verifies the durable drained outcome. A restart requires a fresh authorized resume at the observed generation. No constructor, readiness probe or canary initializes or reopens the deployment.

Lease tokens are private database credentials. Exclude SQL parameters/results containing them from query logging, tracing and telemetry; callbacks receive no token and public errors are sanitized. Scope provisioning, owner identity retention, login credentials and recovery evidence require deployment-managed storage and access controls.

## Validation and release scope

The boundary suite adds 42 regressions. The enabled PostgreSQL CI suite adds 21 cases covering independent connections, acquire/drain serialization, crash retention, lost acknowledgements, durable absence, revoked scopes, capability separation, direct DML denial, owner/RLS/function tampering and the nine-pool HTTP/canary/drain lifecycle. Local PostgreSQL execution is skipped; real CI must pass before merge.

This continues the authorized D-018 security integration exception. The pre-TO freeze and customer-data deployment gate remain in force. Actual cloud provisioning, provider effects, business authorization, production permission evidence and legacy application adoption remain outstanding. Synthetic CI proves the database composition, not readiness of deployed services.
