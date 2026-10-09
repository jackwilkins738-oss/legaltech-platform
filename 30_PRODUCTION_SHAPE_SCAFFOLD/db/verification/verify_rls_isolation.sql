-- SYNTHETIC STAGING DATABASE ONLY. Connect directly as the API runtime role.
-- Requires setup_rls_fixtures.sql to have committed successfully on this database.
\set ON_ERROR_STOP on
\ir verify_runtime.sql
BEGIN;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL row_security = on;
SET LOCAL search_path = pg_catalog;
SELECT set_config('verification.schema', :'app_schema', true);
DO $$
DECLARE
  schema_name text := current_setting('verification.schema');
  table_name text := format('%I.matters',schema_name);
  found bigint;
  matter uuid;
BEGIN
  -- Require positive capabilities: denial must come from RLS, not missing DML grants.
  IF NOT has_table_privilege(current_user,table_name,'SELECT')
    OR NOT has_table_privilege(current_user,table_name,'INSERT')
    OR NOT has_table_privilege(current_user,table_name,'UPDATE') THEN
    RAISE EXCEPTION 'RLS_TEST_DML_PRIVILEGES_REQUIRED';
  END IF;
  IF NULLIF(current_setting('app.tenant_id',true),'') IS NOT NULL
    OR NULLIF(current_setting('app.actor_id',true),'') IS NOT NULL THEN
    RAISE EXCEPTION 'RLS_TEST_STALE_CONNECTION_CONTEXT';
  END IF;
  EXECUTE format('SELECT count(*) FROM %s',table_name) INTO found;
  IF found<>0 THEN RAISE EXCEPTION 'RLS_MISSING_TENANT_CONTEXT_LEAK'; END IF;
  PERFORM set_config('app.tenant_id','11700000-0000-4000-8000-000000000001',true);
  PERFORM set_config('app.actor_id','11700000-0000-4000-8000-000000000011',true);
  FOREACH matter IN ARRAY ARRAY[
    '11700000-0000-4000-8000-000000000031'::uuid,
    '11700000-0000-4000-8000-000000000032'::uuid,
    '11700000-0000-4000-8000-000000000034'::uuid
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE id=$1',table_name) INTO found USING matter;
    IF found<>1 THEN RAISE EXCEPTION 'RLS_AUTHORIZED_FIXTURE_UNAVAILABLE'; END IF;
  END LOOP;
  FOREACH matter IN ARRAY ARRAY[
    '11700000-0000-4000-8000-000000000033'::uuid,
    '11700000-0000-4000-8000-000000000035'::uuid,
    '11700000-0000-4000-8000-000000000036'::uuid
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE id=$1',table_name) INTO found USING matter;
    IF found<>0 THEN RAISE EXCEPTION 'RLS_RESTRICTED_READ_LEAK'; END IF;
    EXECUTE format('UPDATE %s SET display_reference=display_reference WHERE id=$1',table_name) USING matter;
    GET DIAGNOSTICS found = ROW_COUNT;
    IF found<>0 THEN RAISE EXCEPTION 'RLS_RESTRICTED_WRITE_LEAK'; END IF;
  END LOOP;
  EXECUTE format('UPDATE %s SET display_reference=display_reference WHERE id=$1',table_name)
    USING '11700000-0000-4000-8000-000000000031'::uuid;
  GET DIAGNOSTICS found = ROW_COUNT;
  IF found<>1 THEN RAISE EXCEPTION 'RLS_AUTHORIZED_WRITE_UNAVAILABLE'; END IF;
  BEGIN
    EXECUTE format('INSERT INTO %s (id,tenant_id,display_reference) VALUES ($1,$2,$3)',table_name)
      USING '11700000-0000-4000-8000-000000000099'::uuid,
        '11700000-0000-4000-8000-000000000002'::uuid,'V117-cross-tenant-write';
    RAISE EXCEPTION 'RLS_CROSS_TENANT_INSERT_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Negative fixtures must also be proven present through their authorized actor.
  PERFORM set_config('app.actor_id','11700000-0000-4000-8000-000000000013',true);
  FOREACH matter IN ARRAY ARRAY[
    '11700000-0000-4000-8000-000000000033'::uuid,
    '11700000-0000-4000-8000-000000000035'::uuid
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE id=$1',table_name) INTO found USING matter;
    IF found<>1 THEN RAISE EXCEPTION 'RLS_NEGATIVE_FIXTURE_UNAVAILABLE'; END IF;
  END LOOP;
  PERFORM set_config('app.actor_id','11700000-0000-4000-8000-000000000012',true);
  EXECUTE format('SELECT count(*) FROM %s WHERE id=$1',table_name) INTO found
    USING '11700000-0000-4000-8000-000000000032'::uuid;
  IF found<>0 THEN RAISE EXCEPTION 'RLS_ACTOR_SWAP_LEAK'; END IF;
  -- Prove tenant B fixture exists and is visible with its own complete context.
  PERFORM set_config('app.tenant_id','11700000-0000-4000-8000-000000000002',true);
  EXECUTE format('SELECT count(*) FROM %s WHERE id=$1',table_name) INTO found
    USING '11700000-0000-4000-8000-000000000036'::uuid;
  IF found<>1 THEN RAISE EXCEPTION 'RLS_OTHER_TENANT_FIXTURE_UNAVAILABLE'; END IF;
END;
$$;
ROLLBACK;
DO $$ BEGIN
  IF NULLIF(current_setting('app.tenant_id',true),'') IS NOT NULL
    OR NULLIF(current_setting('app.actor_id',true),'') IS NOT NULL THEN
    RAISE EXCEPTION 'RLS_TRANSACTION_CONTEXT_LEAK';
  END IF;
END; $$;
SELECT 'RLS_SYNTHETIC_BEHAVIOUR_CHECK_PASSED' AS result;
