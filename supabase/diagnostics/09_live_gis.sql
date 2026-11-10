-- Read-only preflight; run against the verified registry project, not another accessible project.
-- No farmer names, phone numbers, exact GPS coordinates, or JWTs are returned.
BEGIN TRANSACTION READ ONLY;
SELECT current_database(), current_user;
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('swine_records','farmers','barangays')
  AND column_name IN ('id','farmer_id','barangay_id','latitude','longitude','custom_fields','metadata')
ORDER BY table_name,ordinal_position;
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.swine_records'::regclass AND contype IN ('p','f','u');
SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
WHERE oid IN ('public.swine_records'::regclass,'public.farmers'::regclass,'public.users'::regclass);
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('swine_records','farmers','users');
SELECT pubname,schemaname,tablename FROM pg_publication_tables
WHERE pubname='supabase_realtime' AND tablename IN ('swine_records','users');
-- Current ORM persists pen GPS in custom_fields, not dedicated swine table columns.
SELECT count(*) AS records,
 count(*) FILTER (WHERE jsonb_typeof(custom_fields->'latitude')='number'
 AND jsonb_typeof(custom_fields->'longitude')='number') AS numeric_gps_pairs,
 count(*) FILTER (WHERE custom_fields->>'latitude' IS NULL OR custom_fields->>'longitude' IS NULL
 OR custom_fields->>'latitude'='0' OR custom_fields->>'longitude'='0') AS missing_or_zero_gps,
 count(*) FILTER (WHERE farmer_id IS NULL) AS missing_farmer_link
FROM public.swine_records;
-- This checks representation only; polygon validation is tested by the application.
ROLLBACK;
