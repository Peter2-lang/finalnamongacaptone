BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('landing-page-media', 'landing-page-media', true),
  ('certificates', 'certificates', false),
  ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS app_media_select ON storage.objects;
DROP POLICY IF EXISTS app_media_insert_scope ON storage.objects;
DROP POLICY IF EXISTS app_media_update_scope ON storage.objects;
DROP POLICY IF EXISTS app_media_delete_scope ON storage.objects;
DROP POLICY IF EXISTS certificates_select_scope ON storage.objects;
DROP POLICY IF EXISTS certificates_insert_scope ON storage.objects;
DROP POLICY IF EXISTS certificates_update_scope ON storage.objects;
DROP POLICY IF EXISTS certificates_delete_scope ON storage.objects;
DROP POLICY IF EXISTS documents_select_scope ON storage.objects;
DROP POLICY IF EXISTS documents_insert_scope ON storage.objects;
DROP POLICY IF EXISTS documents_update_scope ON storage.objects;
DROP POLICY IF EXISTS documents_delete_scope ON storage.objects;

CREATE POLICY app_media_select
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'landing-page-media');

CREATE POLICY app_media_insert_scope
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'landing-page-media'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

CREATE POLICY app_media_update_scope
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'landing-page-media'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  )
  WITH CHECK (
    bucket_id = 'landing-page-media'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

CREATE POLICY app_media_delete_scope
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'landing-page-media'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

CREATE POLICY certificates_select_scope
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'certificates'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
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
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
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
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  )
  WITH CHECK (
    bucket_id = 'certificates'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
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
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

CREATE POLICY documents_select_scope
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

CREATE POLICY documents_insert_scope
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

CREATE POLICY documents_update_scope
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

CREATE POLICY documents_delete_scope
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      public.is_app_admin()
      OR (
        (storage.foldername(name))[1] = 'barangays'
        AND lower((storage.foldername(name))[2]) = lower(COALESCE((
          SELECT assigned_barangay
          FROM public.users
          WHERE auth_user_id = auth.uid() AND active = true
        ), ''))
      )
    )
  );

COMMIT;
