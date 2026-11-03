-- OWNER-REVIEW diagnostic. Aggregate counts only; respects the executing role's RLS.
-- Incomplete visibility cannot prove data compatibility. No casts to UUID, DDL,
-- ID generation, nextval, setval, or changes to records/roles/policies occur.
BEGIN TRANSACTION READ ONLY;
SELECT c.relname AS table_name,con.conname,con.convalidated,pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' ORDER BY c.relname,con.conname;
DO $audit$
DECLARE item record; total bigint; invalid bigint; orphans bigint; source_table regclass; target_table regclass;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('users','id'),('users','auth_user_id'),('farmers','id'),('farmers','barangay_id'),
    ('swine_records','id'),('swine_records','farmer_id'),('audit_logs','id'),('audit_logs','user_id')
  ) AS targets(table_name,column_name)
  LOOP
    source_table:=to_regclass(format('public.%I',item.table_name));
    IF source_table IS NULL OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=source_table AND attname=item.column_name AND attnum>0 AND NOT attisdropped) THEN
      RAISE NOTICE 'identifier audit: %.% missing; not scanned',item.table_name,item.column_name; CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('SELECT count(*),count(*) FILTER(WHERE %1$I IS NOT NULL AND %1$I::text !~* $1) FROM %2$s',item.column_name,source_table)
        INTO total,invalid USING '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
      RAISE NOTICE 'identifier audit: %',jsonb_build_object('table',item.table_name,'column',item.column_name,'visible_rows',total,'non_uuid_values',invalid);
    EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'identifier audit: %.% inaccessible; review owner visibility',item.table_name,item.column_name;
    END;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('swine_records','farmer_id','public.farmers','id'),
    ('farmers','barangay_id','public.barangays','id'),
    ('users','auth_user_id','auth.users','id')
  ) AS links(table_name,column_name,target_name,target_column)
  LOOP
    source_table:=to_regclass(format('public.%I',item.table_name)); target_table:=to_regclass(item.target_name);
    IF source_table IS NULL OR target_table IS NULL OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=source_table AND attname=item.column_name AND attnum>0 AND NOT attisdropped) THEN CONTINUE; END IF;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s source WHERE source.%I IS NOT NULL AND NOT EXISTS(SELECT 1 FROM %s target WHERE target.%I::text=source.%I::text)',source_table,item.column_name,target_table,item.target_column,item.column_name) INTO orphans;
      RAISE NOTICE 'relationship audit: %',jsonb_build_object('source_table',item.table_name,'source_column',item.column_name,'target',item.target_name,'visible_unmatched',orphans);
    EXCEPTION WHEN insufficient_privilege OR undefined_column THEN RAISE NOTICE 'relationship audit: % requires owner/column review',item.table_name;
    END;
  END LOOP;
END $audit$;
SELECT schemaname,sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,last_value
FROM pg_sequences WHERE schemaname='public' AND sequencename='swine_tag_seq';
COMMIT;
