-- REVIEW ONLY. This private ledger tracks manual SQL Editor runs, not app records.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $ledger$
DECLARE role_name text;
BEGIN
  IF to_regnamespace('registry_migrations') IS NULL THEN
    CREATE SCHEMA registry_migrations;
    REVOKE ALL ON SCHEMA registry_migrations FROM PUBLIC;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON SCHEMA registry_migrations FROM %I',role_name);
      END IF;
    END LOOP;
  END IF;
  IF to_regclass('registry_migrations.applied_migrations') IS NULL THEN
    CREATE TABLE registry_migrations.applied_migrations(
      version text PRIMARY KEY, sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
      description text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
      applied_by name NOT NULL DEFAULT current_user
    );
    ALTER TABLE registry_migrations.applied_migrations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE registry_migrations.applied_migrations FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON registry_migrations.applied_migrations FROM PUBLIC;
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON registry_migrations.applied_migrations FROM %I',role_name);
      END IF;
    END LOOP;
    -- Scoped to the creating migration operator, never a public/browser policy.
    EXECUTE format('CREATE POLICY migration_operator ON registry_migrations.applied_migrations FOR ALL TO %I USING (true) WITH CHECK (true)',current_user);
  ELSE
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='registry_migrations.applied_migrations'::regclass AND relkind='r' AND relrowsecurity AND relforcerowsecurity AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
      RAISE EXCEPTION 'Existing receipt ledger is not owned by this migration operator; inspect ownership without replacing it.';
    END IF;
    PERFORM version,sha256,description,applied_at,applied_by FROM registry_migrations.applied_migrations LIMIT 0;
  END IF;
END $ledger$;
COMMIT;
