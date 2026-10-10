# V142 — Support access safety during delayed reads

The reference JIT registry previously used unchecked clocks for expiry and recent
MFA checks. `NaN` made both comparisons false. Diagnostics checked support access
before awaiting provider data, allowing a revoked or expired grant to finish a
read later. Audit callback results were not consistently checked, and diagnostic
provider calls had no deadline or outstanding-call budget.

## Reference support authority

The shared lifecycle guard now exposes a validated clock observation. Observations
must be safe integer epoch milliseconds within the Date range and must never go
backwards within that guard's lifetime. Native rejected clock promises are consumed
and refused. Recursive clock observations and registry mutation callbacks cannot
commit a successful outer transition even when the nested failure is caught.

JIT mutation and read inputs require exact own data fields. Request, approval and
read transitions stage immutable rows and local events, require synchronous audit
completion, observe the clock again and recheck recent MFA/session expiry and grant
expiry before success. A read's final check pins the request ID it first selected.
Failed transitions restore their previous local state and evidence. Raw audit
exceptions are replaced with `SUPPORT_ACCESS_AUDIT_UNAVAILABLE`.

Revocation is deliberately different: after current authority and the requested
identity/reason are validated, denial is installed before the audit callback. Audit,
clock or callback failure preserves a REVOKED row with `auditConfirmed: false` and
no successful local revocation event. The same actor and reason hash can retry with
current authority to confirm the audit. A different actor/reason cannot rewrite
that pending attempt. A confirmed revocation cannot be reversed by retry.

`assertGrantCurrent(session, {requestId, matterId, scope, documentRef?})` checks
current reference authority for exactly that request, without emitting another read
event. Request ID is required and cannot be null or widened to any matching grant.
This is a trusted internal reference API, not an unauthenticated status endpoint.

## Diagnostic provider and final handoff

`SupportDiagnosticService` requires both `assertDiagnosticRead` and
`assertGrantCurrent` from its support authority. Both must return synchronously;
current-grant proof must return exactly `true`. The diagnostic service checks the
initial grant's tenant, requester, matter and diagnostic scope, then pins its
request ID before provider execution, after the provider wait and after final
audit. A replacement grant cannot substitute for the revoked original grant.

The provider receives frozen tenant/matter/trace metadata and an AbortSignal.
`timeoutMs` defaults to 5,000 (allowed 50–10,000), and `maxConcurrent` defaults to 4
(allowed 1–16). A duplicate outstanding call for the same tenant/actor/matter/grant
is refused. The global budget covers different grants too. Timeout aborts the
signal and denies the read; the underlying provider remains owned until it actually
settles. Late success/rejection cannot emit local evidence or return a snapshot.
An uncancellable, permanently stuck provider therefore consumes a bounded slot;
provider cancellation, reconciliation and service restart remain operating concerns.

Provider snapshots require plain own data fields throughout release, dependency
and queue metadata. Extra keys, symbols, accessors, sparse dependency arrays and
duplicate dependency kinds are refused before audit. Allowed fields are bounded
states, counters, version identifiers and fingerprints; nested output is frozen.
The trusted provider still controls allowed version labels and fingerprints. These
shape checks do not prove that an allowed label or hash contains no sensitive data.

Diagnostic audit is synchronous and receives frozen metadata with the pinned
request ID. No successful local snapshot evidence is appended until the audit and
final clock/authority checks finish. An asynchronous/rejected audit is refused and
native rejection is consumed. A sink may already have recorded an attempted event
before a later expiry check fails, or complete an asynchronous external write after
refusal; local rollback cannot undo that external effect. Durable reconciliation
and a production transactional audit adapter remain required.

## Reference document delivery

The existing `DocumentDeliveryService` checks access again after its last interlock
wait, before claiming the one-use token. It checks access and token expiry again
after storage integrity verification, before returning its own byte copy. Support
assertions must return a matching synchronous document grant; a Promise cannot
count as authority. Storage callbacks that revoke access cannot hand off bytes.
If the final check fails, the service wipes its owned copy and leaves the token
consumed. It does not overwrite a provider's shared storage buffer. Callers need a
new authorized token after such a failure. The managed source-download path is
unchanged.

## Validation and boundaries

65 new regressions cover invalid/backwards clocks, audit-time expiry, recursive
callbacks, failed and exact-retried revocation auditing, request identity, provider-
wait revocation/expiry/replacement, MFA/session expiry, final-audit authority loss,
strict provider shapes, asynchronous assertions, timeout ownership, duplicate and
global call budgets, late provider outcomes and document handoff failures. Existing
V116 audit-failure expectations now check the sanitized error contract.

Local suites pass 3,062 platform tests, 140 scaffold tests and all 38 security-policy
tests. Security scanner is clear; knowledge lint has zero errors/warnings. Native
PostgreSQL is unavailable locally. There is no migration or new PostgreSQL case in
this reference-only batch; the full PostgreSQL 17 CI suite must pass before merge.

JIT grants, revocation markers and diagnostic ownership remain process-local and
are lost on restart. This does not provide distributed support revocation, durable
JIT authority, live identity/directory role refresh, public support administration,
provider deployment or production readiness. Immutable session claims still depend
on upstream current server-session authorization. Production clock synchronization,
audit reconciliation, durable adoption and real operating drills remain required.
D-018, the pre-TO/customer-data gates and the V131 writeback execution pause remain.
