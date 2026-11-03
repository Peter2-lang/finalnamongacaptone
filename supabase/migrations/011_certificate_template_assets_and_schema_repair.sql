BEGIN;

ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS template_data JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.certificate_templates
SET template_data = '{}'::jsonb
WHERE template_data IS NULL;

ALTER TABLE public.certificate_templates
  ALTER COLUMN template_data SET DEFAULT '{}'::jsonb,
  ALTER COLUMN template_data SET NOT NULL;

ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certificate_templates_select_authenticated ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_select_profile_scope ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_manage_super_admin ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_manage_admin ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_focal_insert_assigned ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_focal_update_assigned ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_focal_delete_assigned ON public.certificate_templates;

CREATE POLICY certificate_templates_select_profile_scope
  ON public.certificate_templates FOR SELECT TO authenticated
  USING (
    public.is_app_admin()
    OR barangay_id IS NULL
    OR (
      public.current_app_role() = 'focal'
      AND public.user_can_access_barangay(barangay_id)
    )
  );

CREATE POLICY certificate_templates_manage_admin
  ON public.certificate_templates FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE POLICY certificate_templates_focal_insert_assigned
  ON public.certificate_templates FOR INSERT TO authenticated
  WITH CHECK (
    public.current_app_role() = 'focal'
    AND barangay_id IS NOT NULL
    AND public.user_can_access_barangay(barangay_id)
  );

CREATE POLICY certificate_templates_focal_update_assigned
  ON public.certificate_templates FOR UPDATE TO authenticated
  USING (
    public.current_app_role() = 'focal'
    AND barangay_id IS NOT NULL
    AND public.user_can_access_barangay(barangay_id)
  )
  WITH CHECK (
    public.current_app_role() = 'focal'
    AND barangay_id IS NOT NULL
    AND public.user_can_access_barangay(barangay_id)
  );

CREATE POLICY certificate_templates_focal_delete_assigned
  ON public.certificate_templates FOR DELETE TO authenticated
  USING (
    public.current_app_role() = 'focal'
    AND barangay_id IS NOT NULL
    AND public.user_can_access_barangay(barangay_id)
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('certificates', 'certificates', FALSE)
ON CONFLICT (id) DO UPDATE SET public = FALSE;

DROP POLICY IF EXISTS certificates_select_scope ON storage.objects;
DROP POLICY IF EXISTS certificates_insert_scope ON storage.objects;
DROP POLICY IF EXISTS certificates_update_scope ON storage.objects;
DROP POLICY IF EXISTS certificates_delete_scope ON storage.objects;

CREATE POLICY certificates_select_scope
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'certificates'
    AND (
      public.is_app_admin()
      OR (
        public.current_app_role() = 'focal'
        AND (storage.foldername(name))[1] = 'barangays'
        AND EXISTS (
          SELECT 1
          FROM public.barangays b
          WHERE lower(b.name) = lower((storage.foldername(name))[2])
            AND public.user_can_access_barangay(b.id)
        )
      )
    )
  );

CREATE POLICY certificates_insert_scope
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'certificates'
    AND (
      public.is_app_admin()
      OR (
        public.current_app_role() = 'focal'
        AND (storage.foldername(name))[1] = 'barangays'
        AND EXISTS (
          SELECT 1
          FROM public.barangays b
          WHERE lower(b.name) = lower((storage.foldername(name))[2])
            AND public.user_can_access_barangay(b.id)
        )
      )
    )
  );

CREATE POLICY certificates_update_scope
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'certificates'
    AND (
      public.is_app_admin()
      OR (
        public.current_app_role() = 'focal'
        AND (storage.foldername(name))[1] = 'barangays'
        AND EXISTS (
          SELECT 1
          FROM public.barangays b
          WHERE lower(b.name) = lower((storage.foldername(name))[2])
            AND public.user_can_access_barangay(b.id)
        )
      )
    )
  )
  WITH CHECK (
    bucket_id = 'certificates'
    AND (
      public.is_app_admin()
      OR (
        public.current_app_role() = 'focal'
        AND (storage.foldername(name))[1] = 'barangays'
        AND EXISTS (
          SELECT 1
          FROM public.barangays b
          WHERE lower(b.name) = lower((storage.foldername(name))[2])
            AND public.user_can_access_barangay(b.id)
        )
      )
    )
  );

CREATE POLICY certificates_delete_scope
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'certificates'
    AND (
      public.is_app_admin()
      OR (
        public.current_app_role() = 'focal'
        AND (storage.foldername(name))[1] = 'barangays'
        AND EXISTS (
          SELECT 1
          FROM public.barangays b
          WHERE lower(b.name) = lower((storage.foldername(name))[2])
            AND public.user_can_access_barangay(b.id)
        )
      )
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
    AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'certificate_templates'
    )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.certificate_templates;
  END IF;
END $$;

COMMIT;
