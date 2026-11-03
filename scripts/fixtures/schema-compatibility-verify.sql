DO $$
BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND (table_name,column_name) IN (('issued_certificates','control_number'),('media_files','file_url'),('messages','sender_id'),('registry_schema','field_key')) AND is_nullable='YES' AND column_default IS NULL) <> 4 THEN
   RAISE EXCEPTION 'New columns must be nullable with no defaults';
 END IF;
 IF EXISTS (
  SELECT 1 FROM public._test_before b JOIN (
   SELECT 'issued_certificates' AS tbl,to_jsonb(r)-'control_number' AS document FROM public.issued_certificates r
   UNION ALL SELECT 'media_files',to_jsonb(r)-'file_url' FROM public.media_files r
   UNION ALL SELECT 'messages',to_jsonb(r)-'sender_id' FROM public.messages r
   UNION ALL SELECT 'registry_schema',to_jsonb(r)-'field_key' FROM public.registry_schema r
  ) a USING(tbl) WHERE a.document IS DISTINCT FROM b.document
 ) THEN RAISE EXCEPTION 'Original values changed'; END IF;
 IF (SELECT count(*) FROM public.issued_certificates)<>1 OR (SELECT count(*) FROM public.media_files)<>1 OR (SELECT count(*) FROM public.messages)<>1 OR (SELECT count(*) FROM public.registry_schema)<>1 THEN RAISE EXCEPTION 'Original row counts changed'; END IF;
 IF EXISTS (SELECT oid,definition FROM public._test_constraints EXCEPT SELECT oid,pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace) THEN RAISE EXCEPTION 'Existing constraints or foreign keys changed'; END IF;
 IF EXISTS (SELECT * FROM public._test_policies EXCEPT SELECT * FROM pg_policies WHERE schemaname='public') OR EXISTS (SELECT * FROM pg_policies WHERE schemaname='public' EXCEPT SELECT * FROM public._test_policies) THEN RAISE EXCEPTION 'RLS policies changed'; END IF;
 IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='public.messages'::regclass) THEN RAISE EXCEPTION 'RLS flags changed'; END IF;
 IF EXISTS (SELECT * FROM public._test_grants EXCEPT SELECT * FROM information_schema.role_table_grants WHERE table_schema='public') THEN RAISE EXCEPTION 'Original table grants changed'; END IF;
 IF has_column_privilege('schema_demo_reader','public.media_files','file_url','SELECT') THEN RAISE EXCEPTION 'New column unexpectedly granted to column-scoped reader'; END IF;
 IF NOT has_column_privilege('schema_demo_reader','public.media_files','id','SELECT') THEN RAISE EXCEPTION 'Original column grant changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.issued_certificates WHERE control_number IS NOT NULL) OR EXISTS(SELECT 1 FROM public.messages WHERE sender_id IS NOT NULL) THEN RAISE EXCEPTION 'Proposal must not invent historical values'; END IF;
END $$;
SELECT 'PASS: rerunnable nullable additions preserve rows, foreign keys, grants and RLS' AS result;

SET ROLE schema_demo_reader;
SELECT count(*) AS visible_message_rows_must_be_zero FROM public.messages;
RESET ROLE;
