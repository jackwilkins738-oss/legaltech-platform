# V117 — Runtime database verification

STATUS: CURRENT
DOMAIN: production_shape / security_privacy

These scripts execute PostgreSQL checks rather than inferring security from SQL text. They have not been executed against PostgreSQL in the current review environment: neither a PostgreSQL binary nor a live runtime connection is available. Unit tests exercise only driver orchestration and failure handling. An operator must run the catalog check on the actual API runtime pool/identity and the behaviour suite on an isolated synthetic staging database before recording verification.

## Read-only catalog check

Install/use PostgreSQL `psql`; configure its service/password file through normal deployment secret handling. The service must connect directly as the restricted runtime role, not an administrator followed by SET ROLE. For example, from repository root in PowerShell:

```powershell
$env:PGSERVICE = "legaltech-runtime-verification"
npm --prefix 30_PRODUCTION_SHAPE_SCAFFOLD run check:runtime-db -- --runtime-role legaltech_runtime --schema public
if ($LASTEXITCODE -ne 0) { throw "Runtime database verification failed." }
```

The service name is illustrative; use the configured runtime service. No DSN/password is placed in command arguments. The CLI uses `psql -X --no-password`, rejects malformed identifiers, fails when psql is absent and preserves nonzero psql status. `verify_runtime.sql` uses a read-only transaction, transaction-local settings and bounded statement/lock timeouts.

The checker rejects a different login/effective role, privileged role membership, database/schema/relation ownership, schema/database CREATE authority, missing core security tables, absent/disabled/unforced RLS on any tenant_id table, unavailable RLS enforcement, missing policies, runtime TRUNCATE permission, tenant-administration mutations, assignment-table INSERT/UPDATE/DELETE including column grants, audit UPDATE/DELETE including column grants, and missing/disabled audit append-only/hash-chain triggers. It conservatively denies executable SECURITY DEFINER functions and readable/writable views, materialized views or foreign tables in the application schema; those paths need a separately reviewed extension before use.

Membership checks use MEMBER conservatively, including indirect memberships even when inheritance/SET options are restricted. The checker is deliberately stricter than merely testing BYPASSRLS on current_user. It does not change roles, ownership or grants. Resolve failures through reviewed migration/identity permissions rather than running the checker with an owner account.

## Synthetic behaviour suite

Use a disposable staging database with the complete 46-migration schema. Provision a distinct restricted login runtime role with only the required DML, SELECT on the RLS policy dependency tables, and no grants caught by the catalog checker. The controlled fixture provisioner needs bypass authority solely for setup; it must never be the runtime login. Do not grant all-table DML: assignment/audit restrictions must remain intact.

1. Connect as the controlled fixture provisioner and run once:

```powershell
$env:PGSERVICE = "legaltech-synthetic-fixture-provisioner"
psql -X --no-password --set=app_schema=public --file .\30_PRODUCTION_SHAPE_SCAFFOLD\db\verification\setup_rls_fixtures.sql
if ($LASTEXITCODE -ne 0) { throw "Fixture setup failed." }
```

2. Connect directly as the runtime identity on that same synthetic database:

```powershell
$env:PGSERVICE = "legaltech-synthetic-runtime"
npm --prefix 30_PRODUCTION_SHAPE_SCAFFOLD run check:runtime-db -- --runtime-role legaltech_runtime --schema public --isolation
if ($LASTEXITCODE -ne 0) { throw "RLS isolation verification failed." }
```

The two service names are illustrative and must point to the same isolated database. Setup creates two synthetic tenants, three actors, two zones and six matters with explicit grants. Existing fixture IDs fail instead of overwriting rows. Destroy the disposable database after the controlled run; no automatic customer-data cleanup is supplied.

The behaviour suite first runs the catalog check. It requires SELECT/INSERT/UPDATE authority on matters so missing DML privileges cannot impersonate RLS denial. It verifies missing-context deny, own standard/private/zone access, other-tenant/private/ungranted-zone invisibility, denied updates, an authorized update, rejected cross-tenant insert, actor-swap denial, authorized visibility of every negative fixture, tenant-B visibility and transaction-local context cleanup after rollback. All behaviour-suite writes roll back. Fixture setup is persistent until the disposable database is destroyed.

## Evidence boundaries

Record database/provider identity, PostgreSQL version, release and migration-manifest digest, role/grant change reference, both script statuses and operator/time in controlled deployment evidence. Keep connection credentials and legal content out of reports.

Catalog checks do not verify policy semantics, trigger/function body hashes, the complete required privilege matrix, all alternative schemas, provider/cloud operations or pool transaction handling. The synthetic suite covers the named matter cases, not every document, audit, exception, job and new-table policy. Application authorization and trusted server-bound tenant/actor context remain mandatory; tenant GUC values must never come from untrusted request fields. Separate live driver tests must prove rollback/reuse, parallel tenant requests and cancellation on the actual pool. Passing these scripts is a bounded verification result, not full production certification.

Primary semantics: [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) and [role/privilege inspection functions](https://www.postgresql.org/docs/current/functions-info.html).
