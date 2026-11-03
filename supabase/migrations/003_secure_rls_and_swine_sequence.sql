BEGIN;

-- ============================================================================
-- 003_secure_rls_and_swine_sequence.sql
-- 1. Create atomic PostgreSQL sequence for concurrency-safe swine tag IDs
-- 2. Enforce strict, least-privilege Row Level Security across all tables
-- 3. Block anonymous (anon key) access to sensitive tables
-- ============================================================================

-- 1. Atomic Swine Tag Sequence
CREATE SEQUENCE IF NOT EXISTS public.swine_tag_seq START WITH 1 INCREMENT BY 1;

-- 2. Swine Records Table RLS
ALTER TABLE public.swine_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow server full access to swine_records" ON public.swine_records;
DROP POLICY IF EXISTS swine_records_all_open ON public.swine_records;
DROP POLICY IF EXISTS swine_records_service_role ON public.swine_records;
DROP POLICY IF EXISTS swine_records_select_scope ON public.swine_records;
DROP POLICY IF EXISTS swine_records_insert_scope ON public.swine_records;
DROP POLICY IF EXISTS swine_records_update_scope ON public.swine_records;
DROP POLICY IF EXISTS swine_records_delete_scope ON public.swine_records;

-- Backend server / service_role has complete access
CREATE POLICY swine_records_service_role
  ON public.swine_records FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated Users: Select Scoped
CREATE POLICY swine_records_select_scope
  ON public.swine_records FOR SELECT TO authenticated
  USING (
    public.is_app_admin()
    OR (public.current_app_role() = 'agent' AND ready_to_sell = TRUE)
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );

-- Authenticated Users: Insert Scoped (Admins or Focal Persons for their assigned barangay)
CREATE POLICY swine_records_insert_scope
  ON public.swine_records FOR INSERT TO authenticated
  WITH CHECK (
    public.is_app_admin()
    OR (
      public.current_app_role() = 'focal'
      AND lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
    )
  );

-- Authenticated Users: Update Scoped
CREATE POLICY swine_records_update_scope
  ON public.swine_records FOR UPDATE TO authenticated
  USING (
    public.is_app_admin()
    OR (
      public.current_app_role() = 'focal'
      AND lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
    )
  )
  WITH CHECK (
    public.is_app_admin()
    OR (
      public.current_app_role() = 'focal'
      AND lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
    )
  );

-- Authenticated Users: Delete (Admin only)
CREATE POLICY swine_records_delete_scope
  ON public.swine_records FOR DELETE TO authenticated
  USING (public.is_app_admin());


-- 3. Messages Table RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow server full access to messages" ON public.messages;
DROP POLICY IF EXISTS messages_service_role ON public.messages;
DROP POLICY IF EXISTS messages_select_scope ON public.messages;
DROP POLICY IF EXISTS messages_insert_scope ON public.messages;
DROP POLICY IF EXISTS messages_update_scope ON public.messages;
DROP POLICY IF EXISTS messages_delete_scope ON public.messages;

CREATE POLICY messages_service_role
  ON public.messages FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY messages_select_scope
  ON public.messages FOR SELECT TO authenticated
  USING (
    public.is_app_admin()
    OR sender_id = auth.uid()::text
    OR receiver_id = auth.uid()::text
    OR barangay IS NULL
    OR lower(barangay) = 'all'
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );

CREATE POLICY messages_insert_scope
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    public.is_app_admin()
    OR sender_id = auth.uid()::text
  );

CREATE POLICY messages_update_scope
  ON public.messages FOR UPDATE TO authenticated
  USING (
    public.is_app_admin()
    OR receiver_id = auth.uid()::text
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );

CREATE POLICY messages_delete_scope
  ON public.messages FOR DELETE TO authenticated
  USING (
    public.is_app_admin()
    OR sender_id = auth.uid()::text
  );


-- 4. Media Files Table RLS
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow server full access to media_files" ON public.media_files;
DROP POLICY IF EXISTS media_files_service_role ON public.media_files;
DROP POLICY IF EXISTS media_files_select_scope ON public.media_files;
DROP POLICY IF EXISTS media_files_insert_scope ON public.media_files;
DROP POLICY IF EXISTS media_files_delete_scope ON public.media_files;

CREATE POLICY media_files_service_role
  ON public.media_files FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY media_files_select_scope
  ON public.media_files FOR SELECT TO authenticated
  USING (true);

CREATE POLICY media_files_insert_scope
  ON public.media_files FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY media_files_delete_scope
  ON public.media_files FOR DELETE TO authenticated
  USING (public.is_app_admin());


-- 5. Audit Logs Table RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow server full access to audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_service_role ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_select_scope ON public.audit_logs;

CREATE POLICY audit_logs_service_role
  ON public.audit_logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY audit_logs_select_scope
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_app_admin());


-- 6. Registry Schema Table RLS
ALTER TABLE public.registry_schema ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow server full access to registry_schema" ON public.registry_schema;
DROP POLICY IF EXISTS registry_schema_service_role ON public.registry_schema;
DROP POLICY IF EXISTS registry_schema_select_scope ON public.registry_schema;
DROP POLICY IF EXISTS registry_schema_manage_admin ON public.registry_schema;

CREATE POLICY registry_schema_service_role
  ON public.registry_schema FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY registry_schema_select_scope
  ON public.registry_schema FOR SELECT TO authenticated
  USING (true);

CREATE POLICY registry_schema_manage_admin
  ON public.registry_schema FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

COMMIT;

