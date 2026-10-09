BEGIN;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['legaltech_audit_writer','legaltech_audit_reader'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'unsafe audit group';
    END IF;
  END LOOP;
END; $$;
GRANT legaltech_audit_reader TO legaltech_audit_writer;
CREATE SCHEMA audit_security;
REVOKE ALL ON SCHEMA audit_security FROM PUBLIC;
GRANT USAGE ON SCHEMA audit_security TO legaltech_audit_reader,legaltech_audit_writer;
CREATE TABLE audit_security.tenant_heads (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id),
  position bigint NOT NULL CHECK(position BETWEEN 0 AND 9007199254740991),
  head_hash char(64) NOT NULL CHECK(head_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE audit_security.entries (
  tenant_id uuid NOT NULL REFERENCES audit_security.tenant_heads(tenant_id),
  position bigint NOT NULL CHECK(position BETWEEN 1 AND 9007199254740991),
  event_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  request_hash char(64) NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  previous_hash char(64) NOT NULL CHECK(previous_hash ~ '^[a-f0-9]{64}$'),
  entry_hash char(64) NOT NULL CHECK(entry_hash ~ '^[a-f0-9]{64}$'),
  canonical_payload text NOT NULL CHECK(octet_length(canonical_payload)<=4096),
  payload jsonb GENERATED ALWAYS AS (canonical_payload::jsonb) STORED,
  PRIMARY KEY(tenant_id,position),
  UNIQUE(tenant_id,event_id)
);
-- Payloads are flat, strictly constrained ASCII metadata, so scalar jsonb rendering
-- with C key ordering matches the application's canonical JSON bytes.
CREATE FUNCTION audit_security.canonical_metadata(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT '{'||string_agg(to_jsonb(key)::text||':'||val::text,',' ORDER BY key COLLATE "C")||'}'
  FROM jsonb_each(value) AS fields(key,val)
$$;
CREATE FUNCTION audit_security.protect_head() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.position<>0 OR NEW.head_hash<>repeat('0',64) THEN RAISE EXCEPTION 'invalid audit genesis'; END IF;
  ELSE
    IF NEW.tenant_id<>OLD.tenant_id OR NEW.position<>OLD.position+1 OR NOT EXISTS(
      SELECT 1 FROM audit_security.entries e WHERE e.tenant_id=OLD.tenant_id AND e.position=NEW.position
        AND e.previous_hash=OLD.head_hash AND e.entry_hash=NEW.head_hash) THEN
      RAISE EXCEPTION 'invalid audit head advance';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER protect_audit_head BEFORE INSERT OR UPDATE ON audit_security.tenant_heads
FOR EACH ROW EXECUTE FUNCTION audit_security.protect_head();
CREATE FUNCTION audit_security.validate_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE head audit_security.tenant_heads%ROWTYPE; value jsonb; expected jsonb; BEGIN
  SELECT * INTO head FROM audit_security.tenant_heads WHERE tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND OR NEW.position<>head.position+1 OR NEW.previous_hash<>head.head_hash THEN
    RAISE EXCEPTION 'audit chain predecessor invalid';
  END IF;
  IF head.position>0 AND NOT EXISTS(SELECT 1 FROM audit_security.entries e
    WHERE e.tenant_id=NEW.tenant_id AND e.position=head.position AND e.entry_hash=head.head_hash AND e.created_at<=NEW.created_at) THEN
    RAISE EXCEPTION 'audit predecessor/time invalid';
  END IF;
  -- Generated columns are populated after BEFORE triggers, so parse source bytes here.
  value=NEW.canonical_payload::jsonb;
  expected=jsonb_build_object('version',1,'tenantId',NEW.tenant_id::text,'eventId',NEW.event_id::text,
    'position',NEW.position,'createdAt',value->>'createdAt','requestHash',NEW.request_hash::text,
    'actorHash',value->>'actorHash','traceHash',value->>'traceHash',
    'objectHash',value->>'objectHash','matterHash',value->>'matterHash',
    'action',value->>'action','outcome',value->>'outcome','reasonCode',value->>'reasonCode');
  IF value IS DISTINCT FROM expected OR NEW.canonical_payload IS DISTINCT FROM audit_security.canonical_metadata(value)
    OR NOT COALESCE((value->>'actorHash') ~ '^[a-f0-9]{64}$',false)
    OR NOT COALESCE((value->>'traceHash') ~ '^[a-f0-9]{64}$',false)
    OR NOT COALESCE((value->>'action') ~ '^[A-Z][A-Z0-9_]{0,63}$',false)
    OR NOT COALESCE((value->>'outcome') ~ '^[A-Z][A-Z0-9_]{0,31}$',false)
    OR ((value->>'objectHash') IS NOT NULL AND (value->>'objectHash') !~ '^[a-f0-9]{64}$')
    OR ((value->>'matterHash') IS NOT NULL AND (value->>'matterHash') !~ '^[a-f0-9]{64}$')
    OR ((value->>'reasonCode') IS NOT NULL AND (value->>'reasonCode') !~ '^[A-Z][A-Z0-9_]{0,63}$')
    OR (value->>'createdAt')::timestamptz IS DISTINCT FROM NEW.created_at OR NEW.created_at>clock_timestamp()
    OR NEW.request_hash<>encode(public.digest(convert_to(audit_security.canonical_metadata(value-'position'-'createdAt'-'requestHash'),'UTF8'),'sha256'),'hex')
    OR NEW.entry_hash<>encode(public.digest(convert_to(NEW.previous_hash::text||chr(10)||NEW.canonical_payload,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION 'audit metadata/hash invalid';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_audit_entry BEFORE INSERT ON audit_security.entries
FOR EACH ROW EXECUTE FUNCTION audit_security.validate_entry();
CREATE FUNCTION audit_security.advance_head() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  UPDATE audit_security.tenant_heads SET position=NEW.position,head_hash=NEW.entry_hash WHERE tenant_id=NEW.tenant_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER advance_audit_head AFTER INSERT ON audit_security.entries
FOR EACH ROW EXECUTE FUNCTION audit_security.advance_head();
CREATE FUNCTION audit_security.deny_entry_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'audit ledger append only'; END; $$;
CREATE TRIGGER audit_entries_no_update_delete BEFORE UPDATE OR DELETE ON audit_security.entries
FOR EACH ROW EXECUTE FUNCTION audit_security.deny_entry_mutation();
CREATE TRIGGER audit_entries_no_truncate BEFORE TRUNCATE ON audit_security.entries
FOR EACH STATEMENT EXECUTE FUNCTION audit_security.deny_entry_mutation();
ALTER TABLE audit_security.tenant_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_security.tenant_heads FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_security.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_security.entries FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_heads_read ON audit_security.tenant_heads FOR SELECT TO legaltech_audit_reader USING(true);
CREATE POLICY audit_heads_insert ON audit_security.tenant_heads FOR INSERT TO legaltech_audit_writer WITH CHECK(true);
CREATE POLICY audit_heads_advance ON audit_security.tenant_heads FOR UPDATE TO legaltech_audit_writer USING(true) WITH CHECK(true);
CREATE POLICY audit_entries_read ON audit_security.entries FOR SELECT TO legaltech_audit_reader USING(true);
CREATE POLICY audit_entries_append ON audit_security.entries FOR INSERT TO legaltech_audit_writer WITH CHECK(true);
REVOKE ALL ON ALL TABLES IN SCHEMA audit_security FROM PUBLIC;
GRANT SELECT ON audit_security.tenant_heads,audit_security.entries TO legaltech_audit_reader;
GRANT INSERT ON audit_security.tenant_heads,audit_security.entries TO legaltech_audit_writer;
GRANT UPDATE(position,head_hash) ON audit_security.tenant_heads TO legaltech_audit_writer;
COMMIT;
