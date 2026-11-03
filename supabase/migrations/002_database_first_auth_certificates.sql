BEGIN;

-- Add profile/auth metadata to the existing application users table. Legacy
-- profile fields remain in place; credential data is never copied.
DO $$
BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS uid TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS full_name TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'focal';
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS assigned_barangay TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS assigned_barangay_id UUID;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_number TEXT;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    EXECUTE 'UPDATE public.users SET uid = COALESCE(uid, id::text) WHERE uid IS NULL';
    EXECUTE 'UPDATE public.users SET name = COALESCE(name, full_name, email) WHERE name IS NULL';
    EXECUTE $backfill$
      UPDATE public.users u SET role = r.code
      FROM public.roles r
      WHERE u.role_id = r.id AND (u.role IS NULL OR u.role = 'focal')
    $backfill$;
    EXECUTE $barangay$
      UPDATE public.users u SET assigned_barangay = b.name
      FROM public.barangays b
      WHERE u.assigned_barangay_id = b.id AND u.assigned_barangay IS NULL
    $barangay$;
    EXECUTE 'UPDATE public.users SET phone = COALESCE(phone, phone_number) WHERE phone IS NULL';
    EXECUTE 'UPDATE public.users SET active = COALESCE(active, is_active, TRUE)';
    EXECUTE $permission$
      UPDATE public.users u
      SET permissions = COALESCE((
        SELECT jsonb_agg(p.code ORDER BY p.code)
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = u.role_id
      ), '[]'::jsonb)
      WHERE permissions = '[]'::jsonb AND u.role_id IS NOT NULL
    $permission$;

    -- Keep a password-free recovery copy of legacy profile fields before
    -- removing the legacy credential column. Users must reset/invite through Auth.
    CREATE TABLE IF NOT EXISTS public.legacy_user_profiles (
      legacy_uid TEXT PRIMARY KEY,
      email TEXT,
      full_name TEXT,
      role TEXT NOT NULL DEFAULT 'focal',
      assigned_barangay TEXT,
      phone TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      invited_at TIMESTAMPTZ
    );

    EXECUTE $copy$
      INSERT INTO public.legacy_user_profiles
        (legacy_uid, email, full_name, role, assigned_barangay, phone, active, permissions)
      SELECT
        COALESCE(uid, id::text), email, COALESCE(name, full_name),
        COALESCE(role, 'focal'), assigned_barangay, phone,
        COALESCE(active, is_active, TRUE), COALESCE(permissions, '[]'::jsonb)
      FROM public.users
      ON CONFLICT (legacy_uid) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        assigned_barangay = EXCLUDED.assigned_barangay,
        phone = EXCLUDED.phone,
        active = EXCLUDED.active,
        permissions = EXCLUDED.permissions
    $copy$;

    ALTER TABLE public.users DROP COLUMN IF EXISTS password;
    CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique ON public.users(auth_user_id) WHERE auth_user_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS users_uid_unique ON public.users(uid);
  END IF;
END $$;

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

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT COALESCE(public.current_app_role() = 'super_admin', FALSE); $$;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$ SELECT COALESCE(public.current_app_role() IN ('admin', 'super_admin'), FALSE); $$;

CREATE OR REPLACE FUNCTION public.user_can_access_barangay(p_barangay_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.active = TRUE
      AND (
        u.assigned_barangay_id = p_barangay_id
        OR lower(u.assigned_barangay) = lower((SELECT b.name FROM public.barangays b WHERE b.id = p_barangay_id))
      )
  );
$$;

DROP POLICY IF EXISTS users_super_admin_all ON public.users;
DROP POLICY IF EXISTS users_self_or_same_barangay_scope ON public.users;
DROP POLICY IF EXISTS users_select_self_or_admin ON public.users;
DROP POLICY IF EXISTS users_manage_admin ON public.users;
CREATE POLICY users_select_self_or_admin
ON public.users FOR SELECT TO authenticated
USING (auth_user_id = auth.uid() OR public.is_app_admin());
CREATE POLICY users_manage_admin
ON public.users FOR ALL TO authenticated
USING (public.is_app_admin())
WITH CHECK (public.is_app_admin());

DROP POLICY IF EXISTS system_settings_select_authenticated ON public.system_settings;
DROP POLICY IF EXISTS system_settings_manage_super_admin ON public.system_settings;
CREATE POLICY system_settings_select_admin
ON public.system_settings FOR SELECT TO authenticated
USING (public.is_app_admin());
CREATE POLICY system_settings_manage_admin
ON public.system_settings FOR ALL TO authenticated
USING (public.is_app_admin())
WITH CHECK (public.is_app_admin());

-- The runtime certificate table is initialized by the server or this migration. Its snapshot
-- preserves the complete printable document independently of later templates.
CREATE TABLE IF NOT EXISTS public.issued_certificates (
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
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.issued_certificates ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.issued_certificates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_issued_certificates_barangay ON public.issued_certificates(barangay);
CREATE INDEX IF NOT EXISTS idx_issued_certificates_control_number ON public.issued_certificates(control_number);

DROP POLICY IF EXISTS issued_certificates_select_scope ON public.issued_certificates;
DROP POLICY IF EXISTS issued_certificates_insert_scope ON public.issued_certificates;
DROP POLICY IF EXISTS issued_certificates_update_admin ON public.issued_certificates;
DROP POLICY IF EXISTS issued_certificates_update_scope ON public.issued_certificates;
DROP POLICY IF EXISTS issued_certificates_delete_scope ON public.issued_certificates;

CREATE POLICY issued_certificates_select_scope
  ON public.issued_certificates FOR SELECT TO authenticated
  USING (public.is_app_admin() OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), '')));

CREATE POLICY issued_certificates_insert_scope
  ON public.issued_certificates FOR INSERT TO authenticated
  WITH CHECK (public.is_app_admin() OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), '')));

CREATE POLICY issued_certificates_update_scope
  ON public.issued_certificates FOR UPDATE TO authenticated
  USING (public.is_app_admin() OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), '')))
  WITH CHECK (public.is_app_admin() OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), '')));

CREATE POLICY issued_certificates_delete_scope
  ON public.issued_certificates FOR DELETE TO authenticated
  USING (public.is_app_admin() OR lower(barangay) = lower(COALESCE((SELECT assigned_barangay FROM public.users WHERE auth_user_id = auth.uid() AND active = TRUE), '')));

-- Reuse the existing certificate_templates table and retain the full editor
-- payload so templates remain reproducible across app versions and devices.
DO $$
BEGIN
  IF to_regclass('public.certificate_templates') IS NOT NULL THEN
    ALTER TABLE public.certificate_templates ALTER COLUMN barangay_id DROP NOT NULL;
    ALTER TABLE public.certificate_templates ADD COLUMN IF NOT EXISTS template_data JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP POLICY IF EXISTS certificate_templates_select_authenticated ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_manage_super_admin ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_select_profile_scope ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_manage_admin ON public.certificate_templates;
CREATE POLICY certificate_templates_select_profile_scope
ON public.certificate_templates FOR SELECT TO authenticated
USING (public.is_app_admin() OR barangay_id IS NULL OR public.user_can_access_barangay(barangay_id));
CREATE POLICY certificate_templates_manage_admin
ON public.certificate_templates FOR ALL TO authenticated
USING (public.is_app_admin())
WITH CHECK (public.is_app_admin());

COMMIT;
