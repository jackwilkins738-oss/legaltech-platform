BEGIN;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['legaltech_drain_owner','legaltech_drain_worker','legaltech_drain_operator','legaltech_drain_reader'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',role_name);
    ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name AND
      (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'unsafe drain role';
    END IF;
  END LOOP;
END; $$;
CREATE SCHEMA drain_security AUTHORIZATION legaltech_drain_owner;
REVOKE ALL ON SCHEMA drain_security FROM PUBLIC;

-- Only trusted provisioning administrators may bind real login principals to
-- deployments. Application credentials cannot grant scopes or mutate tables.
CREATE TABLE drain_security.principal_scopes (
  deployment_id text NOT NULL CHECK(deployment_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  principal name NOT NULL, access text NOT NULL CHECK(access IN ('WORKLOAD','CONTROL','READ')),
  active boolean NOT NULL DEFAULT true, PRIMARY KEY(deployment_id,principal,access)
);
CREATE TABLE drain_security.deployments (
  deployment_id text PRIMARY KEY CHECK(deployment_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  state text NOT NULL DEFAULT 'DRAINED' CHECK(state IN ('ACTIVE','DRAINING','DRAINED')),
  generation bigint NOT NULL DEFAULT 1 CHECK(generation BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE drain_security.leases (
  deployment_id text NOT NULL REFERENCES drain_security.deployments,
  operation_id text NOT NULL CHECK(operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  owner_id uuid NOT NULL, principal name NOT NULL,
  state text NOT NULL CHECK(state IN ('ABSENT','HELD','RELEASED')),
  kind text CHECK(kind IN ('INGRESS','BACKGROUND','SIDE_EFFECT')),
  token text UNIQUE CHECK(token ~ '^[a-f0-9]{64}$'),
  generation bigint CHECK(generation BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), released_at timestamptz,
  PRIMARY KEY(deployment_id,operation_id),
  CHECK((state='ABSENT' AND kind IS NULL AND token IS NULL AND generation IS NULL AND released_at IS NULL)
    OR (state='HELD' AND kind IS NOT NULL AND token IS NOT NULL AND generation IS NOT NULL AND released_at IS NULL)
    OR (state='RELEASED' AND kind IS NOT NULL AND token IS NOT NULL AND generation IS NOT NULL AND released_at IS NOT NULL))
);
CREATE INDEX held_deployment_leases ON drain_security.leases(deployment_id) WHERE state='HELD';
CREATE TABLE drain_security.controls (
  deployment_id text NOT NULL REFERENCES drain_security.deployments,
  operation_id text NOT NULL CHECK(operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  action text NOT NULL CHECK(action IN ('INIT','BEGIN','RESUME')), principal name NOT NULL,
  actor_id text NOT NULL CHECK(actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  request jsonb NOT NULL CHECK(jsonb_typeof(request)='object'),
  applied_generation bigint NOT NULL CHECK(applied_generation BETWEEN 1 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(deployment_id,operation_id)
);
CREATE TABLE drain_security.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES drain_security.deployments,
  operation_id text NOT NULL, action text NOT NULL CHECK(action IN ('INIT','ACQUIRE','RELEASE','ABSENCE','BEGIN','RESUME')),
  principal name NOT NULL, generation bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['principal_scopes','deployments','leases','controls','events'] LOOP
    EXECUTE format('ALTER TABLE drain_security.%I OWNER TO legaltech_drain_owner',table_name);
    EXECUTE format('ALTER TABLE drain_security.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE drain_security.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY owner_only ON drain_security.%I TO legaltech_drain_owner USING(true) WITH CHECK(true)',table_name);
    EXECUTE format('REVOKE ALL ON drain_security.%I FROM PUBLIC',table_name);
  END LOOP;
END; $$;
ALTER SEQUENCE drain_security.events_id_seq OWNER TO legaltech_drain_owner;

CREATE FUNCTION drain_security.assert_access(deployment text, mode text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp SET row_security=on AS $access$
BEGIN
  IF deployment IS NULL OR deployment !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' OR NOT EXISTS(
    SELECT 1 FROM drain_security.principal_scopes s WHERE s.deployment_id=deployment AND s.principal=session_user AND s.active
      AND ((mode='WORKLOAD' AND s.access='WORKLOAD' AND pg_has_role(session_user,'legaltech_drain_worker','MEMBER'))
        OR (mode='CONTROL' AND s.access='CONTROL' AND pg_has_role(session_user,'legaltech_drain_operator','MEMBER'))
        OR (mode='READ' AND ((s.access='READ' AND pg_has_role(session_user,'legaltech_drain_reader','MEMBER'))
          OR (s.access='WORKLOAD' AND pg_has_role(session_user,'legaltech_drain_worker','MEMBER'))
          OR (s.access='CONTROL' AND pg_has_role(session_user,'legaltech_drain_operator','MEMBER')))))) THEN
    RAISE EXCEPTION 'DRAIN_SCOPE_FORBIDDEN';
  END IF;
END;
$access$;
CREATE FUNCTION drain_security.status_json(deployment text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp SET row_security=on AS $status$
  SELECT jsonb_build_object('state',d.state,'generation',d.generation,'inFlight',
    (SELECT count(*) FROM drain_security.leases l WHERE l.deployment_id=d.deployment_id AND l.state='HELD'),
    'acceptingNew',d.state='ACTIVE') FROM drain_security.deployments d WHERE d.deployment_id=deployment;
$status$;

-- One serialized, narrow API; fixed owner, search path, no dynamic SQL and no
-- PUBLIC execute. The owner cannot log in and has no domain/control privileges.
CREATE FUNCTION drain_security.operate(deployment text, action text, input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $operate$
DECLARE
  mode text; keys text[]; d drain_security.deployments%ROWTYPE;
  l drain_security.leases%ROWTYPE; c drain_security.controls%ROWTYPE;
  operation text; owner uuid; token_value text;
BEGIN
  mode:=CASE WHEN action IN ('INIT','BEGIN','RESUME') THEN 'CONTROL'
    WHEN action IN ('ACQUIRE','RELEASE','LOOKUP') THEN 'WORKLOAD' WHEN action='STATUS' THEN 'READ' END;
  IF mode IS NULL OR input IS NULL OR jsonb_typeof(input)<>'object' THEN RAISE EXCEPTION 'DRAIN_INPUT_INVALID'; END IF;
  PERFORM drain_security.assert_access(deployment,mode);
  keys:=CASE action WHEN 'STATUS' THEN ARRAY[]::text[] WHEN 'INIT' THEN ARRAY['operationId','actorId']
    WHEN 'BEGIN' THEN ARRAY['operationId','actorId','reasonHash'] WHEN 'RESUME' THEN ARRAY['operationId','actorId','expectedGeneration']
    WHEN 'ACQUIRE' THEN ARRAY['operationId','ownerId','kind','token'] WHEN 'RELEASE' THEN ARRAY['operationId','ownerId','token','generation']
    WHEN 'LOOKUP' THEN ARRAY['operationId','ownerId'] END;
  IF NOT input ?& keys OR input-keys<>'{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_each(input) v WHERE jsonb_typeof(v.value)='null') THEN
    RAISE EXCEPTION 'DRAIN_INPUT_INVALID';
  END IF;
  IF action='STATUS' THEN
    RETURN drain_security.status_json(deployment);
  END IF;
  operation:=input->>'operationId';
  IF jsonb_typeof(input->'operationId')<>'string' OR operation !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RAISE EXCEPTION 'DRAIN_INPUT_INVALID'; END IF;
  IF mode='CONTROL' AND (jsonb_typeof(input->'actorId')<>'string' OR input->>'actorId' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$') THEN RAISE EXCEPTION 'DRAIN_INPUT_INVALID'; END IF;
  IF action='BEGIN' AND (jsonb_typeof(input->'reasonHash')<>'string' OR input->>'reasonHash' !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'DRAIN_INPUT_INVALID'; END IF;
  IF action='INIT' THEN
    INSERT INTO drain_security.deployments(deployment_id) VALUES(deployment) ON CONFLICT DO NOTHING;
  END IF;
  SELECT * INTO d FROM drain_security.deployments WHERE deployment_id=deployment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAIN_NOT_PROVISIONED'; END IF;
  IF mode='CONTROL' THEN
    SELECT * INTO c FROM drain_security.controls WHERE deployment_id=deployment AND operation_id=operation;
    IF FOUND THEN
      IF c.action<>action OR c.principal<>session_user OR c.request<>input OR c.applied_generation<>d.generation THEN RAISE EXCEPTION 'DRAIN_CONTROL_CONFLICT'; END IF;
      RETURN drain_security.status_json(deployment);
    END IF;
    IF action='INIT' THEN
      -- Initialization cannot be used to reset an existing deployment.
      IF EXISTS(SELECT 1 FROM drain_security.controls WHERE deployment_id=deployment) THEN RAISE EXCEPTION 'DRAIN_ALREADY_PROVISIONED'; END IF;
    ELSIF action='BEGIN' THEN
      IF d.state='ACTIVE' THEN
        UPDATE drain_security.deployments SET state=CASE WHEN EXISTS(SELECT 1 FROM drain_security.leases WHERE deployment_id=deployment AND state='HELD') THEN 'DRAINING' ELSE 'DRAINED' END,
          generation=generation+1 WHERE deployment_id=deployment RETURNING * INTO d;
      END IF;
    ELSE
      IF jsonb_typeof(input->'expectedGeneration')<>'number' OR (input->>'expectedGeneration') !~ '^[1-9][0-9]*$'
        OR (input->>'expectedGeneration')::numeric<>d.generation OR d.state<>'DRAINED'
        OR EXISTS(SELECT 1 FROM drain_security.leases WHERE deployment_id=deployment AND state='HELD') THEN RAISE EXCEPTION 'DRAIN_RESUME_FORBIDDEN'; END IF;
      UPDATE drain_security.deployments SET state='ACTIVE',generation=generation+1 WHERE deployment_id=deployment RETURNING * INTO d;
    END IF;
    INSERT INTO drain_security.controls(deployment_id,operation_id,action,principal,actor_id,request,applied_generation)
      VALUES(deployment,operation,action,session_user,input->>'actorId',input,d.generation);
    INSERT INTO drain_security.events(deployment_id,operation_id,action,principal,generation) VALUES(deployment,operation,action,session_user,d.generation);
    RETURN drain_security.status_json(deployment);
  END IF;
  IF jsonb_typeof(input->'ownerId')<>'string' OR input->>'ownerId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN RAISE EXCEPTION 'DRAIN_INPUT_INVALID'; END IF;
  owner:=(input->>'ownerId')::uuid;
  SELECT * INTO l FROM drain_security.leases WHERE deployment_id=deployment AND operation_id=operation;
  IF FOUND AND (l.owner_id<>owner OR l.principal<>session_user) THEN RAISE EXCEPTION 'DRAIN_OWNER_CONFLICT'; END IF;
  IF action='LOOKUP' THEN
    IF l.operation_id IS NULL THEN
      -- Durable tombstone seals ABSENT before replying: a delayed acquisition
      -- cannot commit after reconciliation has authoritatively proved absence.
      INSERT INTO drain_security.leases(deployment_id,operation_id,owner_id,principal,state) VALUES(deployment,operation,owner,session_user,'ABSENT') RETURNING * INTO l;
      INSERT INTO drain_security.events(deployment_id,operation_id,action,principal,generation) VALUES(deployment,operation,'ABSENCE',session_user,d.generation);
    END IF;
    RETURN jsonb_build_object('state',l.state,'lease',CASE WHEN l.state='ABSENT' THEN NULL ELSE jsonb_build_object('token',l.token,'generation',l.generation) END);
  END IF;
  IF jsonb_typeof(input->'token')<>'string' OR input->>'token' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'DRAIN_INPUT_INVALID'; END IF;
  IF action='ACQUIRE' THEN
    IF jsonb_typeof(input->'kind')<>'string' OR input->>'kind' NOT IN ('INGRESS','BACKGROUND','SIDE_EFFECT') THEN RAISE EXCEPTION 'DRAIN_INPUT_INVALID'; END IF;
    IF l.operation_id IS NOT NULL THEN
      IF l.state<>'HELD' OR l.kind<>input->>'kind' THEN RAISE EXCEPTION 'DRAIN_ACQUIRE_CONFLICT'; END IF;
      RETURN jsonb_build_object('token',l.token,'generation',l.generation);
    END IF;
    IF d.state<>'ACTIVE' THEN RAISE EXCEPTION 'DRAIN_CLOSED'; END IF;
    token_value:=input->>'token';
    INSERT INTO drain_security.leases(deployment_id,operation_id,owner_id,principal,state,kind,token,generation)
      VALUES(deployment,operation,owner,session_user,'HELD',input->>'kind',token_value,d.generation) RETURNING * INTO l;
    INSERT INTO drain_security.events(deployment_id,operation_id,action,principal,generation) VALUES(deployment,operation,'ACQUIRE',session_user,d.generation);
    RETURN jsonb_build_object('token',l.token,'generation',l.generation);
  END IF;
  IF l.operation_id IS NULL OR l.state='ABSENT' OR l.token<>input->>'token'
    OR jsonb_typeof(input->'generation')<>'number' OR input->>'generation' !~ '^[1-9][0-9]*$'
    OR (input->>'generation')::numeric<>l.generation THEN RAISE EXCEPTION 'DRAIN_RELEASE_CONFLICT'; END IF;
  IF l.state='HELD' THEN
    UPDATE drain_security.leases SET state='RELEASED',released_at=clock_timestamp() WHERE deployment_id=deployment AND operation_id=operation;
    INSERT INTO drain_security.events(deployment_id,operation_id,action,principal,generation) VALUES(deployment,operation,'RELEASE',session_user,l.generation);
    IF d.state='DRAINING' AND NOT EXISTS(SELECT 1 FROM drain_security.leases WHERE deployment_id=deployment AND state='HELD') THEN
      UPDATE drain_security.deployments SET state='DRAINED' WHERE deployment_id=deployment;
    END IF;
  END IF;
  RETURN jsonb_build_object('released',true,'token',l.token,'generation',l.generation);
END;
$operate$;
ALTER FUNCTION drain_security.assert_access(text,text) OWNER TO legaltech_drain_owner;
ALTER FUNCTION drain_security.status_json(text) OWNER TO legaltech_drain_owner;
ALTER FUNCTION drain_security.operate(text,text,jsonb) OWNER TO legaltech_drain_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA drain_security FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA drain_security FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA drain_security FROM PUBLIC;
GRANT USAGE ON SCHEMA drain_security TO legaltech_drain_worker,legaltech_drain_operator,legaltech_drain_reader;
GRANT EXECUTE ON FUNCTION drain_security.operate(text,text,jsonb) TO legaltech_drain_worker,legaltech_drain_operator,legaltech_drain_reader;
COMMIT;
