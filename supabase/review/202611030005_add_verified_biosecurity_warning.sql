-- Current production health evidence: 2026-11-03T14:10:16Z, PostgreSQL 42703,
-- schema_error.table=swine_records, schema_error.column=biosecurity_warning.
-- Refresh catalog evidence and approve before execution. No historical assessment
-- is inferred: old rows remain NULL. No DEFAULT, NOT NULL, backfill or ID change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $compatibility$
DECLARE existing_type oid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.swine_records') AND relkind IN ('r','p')) THEN
    RAISE EXCEPTION 'Existing swine_records table required; inspect production catalog.';
  END IF;
  SELECT atttypid INTO existing_type FROM pg_attribute
  WHERE attrelid='public.swine_records'::regclass AND attname='biosecurity_warning' AND attnum>0 AND NOT attisdropped;
  IF FOUND AND existing_type<>'boolean'::regtype THEN
    RAISE EXCEPTION 'Existing swine_records.biosecurity_warning has incompatible type; no conversion authorized.';
  END IF;
END $compatibility$;
ALTER TABLE public.swine_records ADD COLUMN IF NOT EXISTS biosecurity_warning boolean;
COMMIT;
