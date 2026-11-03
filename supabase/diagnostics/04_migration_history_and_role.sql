-- Read-only metadata only: never dumps migration statement bodies or app records.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name,current_user AS inspecting_role;
-- SQL Editor's inspecting_role may differ from the Vercel connection role.
SELECT rolname,rolcanlogin,rolinherit,rolbypassrls FROM pg_roles
WHERE rolname=current_user OR rolname IN ('anon','authenticated','authenticator','service_role','postgres') ORDER BY rolname;
SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','registry_migrations') ORDER BY schemaname,tablename,indexname;
DO $history$
DECLARE item record; history jsonb;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('supabase_migrations.schema_migrations'),('drizzle.__drizzle_migrations'),
  ('public.__drizzle_migrations'),('registry_migrations.applied_migrations')
 ) AS candidates(relation_name)
 LOOP
  IF to_regclass(item.relation_name) IS NULL THEN
   RAISE NOTICE 'Migration tracking relation % is absent.',item.relation_name; CONTINUE;
  END IF;
  BEGIN
   EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''version'',to_jsonb(r)->>''version'',''name'',to_jsonb(r)->>''name'',''id'',to_jsonb(r)->>''id'',''hash'',coalesce(to_jsonb(r)->>''sha256'',to_jsonb(r)->>''hash''),''applied_at'',coalesce(to_jsonb(r)->>''applied_at'',to_jsonb(r)->>''created_at''))),''[]''::jsonb) FROM %s r',to_regclass(item.relation_name)) INTO history;
   RAISE NOTICE 'Migration tracking %: %',item.relation_name,history;
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'Migration tracking % requires owner access.',item.relation_name;
  END;
 END LOOP;
END $history$;
COMMIT;
