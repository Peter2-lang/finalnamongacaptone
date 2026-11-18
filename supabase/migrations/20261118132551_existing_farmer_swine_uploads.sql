-- Provision the buckets already used by the registry's swine upload service.
INSERT INTO storage.buckets (id, name, public)
VALUES ('landing-page-media', 'landing-page-media', true), ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE FUNCTION registry_internal.can_upload_swine_attachment(target_barangay text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS profile
    JOIN public.barangays AS barangay ON lower(barangay.name) = lower(target_barangay)
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.active AND profile.is_active AND profile.status = 'active'
      AND (
        profile.role = 'super_admin'
        OR (profile.role = 'admin' AND (
          NULLIF(btrim(profile.assigned_barangay), '') IS NULL
          OR lower(btrim(profile.assigned_barangay)) = lower(barangay.name)
        ))
        OR (profile.role = 'focal' AND lower(btrim(profile.assigned_barangay)) = lower(barangay.name))
      )
  );
$$;

REVOKE ALL ON FUNCTION registry_internal.can_upload_swine_attachment(text) FROM PUBLIC;
GRANT USAGE ON SCHEMA registry_internal TO authenticated;
GRANT EXECUTE ON FUNCTION registry_internal.can_upload_swine_attachment(text) TO authenticated;

CREATE POLICY registry_swine_attachment_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  (storage.foldername(name))[1] = 'barangays'
  AND (storage.foldername(name))[3] = 'swine'
  AND (storage.foldername(name))[4] ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  AND registry_internal.can_upload_swine_attachment((storage.foldername(name))[2])
  AND (
    (bucket_id = 'landing-page-media'
      AND (cardinality(storage.foldername(name)) = 4 OR
           (cardinality(storage.foldername(name)) = 5 AND (storage.foldername(name))[5] = 'images'))
      AND lower(storage.extension(name)) IN ('jpg', 'png', 'webp', 'gif'))
    OR (bucket_id = 'documents' AND cardinality(storage.foldername(name)) = 5
      AND (storage.foldername(name))[5] = 'documents'
      AND lower(storage.extension(name)) IN ('pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'))
  )
);

CREATE POLICY registry_swine_attachment_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('landing-page-media', 'documents')
  AND (storage.foldername(name))[1] = 'barangays'
  AND (storage.foldername(name))[3] = 'swine'
  AND registry_internal.can_upload_swine_attachment((storage.foldername(name))[2])
);

CREATE POLICY registry_swine_attachment_owner_delete ON storage.objects FOR DELETE TO authenticated
USING (
  owner_id = (SELECT auth.uid())::text
  AND bucket_id IN ('landing-page-media', 'documents')
  AND (storage.foldername(name))[1] = 'barangays'
  AND (storage.foldername(name))[3] = 'swine'
  AND registry_internal.can_upload_swine_attachment((storage.foldername(name))[2])
);

-- Use the existing registry document metadata schema and scope these policies to swine.
CREATE TABLE IF NOT EXISTS public.uploaded_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id uuid NOT NULL REFERENCES public.barangays(id) ON DELETE RESTRICT,
  related_module text NOT NULL,
  related_record_id text,
  original_filename text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'documents',
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  uploader_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_uploaded_documents_barangay ON public.uploaded_documents(barangay_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_module_record ON public.uploaded_documents(related_module, related_record_id);
ALTER TABLE public.uploaded_documents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.uploaded_documents TO authenticated;

CREATE POLICY registry_swine_document_metadata_select ON public.uploaded_documents FOR SELECT TO authenticated
USING (
  related_module = 'swine' AND storage_bucket = 'documents'
  AND registry_internal.can_upload_swine_attachment((storage.foldername(storage_path))[2])
);

CREATE POLICY registry_swine_document_metadata_insert ON public.uploaded_documents FOR INSERT TO authenticated
WITH CHECK (
  uploader_id = (SELECT auth.uid()) AND related_module = 'swine' AND storage_bucket = 'documents'
  AND (storage.foldername(storage_path))[1] = 'barangays'
  AND (storage.foldername(storage_path))[3] = 'swine'
  AND (storage.foldername(storage_path))[4] = related_record_id
  AND (storage.foldername(storage_path))[5] = 'documents'
  AND EXISTS (SELECT 1 FROM public.barangays AS b
    WHERE b.id = barangay_id AND lower(b.name) = lower((storage.foldername(storage_path))[2]))
  AND registry_internal.can_upload_swine_attachment((storage.foldername(storage_path))[2])
);

CREATE POLICY registry_swine_document_metadata_owner_delete ON public.uploaded_documents FOR DELETE TO authenticated
USING (
  uploader_id = (SELECT auth.uid()) AND related_module = 'swine' AND storage_bucket = 'documents'
  AND registry_internal.can_upload_swine_attachment((storage.foldername(storage_path))[2])
);
