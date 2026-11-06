BEGIN;

DROP POLICY IF EXISTS certificate_templates_focal_insert_assigned ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_focal_update_assigned ON public.certificate_templates;
DROP POLICY IF EXISTS certificate_templates_focal_delete_assigned ON public.certificate_templates;

COMMIT;
