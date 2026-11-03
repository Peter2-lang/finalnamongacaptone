-- Reviewed additive repair for the THREE confirmed missing users columns.
-- Does not touch authentication mappings, user IDs, roles or permissions policies.
-- Operator: run manually in the correct Supabase SQL Editor after backup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE item record; actual text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'public.users is missing; stop rather than create a replacement.';
  END IF;
  FOR item IN
    SELECT * FROM (VALUES
      ('permissions','jsonb'),
      ('phone','text'),
      ('status','text')
    ) AS expected(column_name, data_type)
  LOOP
    SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
      INTO actual
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.users'::regclass
      AND a.attname = item.column_name
      AND a.attnum > 0 AND NOT a.attisdropped;
    IF actual IS NOT NULL AND actual <> item.data_type THEN
      RAISE EXCEPTION 'public.users.% has %, expected %; migration cancelled.',
        item.column_name, actual, item.data_type;
    END IF;
  END LOOP;
END
$preflight$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT;

-- No backfills. Existing status remains NULL: an unknown account state must
-- not be converted into 'active'. An existing admin must verify and map their
-- own account statuses from the authoritative identity/role source.
COMMIT;
