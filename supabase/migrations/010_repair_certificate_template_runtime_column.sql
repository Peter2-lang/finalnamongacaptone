BEGIN;

ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS template_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.certificate_templates
  ALTER COLUMN barangay_id DROP NOT NULL;

COMMIT;
