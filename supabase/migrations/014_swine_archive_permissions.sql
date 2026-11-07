BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_user_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'permissions'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'assigned_barangay'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'active'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_active'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'swine_records' AND column_name = 'is_archived'
  ) THEN
    RAISE EXCEPTION 'Swine archive permission migration requires the existing users RBAC and swine_records.is_archived columns.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.can_archive_swine_record(target_barangay text, restoring boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND COALESCE(u.active, u.is_active, false) = true
      AND (
        u.role IN ('super_admin', 'admin')
        OR (
          u.role = 'focal'
          AND lower(COALESCE(u.assigned_barangay, '')) = lower(COALESCE(target_barangay, ''))
          AND u.permissions @> jsonb_build_array(
            CASE WHEN restoring THEN 'swine_records.restore' ELSE 'swine_records.archive' END
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_permanently_delete_swine_record()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND COALESCE(u.active, u.is_active, false) = true
      AND (
        u.role = 'super_admin'
        OR (
          u.role = 'admin'
          AND u.permissions @> '["swine_records.permanent_delete"]'::jsonb
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_swine_archive_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_archived IS DISTINCT FROM NEW.is_archived
     AND auth.uid() IS NOT NULL
     AND NOT public.can_archive_swine_record(OLD.barangay, NOT NEW.is_archived) THEN
    RAISE EXCEPTION 'Not authorized to archive or restore this swine record.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS swine_archive_permission_guard ON public.swine_records;
CREATE TRIGGER swine_archive_permission_guard
  BEFORE UPDATE OF is_archived ON public.swine_records
  FOR EACH ROW EXECUTE FUNCTION public.enforce_swine_archive_permissions();

DROP POLICY IF EXISTS swine_records_delete_scope ON public.swine_records;
CREATE POLICY swine_records_delete_scope
  ON public.swine_records FOR DELETE TO authenticated
  USING (
    is_archived = true
    AND public.can_permanently_delete_swine_record()
  );

COMMIT;
