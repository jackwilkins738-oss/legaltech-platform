-- V117: execute as the actual direct-login runtime role inside BEGIN READ ONLY.
-- verification.expected_role and verification.schema are bound by the caller.
DO $$
DECLARE
  target_schema text := current_setting('verification.schema');
  expected_role text := current_setting('verification.expected_role');
  relation record;
  required_name text;
BEGIN
  IF current_user <> expected_role OR session_user <> expected_role THEN
    RAISE EXCEPTION 'RUNTIME_DIRECT_LOGIN_REQUIRED';
  END IF;
  IF current_setting('row_security') <> 'on' THEN
    RAISE EXCEPTION 'RUNTIME_ROW_SECURITY_REQUIRED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('legaltech_session_broker','legaltech_security_reader','legaltech_security_operator','legaltech_rate_limiter','legaltech_audit_writer','legaltech_audit_reader','legaltech_queue_producer','legaltech_queue_worker','legaltech_queue_reader','legaltech_outbox_relay')
    AND pg_catalog.pg_has_role(current_user,r.oid,'MEMBER')) THEN
    RAISE EXCEPTION 'RUNTIME_SESSION_BROKER_ROLE_FORBIDDEN';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE pg_catalog.pg_has_role(current_user,r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
        OR r.rolname IN ('pg_read_all_data','pg_write_all_data','pg_read_server_files',
          'pg_write_server_files','pg_execute_server_program'))
  ) THEN RAISE EXCEPTION 'RUNTIME_PRIVILEGED_ROLE_FORBIDDEN'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname=current_database()
      AND pg_catalog.pg_has_role(current_user,d.datdba,'MEMBER')
  ) OR pg_catalog.has_database_privilege(current_user,current_database(),'CREATE') THEN
    RAISE EXCEPTION 'RUNTIME_DATABASE_OWNERSHIP_FORBIDDEN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=target_schema) THEN
    RAISE EXCEPTION 'RUNTIME_SCHEMA_MISSING';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('identity_security','operational_security','audit_security','queue_security')
      AND c.relkind IN ('r','p','v','m','f')
      AND (pg_catalog.pg_has_role(current_user,c.relowner,'MEMBER')
        OR pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR pg_catalog.has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE'))
  ) THEN RAISE EXCEPTION 'RUNTIME_CONTROL_PLANE_ACCESS_FORBIDDEN'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname=target_schema
      AND (pg_catalog.pg_has_role(current_user,n.nspowner,'MEMBER')
        OR pg_catalog.has_schema_privilege(current_user,n.oid,'CREATE'))
  ) THEN RAISE EXCEPTION 'RUNTIME_SCHEMA_MUTATION_FORBIDDEN'; END IF;
  -- No unreviewed alternative access path may bypass the base-table checks.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=target_schema AND p.prosecdef
      AND pg_catalog.has_function_privilege(current_user,p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'RUNTIME_SECURITY_DEFINER_FORBIDDEN'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=target_schema AND c.relkind IN ('v','m','f')
      AND pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE')
  ) THEN RAISE EXCEPTION 'RUNTIME_ALTERNATE_RELATION_FORBIDDEN'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=target_schema AND c.relkind IN ('r','p','v','m','f','S')
      AND pg_catalog.pg_has_role(current_user,c.relowner,'MEMBER')
  ) THEN RAISE EXCEPTION 'RUNTIME_TABLE_OWNERSHIP_FORBIDDEN'; END IF;
  IF pg_catalog.has_table_privilege(current_user,format('%I.tenants',target_schema),'INSERT,UPDATE,DELETE,TRUNCATE')
    OR pg_catalog.has_any_column_privilege(current_user,format('%I.tenants',target_schema),'INSERT,UPDATE') THEN
    RAISE EXCEPTION 'RUNTIME_TENANT_ADMIN_MUTATION_FORBIDDEN';
  END IF;
  FOREACH required_name IN ARRAY ARRAY[
    'actors','matters','external_mappings','inbound_events','exceptions','idempotency_records',
    'audit_events','jobs','security_zones','actor_security_zones','matter_actor_access',
    'matter_break_glass_grants','document_security','document_actor_access','domain_outbox_events','domain_outbox_receipts'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname=target_schema AND c.relname=required_name AND c.relkind IN ('r','p')
        AND a.attname='tenant_id' AND NOT a.attisdropped
    ) THEN RAISE EXCEPTION 'RUNTIME_SECURITY_TABLE_MISSING'; END IF;
  END LOOP;
  FOR relation IN
    SELECT DISTINCT c.oid,c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname=target_schema AND c.relkind IN ('r','p')
      AND a.attname='tenant_id' AND NOT a.attisdropped
  LOOP
    IF pg_catalog.pg_has_role(current_user,relation.relowner,'MEMBER') THEN
      RAISE EXCEPTION 'RUNTIME_TABLE_OWNERSHIP_FORBIDDEN';
    END IF;
    IF NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity
      OR NOT pg_catalog.row_security_active(relation.oid)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=relation.oid) THEN
      RAISE EXCEPTION 'RUNTIME_RLS_REQUIRED';
    END IF;
    -- TRUNCATE is outside RLS and must never be available to runtime users.
    IF pg_catalog.has_table_privilege(current_user,relation.oid,'TRUNCATE') THEN
      RAISE EXCEPTION 'RUNTIME_TRUNCATE_FORBIDDEN';
    END IF;
  END LOOP;
  FOREACH required_name IN ARRAY ARRAY[
    'matter_actor_access','matter_break_glass_grants','actor_security_zones',
    'document_actor_access','document_security'
  ] LOOP
    IF pg_catalog.has_table_privilege(current_user,format('%I.%I',target_schema,required_name),'INSERT,UPDATE,DELETE')
      OR pg_catalog.has_any_column_privilege(current_user,format('%I.%I',target_schema,required_name),'INSERT,UPDATE') THEN
      RAISE EXCEPTION 'RUNTIME_GRANT_MUTATION_FORBIDDEN';
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege(current_user,format('%I.audit_events',target_schema),'UPDATE,DELETE')
    OR pg_catalog.has_any_column_privilege(current_user,format('%I.audit_events',target_schema),'UPDATE') THEN
    RAISE EXCEPTION 'RUNTIME_AUDIT_MUTATION_FORBIDDEN';
  END IF;
  FOREACH required_name IN ARRAY ARRAY['audit_events_append_only','audit_events_hash_chain'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=target_schema AND c.relname='audit_events' AND t.tgname=required_name
        AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
    ) THEN RAISE EXCEPTION 'RUNTIME_AUDIT_TRIGGER_REQUIRED'; END IF;
  END LOOP;
END;
$$;
