-- REVIEW ONLY. Maintenance window: pause tag-allocating writes during cutover.
-- Never rewinds or otherwise modifies an existing sequence or any registry row.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE maximum numeric; sequence_start numeric; role_name text;
BEGIN
  IF to_regclass('public.swine_tag_seq') IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.swine_tag_seq') AND relkind='S') THEN
      RAISE EXCEPTION 'public.swine_tag_seq exists but is not a sequence.';
    END IF;
    RETURN; -- Existing state is retained, even if an owner must review its high-water mark.
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.swine_records') AND relkind IN ('r','p')) THEN
    RAISE EXCEPTION 'Inspect the existing swine_records table before creating the sequence.';
  END IF;
  LOCK TABLE public.swine_records IN SHARE ROW EXCLUSIVE MODE;
  -- Read known tag sources as JSON to tolerate absent legacy columns/types.
  -- All years share one monotonic sequence; no IDs or row values are rewritten.
  SELECT max(split_part(tag,'-',3)::numeric) INTO maximum
  FROM public.swine_records r
  CROSS JOIN LATERAL (VALUES (to_jsonb(r)->>'pig_id_tag'),(to_jsonb(r)->>'computed_pig_id'),(to_jsonb(r)->>'ear_tag_no'),(to_jsonb(r)->>'original_tag_number'),(to_jsonb(r)->>'ear_tag_number')) tags(tag)
  WHERE tag ~ '^HIN-[0-9]{4}-[0-9]+$';
  sequence_start := greatest(coalesce(maximum,0)+1,1);
  IF sequence_start>=9223372036854775807 THEN RAISE EXCEPTION 'Tag range requires
   manual review; no changes made.'; END IF;
  EXECUTE format('CREATE SEQUENCE public.swine_tag_seq AS bigint START WITH %s INCREMENT BY 1 NO CYCLE',sequence_start);
  COMMENT ON SEQUENCE public.swine_tag_seq IS 'hinunangan-reviewed:202611030003';
  REVOKE ALL ON SEQUENCE public.swine_tag_seq FROM PUBLIC;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.swine_tag_seq FROM %I',role_name);
    END IF;
  END LOOP;
END $migration$;
COMMIT;
