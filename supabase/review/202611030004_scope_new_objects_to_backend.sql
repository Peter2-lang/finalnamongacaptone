-- REVIEW ONLY. Edit only the role value after confirming the role used by pg.
-- A pooler username postgres.PROJECT_REF commonly maps to PostgreSQL role postgres;
-- confirm with SELECT current_user through the backend connection. Do not assume.
-- These policies trust the existing Express Auth/RBAC boundary for all app users.
-- No browser role receives grants or a new policy. Existing objects are skipped
-- unless stage 001/003 marked them as created by this exact review bundle.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT set_config('registry_migration.backend_role','REPLACE_WITH_VERIFIED_BACKEND_ROLE',true);
DO $access$
DECLARE backend_role text:=current_setting('registry_migration.backend_role');
        backend_oid oid; item record; operation text; policy_name text; existing_policy record;
BEGIN
  IF backend_role='REPLACE_WITH_VERIFIED_BACKEND_ROLE' OR backend_role IN ('anon','authenticated','authenticator','PUBLIC') OR backend_role LIKE 'pg_%' THEN
    RAISE EXCEPTION 'Set the verified dedicated server connection role; browser and unspecified roles are refused.';
  END IF;
  SELECT oid INTO backend_oid FROM pg_roles WHERE rolname=backend_role;
  IF backend_oid IS NULL THEN RAISE EXCEPTION 'The selected backend role does not exist.'; END IF;
  IF NOT has_schema_privilege(backend_oid,'public','USAGE') THEN RAISE EXCEPTION 'Backend role lacks public schema usage; review existing schema permissions separately.'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND pg_has_role(oid,backend_oid,'MEMBER')) THEN
    RAISE EXCEPTION 'A browser role can inherit the selected backend role; review membership before granting access.';
  END IF;
  FOR item IN SELECT * FROM (VALUES
    ('issued_certificates',ARRAY['SELECT','INSERT','UPDATE']),
    ('messages',ARRAY['SELECT','INSERT','UPDATE','DELETE']),
    ('media_files',ARRAY['SELECT','INSERT','UPDATE','DELETE']),
    ('registry_schema',ARRAY['SELECT','INSERT','UPDATE']),
    ('legal_documents',ARRAY['SELECT','INSERT','UPDATE','DELETE']),
    ('legal_document_audit_logs',ARRAY['SELECT','INSERT'])
  ) AS permissions(table_name,operations)
  LOOP
    IF to_regclass(format('public.%I',item.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required runtime table % is absent; complete stage 001 first.',item.table_name;
    END IF;
    IF obj_description(to_regclass(format('public.%I',item.table_name)),'pg_class') IS DISTINCT FROM 'hinunangan-reviewed:202611030001' THEN
      RAISE NOTICE 'Leaving existing table public.% grants and policies unchanged.',item.table_name;
      CONTINUE;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(format('public.%I',item.table_name)) AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION 'Managed table % must retain enabled/forced RLS.',item.table_name;
    END IF;
    FOREACH operation IN ARRAY item.operations LOOP
      policy_name:='registry_backend_'||lower(operation);
      SELECT * INTO existing_policy FROM pg_policy WHERE polrelid=to_regclass(format('public.%I',item.table_name)) AND polname=policy_name;
      IF FOUND THEN
        -- Never broaden or replace an existing same-name policy on a rerun.
        IF existing_policy.polroles IS DISTINCT FROM ARRAY[backend_oid] OR NOT existing_policy.polpermissive
          OR existing_policy.polcmd IS DISTINCT FROM (CASE operation WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w' ELSE 'd' END)::"char"
          OR (operation<>'INSERT' AND pg_get_expr(existing_policy.polqual,existing_policy.polrelid) IS DISTINCT FROM 'true')
          OR (operation IN ('INSERT','UPDATE') AND pg_get_expr(existing_policy.polwithcheck,existing_policy.polrelid) IS DISTINCT FROM 'true') THEN
          RAISE EXCEPTION 'Policy % on % differs; review without overwriting it.',policy_name,item.table_name;
        END IF;
      ELSE
        IF operation='INSERT' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO %I WITH CHECK (true)',policy_name,item.table_name,backend_role);
        ELSIF operation='UPDATE' THEN
          EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO %I USING (true) WITH CHECK (true)',policy_name,item.table_name,backend_role);
        ELSE
          EXECUTE format('CREATE POLICY %I ON public.%I FOR %s TO %I USING (true)',policy_name,item.table_name,operation,backend_role);
        END IF;
      END IF;
      EXECUTE format('GRANT %s ON TABLE public.%I TO %I',operation,item.table_name,backend_role);
    END LOOP;
  END LOOP;
  IF obj_description(to_regclass('public.swine_tag_seq'),'pg_class')='hinunangan-reviewed:202611030003' THEN
    EXECUTE format('GRANT USAGE ON SEQUENCE public.swine_tag_seq TO %I',backend_role);
  END IF;
END $access$;
COMMIT;
