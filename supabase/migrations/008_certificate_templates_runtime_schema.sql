BEGIN;

CREATE TABLE IF NOT EXISTS public.certificate_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barangay_id UUID REFERENCES public.barangays(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  template_body TEXT NOT NULL,
  css_styles JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS barangay_id UUID REFERENCES public.barangays(id) ON DELETE RESTRICT;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS template_body TEXT;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS css_styles JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS template_data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.certificate_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.certificate_templates ALTER COLUMN barangay_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS certificate_templates_code_key
  ON public.certificate_templates(code);
CREATE INDEX IF NOT EXISTS certificate_templates_barangay_id_idx
  ON public.certificate_templates(barangay_id);

UPDATE public.certificate_templates ct
SET barangay_id = b.id
FROM public.barangays b
WHERE ct.barangay_id IS NULL
  AND lower(b.name) = lower(ct.template_data->>'barangay')
  AND lower(ct.template_data->>'barangay') <> 'all';

ALTER TABLE public.certificate_templates ENABLE ROW LEVEL SECURITY;

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
