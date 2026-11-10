-- REVIEW PROPOSAL ONLY. Not applied. Intended project: pxwjxrhkukonztmfczpm.
-- First verify per-role SELECT/INSERT/UPDATE/DELETE policies and trusted profile authority
-- in an isolated environment. Existing production ALL policies intentionally block this proposal.
-- No coordinates, records, grants, or policies are changed by this proposal.
BEGIN;
DO $gis_realtime$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='swine_records' AND c.relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='swine_records'
      AND cmd='SELECT' AND roles && ARRAY['authenticated','public']::name[]
  ) OR EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='swine_records'
      AND cmd='ALL' AND roles && ARRAY['authenticated','public']::name[]
  ) THEN
    RAISE EXCEPTION 'Review and verify operation-specific role policies before enabling GIS Realtime.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'Supabase Realtime publication is not configured.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
      AND schemaname='public' AND tablename='swine_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.swine_records;
  END IF;
END $gis_realtime$;
COMMIT;
