-- ============================================================================
-- HINUNANGAN SWINE REGISTRY & TRACEABILITY SYSTEM
-- PostgreSQL Schema for Supabase Deployment
-- ============================================================================

-- 1. Enable UUID extension if desired
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Users Table (System Roles: admin, focal, public)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'focal',
  assigned_barangay TEXT,
  phone TEXT,
  auth_user_id UUID UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sequence for concurrency-safe atomic Swine Tag IDs (HIN-YYYY-XXXX)
CREATE SEQUENCE IF NOT EXISTS swine_tag_seq START WITH 1 INCREMENT BY 1;

-- 3. Swine Records Table (Registry & Biosecurity Tracking)
CREATE TABLE IF NOT EXISTS swine_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_pig_id TEXT NOT NULL,
  pig_id_tag TEXT,
  ear_tag_no TEXT,
  farmer_name TEXT NOT NULL,
  farm_name TEXT,
  farmer_contact TEXT,
  barangay TEXT NOT NULL,
  birth_date TEXT,
  age_days INTEGER,
  age_months TEXT,
  estimated_weight_kg TEXT,
  actual_weight_kg TEXT,
  swine_type TEXT NOT NULL DEFAULT 'FATTER_GROWER',
  farm_scale TEXT NOT NULL DEFAULT 'BACKYARD',
  asf_zone TEXT NOT NULL DEFAULT 'RED',
  biosecurity_warning BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'HEALTHY',
  ready_to_sell BOOLEAN NOT NULL DEFAULT FALSE,
  price_estimate TEXT,
  photo_url TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  registered_at TEXT NOT NULL,
  custom_fields JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Issued Certificates Table (Official Movement / Transport Permits)
CREATE TABLE IF NOT EXISTS issued_certificates (
  id TEXT PRIMARY KEY,
  control_number TEXT NOT NULL,
  swine_id TEXT,
  farmer_name TEXT NOT NULL,
  barangay TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  purpose TEXT NOT NULL,
  destination TEXT,
  inspected_by TEXT NOT NULL,
  qr_payload TEXT,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'VALID',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Messages Table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'focal',
  receiver_id TEXT,
  receiver_role TEXT,
  barangay TEXT,
  text TEXT NOT NULL,
  attachments JSONB,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Media Files Table
CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_url TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER,
  category TEXT NOT NULL DEFAULT 'OTHER',
  alt_text TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Audit Logs Table (Tamper-evident activity logs)
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  user_id TEXT,
  username TEXT,
  user_role TEXT,
  barangay TEXT,
  details TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Registry Schema Metadata Table (Customized Registry Schema Configuration)
CREATE TABLE IF NOT EXISTS registry_schema (
  id TEXT PRIMARY KEY,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  options JSONB,
  field_order INTEGER NOT NULL DEFAULT 0,
  section_id TEXT,
  section_title TEXT,
  help_text TEXT,
  placeholder TEXT,
  default_value TEXT,
  is_fixed BOOLEAN DEFAULT FALSE,
  fixed_value TEXT,
  is_auto_generated BOOLEAN DEFAULT FALSE,
  auto_gen_type TEXT,
  auto_gen_pattern TEXT,
  auto_gen_prefix TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Performance & Search Indices
CREATE INDEX IF NOT EXISTS idx_swine_barangay ON swine_records(barangay);
CREATE INDEX IF NOT EXISTS idx_swine_status ON swine_records(status);
CREATE INDEX IF NOT EXISTS idx_swine_ready ON swine_records(ready_to_sell);
CREATE INDEX IF NOT EXISTS idx_swine_asf_zone ON swine_records(asf_zone);
CREATE INDEX IF NOT EXISTS idx_certs_barangay ON issued_certificates(barangay);
CREATE INDEX IF NOT EXISTS idx_certs_control ON issued_certificates(control_number);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_category ON media_files(category);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_reg_schema_key ON registry_schema(field_key);
CREATE INDEX IF NOT EXISTS idx_reg_schema_order ON registry_schema(field_order);

-- 11. Row Level Security (RLS) & Access Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE swine_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE issued_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_schema ENABLE ROW LEVEL SECURITY;

-- Allow full access for backend server and authorized roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to users' AND tablename = 'users') THEN
    CREATE POLICY "Allow server full access to users" ON users FOR ALL USING (true) WITH CHECK (true);
  END IF;
-- Helper functions for RBAC
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.auth_user_id = auth.uid() AND u.active = TRUE
  LIMIT 1;
$$;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to swine_records' AND tablename = 'swine_records') THEN
    CREATE POLICY "Allow server full access to swine_records" ON swine_records FOR ALL USING (true) WITH CHECK (true);
  END IF;
CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT COALESCE(public.current_app_role() IN ('admin', 'super_admin'), FALSE); $$;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to issued_certificates' AND tablename = 'issued_certificates') THEN
    CREATE POLICY "Allow server full access to issued_certificates" ON issued_certificates FOR ALL USING (true) WITH CHECK (true);
  END IF;
-- 11.1 Users RLS
DROP POLICY IF EXISTS "Allow server full access to users" ON users;
DROP POLICY IF EXISTS users_service_role ON users;
DROP POLICY IF EXISTS users_select_self_or_admin ON users;
DROP POLICY IF EXISTS users_manage_admin ON users;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to messages' AND tablename = 'messages') THEN
    CREATE POLICY "Allow server full access to messages" ON messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
CREATE POLICY users_service_role ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY users_select_self_or_admin ON users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_app_admin());
CREATE POLICY users_manage_admin ON users FOR ALL TO authenticated
  USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to media_files' AND tablename = 'media_files') THEN
    CREATE POLICY "Allow server full access to media_files" ON media_files FOR ALL USING (true) WITH CHECK (true);
  END IF;
-- 11.2 Swine Records RLS
DROP POLICY IF EXISTS "Allow server full access to swine_records" ON swine_records;
DROP POLICY IF EXISTS swine_records_service_role ON swine_records;
DROP POLICY IF EXISTS swine_records_select_scope ON swine_records;
DROP POLICY IF EXISTS swine_records_insert_scope ON swine_records;
DROP POLICY IF EXISTS swine_records_update_scope ON swine_records;
DROP POLICY IF EXISTS swine_records_delete_scope ON swine_records;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to audit_logs' AND tablename = 'audit_logs') THEN
    CREATE POLICY "Allow server full access to audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
CREATE POLICY swine_records_service_role ON swine_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY swine_records_select_scope ON swine_records FOR SELECT TO authenticated
  USING (
    public.is_app_admin()
    OR (public.current_app_role() = 'agent' AND ready_to_sell = TRUE)
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );
CREATE POLICY swine_records_insert_scope ON swine_records FOR INSERT TO authenticated
  WITH CHECK (
    public.is_app_admin()
    OR (
      public.current_app_role() = 'focal'
      AND lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
    )
  );
CREATE POLICY swine_records_update_scope ON swine_records FOR UPDATE TO authenticated
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
CREATE POLICY swine_records_delete_scope ON swine_records FOR DELETE TO authenticated
  USING (public.is_app_admin());

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to system_settings' AND tablename = 'system_settings') THEN
    CREATE POLICY "Allow server full access to system_settings" ON system_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
-- 11.3 Issued Certificates RLS
DROP POLICY IF EXISTS "Allow server full access to issued_certificates" ON issued_certificates;
DROP POLICY IF EXISTS certs_service_role ON issued_certificates;
DROP POLICY IF EXISTS certs_select_scope ON issued_certificates;
DROP POLICY IF EXISTS certs_manage_scope ON issued_certificates;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow server full access to registry_schema' AND tablename = 'registry_schema') THEN
    CREATE POLICY "Allow server full access to registry_schema" ON registry_schema FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
CREATE POLICY certs_service_role ON issued_certificates FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY certs_select_scope ON issued_certificates FOR SELECT TO authenticated
  USING (
    public.is_app_admin()
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );
CREATE POLICY certs_manage_scope ON issued_certificates FOR ALL TO authenticated
  USING (
    public.is_app_admin()
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  )
  WITH CHECK (
    public.is_app_admin()
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );

-- 11.4 Messages RLS
DROP POLICY IF EXISTS "Allow server full access to messages" ON messages;
DROP POLICY IF EXISTS messages_service_role ON messages;
DROP POLICY IF EXISTS messages_select_scope ON messages;
DROP POLICY IF EXISTS messages_insert_scope ON messages;
DROP POLICY IF EXISTS messages_update_scope ON messages;
DROP POLICY IF EXISTS messages_delete_scope ON messages;

CREATE POLICY messages_service_role ON messages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY messages_select_scope ON messages FOR SELECT TO authenticated
  USING (
    public.is_app_admin()
    OR sender_id = auth.uid()::text
    OR receiver_id = auth.uid()::text
    OR barangay IS NULL
    OR lower(barangay) = 'all'
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );
CREATE POLICY messages_insert_scope ON messages FOR INSERT TO authenticated
  WITH CHECK (public.is_app_admin() OR sender_id = auth.uid()::text);
CREATE POLICY messages_update_scope ON messages FOR UPDATE TO authenticated
  USING (
    public.is_app_admin()
    OR receiver_id = auth.uid()::text
    OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), ''))
  );
CREATE POLICY messages_delete_scope ON messages FOR DELETE TO authenticated
  USING (public.is_app_admin() OR sender_id = auth.uid()::text);

-- 11.5 Media Files RLS
DROP POLICY IF EXISTS "Allow server full access to media_files" ON media_files;
DROP POLICY IF EXISTS media_files_service_role ON media_files;
DROP POLICY IF EXISTS media_files_select_scope ON media_files;
DROP POLICY IF EXISTS media_files_insert_scope ON media_files;
DROP POLICY IF EXISTS media_files_delete_scope ON media_files;

CREATE POLICY media_files_service_role ON media_files FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY media_files_select_scope ON media_files FOR SELECT TO authenticated USING (true);
CREATE POLICY media_files_insert_scope ON media_files FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY media_files_delete_scope ON media_files FOR DELETE TO authenticated USING (public.is_app_admin());

-- 11.6 Audit Logs RLS
DROP POLICY IF EXISTS "Allow server full access to audit_logs" ON audit_logs;
DROP POLICY IF EXISTS audit_logs_service_role ON audit_logs;
DROP POLICY IF EXISTS audit_logs_select_scope ON audit_logs;

CREATE POLICY audit_logs_service_role ON audit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY audit_logs_select_scope ON audit_logs FOR SELECT TO authenticated USING (public.is_app_admin());

-- 11.7 System Settings & Registry Schema RLS
DROP POLICY IF EXISTS "Allow server full access to system_settings" ON system_settings;
DROP POLICY IF EXISTS system_settings_service_role ON system_settings;
DROP POLICY IF EXISTS system_settings_select_scope ON system_settings;
DROP POLICY IF EXISTS system_settings_manage_admin ON system_settings;

CREATE POLICY system_settings_service_role ON system_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY system_settings_select_scope ON system_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY system_settings_manage_admin ON system_settings FOR ALL TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS "Allow server full access to registry_schema" ON registry_schema;
DROP POLICY IF EXISTS registry_schema_service_role ON registry_schema;
DROP POLICY IF EXISTS registry_schema_select_scope ON registry_schema;
DROP POLICY IF EXISTS registry_schema_manage_admin ON registry_schema;

CREATE POLICY registry_schema_service_role ON registry_schema FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY registry_schema_select_scope ON registry_schema FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_schema_manage_admin ON registry_schema FOR ALL TO authenticated USING (public.is_app_admin()) WITH CHECK (public.is_app_admin());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION 'Supabase publication supabase_realtime is required for account realtime';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
  END IF;
END $$;

-- ============================================================================
-- End of Supabase Schema Initialization
-- ============================================================================


