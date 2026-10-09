# V77 — Migration and release integrity

V77 adds a fail-closed schema release boundary so rapid post-TO workflow development cannot silently mutate or drift production database history.

## Hash-pinned migration history

`30_PRODUCTION_SHAPE_SCAFFOLD/db/migrations/MANIFEST.json` records every committed SQL migration in sequence with its SHA-256 checksum. Validation requires the directory and manifest to contain the exact same migration set, all migration names to form a contiguous ordered sequence, and every file to be a bounded regular file inside the migration directory. Symlink substitution, missing files, unexpected SQL and historical byte changes fail closed. This is the **migration checksum pinning** and **migration sequence integrity** boundary.

## Applied schema compatibility

An environment's applied migration evidence must be the exact checksum-pinned prefix of the committed manifest. Reordering, checksum drift, unknown migrations or skipped history are rejected. A readiness adapter emits only `SCHEMA_CURRENT`, `SCHEMA_MIGRATIONS_PENDING` or `SCHEMA_MIGRATION_DRIFT`, allowing V76 to stop traffic when the runtime schema is not compatible. This is the **schema readiness gate**.

## Destructive migration boundary

Data/schema destructive patterns such as `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, `DROP SCHEMA` and `DROP TYPE` are not accepted merely because a migration exists. The manifest must explicitly mark the migration destructive and carry a bounded review reference; a review flag that no longer matches the SQL also fails. Routine trigger/policy replacement is not classified as destructive data loss. This is the **destructive migration review** boundary.

## Production interlocks

Production requires:

- `MIGRATION_MANIFEST_MODE=hash-pinned`
- `MIGRATION_EXECUTION_MODE=external-controlled`
- `DESTRUCTIVE_MIGRATION_MODE=review-required`
- `SCHEMA_READINESS_MODE=required`

Runtime application instances therefore do not gain an implied authority to auto-migrate production. Execution remains a controlled deployment concern.

## Deliberately not claimed

V77 does not claim a live production database, migration rehearsal, zero-downtime compatibility proof or rollback success. It provides the repository/runtime contracts needed to verify those facts when infrastructure exists.
