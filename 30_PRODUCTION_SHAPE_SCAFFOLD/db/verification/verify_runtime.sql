\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL row_security = on;
SET LOCAL search_path = pg_catalog;
SELECT set_config('verification.expected_role', :'runtime_role', true),
       set_config('verification.schema', :'app_schema', true);
\ir runtime_security.sql
ROLLBACK;
SELECT 'RUNTIME_CATALOG_CHECK_PASSED' AS result;
