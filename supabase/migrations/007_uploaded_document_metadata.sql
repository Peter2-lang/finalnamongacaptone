BEGIN;

CREATE TABLE IF NOT EXISTS public.uploaded_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID NOT NULL REFERENCES public.barangays(id) ON DELETE RESTRICT,
  related_module TEXT NOT NULL,
  related_record_id TEXT,
  original_filename TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'documents',
  storage_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 15728640),
  uploader_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_uploaded_documents_barangay
  ON public.uploaded_documents(barangay_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_module_record
  ON public.uploaded_documents(related_module, related_record_id);

ALTER TABLE public.uploaded_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uploaded_documents_select_scope ON public.uploaded_documents;
DROP POLICY IF EXISTS uploaded_documents_insert_scope ON public.uploaded_documents;
DROP POLICY IF EXISTS uploaded_documents_update_scope ON public.uploaded_documents;
DROP POLICY IF EXISTS uploaded_documents_delete_scope ON public.uploaded_documents;

CREATE POLICY uploaded_documents_select_scope
  ON public.uploaded_documents FOR SELECT TO authenticated
  USING (public.is_app_admin() OR public.user_can_access_barangay(barangay_id));

CREATE POLICY uploaded_documents_insert_scope
  ON public.uploaded_documents FOR INSERT TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND (public.is_app_admin() OR public.user_can_access_barangay(barangay_id))
  );

CREATE POLICY uploaded_documents_update_scope
  ON public.uploaded_documents FOR UPDATE TO authenticated
  USING (
    public.is_app_admin()
    OR (uploader_id = auth.uid() AND public.user_can_access_barangay(barangay_id))
  )
  WITH CHECK (
    public.is_app_admin()
    OR (uploader_id = auth.uid() AND public.user_can_access_barangay(barangay_id))
  );

CREATE POLICY uploaded_documents_delete_scope
  ON public.uploaded_documents FOR DELETE TO authenticated
  USING (
    public.is_app_admin()
    OR (uploader_id = auth.uid() AND public.user_can_access_barangay(barangay_id))
  );

COMMIT;
