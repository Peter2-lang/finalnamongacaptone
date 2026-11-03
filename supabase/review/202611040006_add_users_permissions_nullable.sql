-- REVIEW-ONLY targeted schema repair for the observed SQLSTATE 42703.
-- Run manually in the correct Supabase SQL Editor only after a backup,
-- schema inventory and approval. This file is NOT auto-applied.
-- No existing rows, IDs, policies, roles or authentication links are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preflight$
DECLARE existing_type text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Missing public.users; do not create a replacement users table.';
  END IF;
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
    INTO existing_type
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.users'::regclass
    AND a.attname = 'permissions'
    AND a.attnum > 0 AND NOT a.attisdropped;
  IF existing_type IS NOT NULL AND existing_type <> 'jsonb' THEN
    RAISE EXCEPTION 'public.users.permissions exists with incompatible type %, expected jsonb.', existing_type;
  END IF;
END
$preflight$;

-- A new profile receives NO custom permissions unless the server explicitly
-- authorizes them. NULL existing values are retained, not guessed/backfilled.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS permissions jsonb DEFAULT '[]'::jsonb;

COMMIT;

-- Check all users permissions shapes without exposing account data.
SELECT
  COUNT(*) AS total_profiles,
  COUNT(*) FILTER (WHERE permissions IS NULL) AS null_permissions,
  COUNT(*) FILTER (WHERE permissions IS NOT NULL AND jsonb_typeof(permissions) <> 'array') AS invalid_permission_shapes
FROM public.users;
