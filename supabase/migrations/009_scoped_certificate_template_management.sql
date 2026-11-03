BEGIN;

DROP POLICY IF EXISTS certificate_templates_focal_insert_assigned ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_focal_update_assigned ON public.certificate_templates;

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

COMMIT;