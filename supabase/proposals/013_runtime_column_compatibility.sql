-- PROPOSAL ONLY: review inventory, old write constraints and backfill mappings first.
-- Deliberately outside supabase/migrations so db push cannot apply it implicitly.
-- Adds only four confirmed runtime columns. No table recreation, row updates,
-- defaults, NOT NULL constraints, grants, policies, triggers or FK changes.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE item record; existing_type text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('issued_certificates','control_number'),
    ('media_files','file_url'),
    ('messages','sender_id'),
    ('registry_schema','field_key')
  ) AS requested(table_name,column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = item.table_name AND c.relkind IN ('r','p')
    ) THEN
      RAISE EXCEPTION 'Expected existing table public.% is absent or is not a table; review inventory.', item.table_name;
    END IF;
    SELECT a.atttypid::regtype::text INTO existing_type
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = format('public.%I', item.table_name)::regclass
      AND a.attname = item.column_name AND a.attnum > 0 AND NOT a.attisdropped;
    IF FOUND AND existing_type NOT IN ('text','character varying') THEN
      RAISE EXCEPTION 'Existing %.% has type %, expected text-compatible; no type conversion is authorized.', item.table_name,item.column_name,existing_type;
    END IF;
  END LOOP;
END $preflight$;

ALTER TABLE public.issued_certificates ADD COLUMN IF NOT EXISTS control_number text;
ALTER TABLE public.media_files ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_id text;
ALTER TABLE public.registry_schema ADD COLUMN IF NOT EXISTS field_key text;

-- Existing values and new-column NULLs are deliberately preserved.
-- Do not add audit_logs legacy aliases: correct the ORM to migration 001 instead.
COMMIT;
