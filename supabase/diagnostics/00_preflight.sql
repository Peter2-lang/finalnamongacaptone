-- READ ONLY. Bundle renderer sets only transaction-local review metadata.
-- A backup reference is an operator attestation, not automatic proof of recovery.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name,current_user AS migration_operator,
       current_setting('server_version') AS postgres_version,
       current_setting('registry_review.expected_database',true) AS expected_database,
       current_setting('registry_review.backend_role',true) AS verified_backend_role,
       current_setting('registry_review.backup_reference',true) AS operator_backup_reference;
DO $preflight$
DECLARE backend text:=current_setting('registry_review.backend_role',true);
BEGIN
 IF nullif(current_setting('registry_review.expected_database',true),'') IS NULL
 OR nullif(current_setting('registry_review.backup_reference',true),'') IS NULL OR nullif(backend,'') IS NULL THEN
  RAISE EXCEPTION 'Review gate: supply verified database name, backend role and recoverable backup reference when rendering this preflight.';
 END IF;
 IF current_database() IS DISTINCT FROM current_setting('registry_review.expected_database',true) THEN
  RAISE EXCEPTION 'Wrong database: stop and verify project and backend connection identity.';
 END IF;
 IF backend IN ('anon','authenticated','authenticator','PUBLIC') OR backend LIKE 'pg_%'
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=backend) THEN
  RAISE EXCEPTION 'Verified trusted PostgreSQL backend role required.';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND pg_has_role(oid,backend,'MEMBER')) THEN
  RAISE EXCEPTION 'Browser role can inherit backend role; security review required.';
 END IF;
 IF NOT has_schema_privilege(backend,'public','USAGE') THEN
  RAISE EXCEPTION 'Backend role lacks public schema usage; review existing permissions.';
 END IF;
END $preflight$;
-- Identity must also match Supabase project/host verified outside this SQL connection.
-- Existing data/type/RLS review and owner approval remain mandatory release gates.
COMMIT;
