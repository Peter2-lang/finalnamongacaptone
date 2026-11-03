BEGIN;

ALTER TABLE public.swine_records
  ADD COLUMN IF NOT EXISTS farmer_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.swine_records'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (farmer_id)%'
  ) THEN
    ALTER TABLE public.swine_records
      ADD CONSTRAINT swine_records_farmer_id_fkey
      FOREIGN KEY (farmer_id) REFERENCES public.farmers(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_swine_records_farmer_id
  ON public.swine_records(farmer_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'swine_records' AND column_name = 'farmer_name'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'swine_records' AND column_name = 'barangay'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'swine_records' AND column_name = 'barangay_id'
  ) THEN
    INSERT INTO public.farmers (
      barangay_id, first_name, middle_name, last_name, farm_name, farm_address,
      contact_number, metadata
    )
    SELECT DISTINCT
      b.id,
      split_part(trim(s.farmer_name), ' ', 1),
      NULLIF(array_to_string((string_to_array(trim(s.farmer_name), ' '))[2:array_length(string_to_array(trim(s.farmer_name), ' '), 1) - 1], ' '), ''),
      CASE
        WHEN array_length(string_to_array(trim(s.farmer_name), ' '), 1) > 1
          THEN (string_to_array(trim(s.farmer_name), ' '))[array_length(string_to_array(trim(s.farmer_name), ' '), 1)]
        ELSE split_part(trim(s.farmer_name), ' ', 1)
      END,
      NULLIF(s.farm_name, ''),
      NULL,
      NULLIF(s.farmer_contact, ''),
      jsonb_build_object('legacy_farmer_name', trim(s.farmer_name))
    FROM public.swine_records s
    JOIN public.barangays b ON lower(b.name) = lower(trim(s.barangay))
    WHERE s.farmer_id IS NULL
      AND NULLIF(trim(s.farmer_name), '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.farmers f
        WHERE f.barangay_id = b.id
          AND (
            (NULLIF(s.farmer_contact, '') IS NOT NULL AND f.contact_number = s.farmer_contact)
            OR lower(concat_ws(' ', f.first_name, f.middle_name, f.last_name)) = lower(trim(s.farmer_name))
          )
      );

    UPDATE public.swine_records s
    SET farmer_id = f.id
    FROM public.barangays b
    JOIN public.farmers f ON f.barangay_id = b.id
    WHERE s.farmer_id IS NULL
      AND lower(b.name) = lower(trim(s.barangay))
      AND (
        (NULLIF(s.farmer_contact, '') IS NOT NULL AND f.contact_number = s.farmer_contact)
        OR lower(concat_ws(' ', f.first_name, f.middle_name, f.last_name)) = lower(trim(s.farmer_name))
        OR lower(f.metadata->>'legacy_farmer_name') = lower(trim(s.farmer_name))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'swine_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.swine_records;
  END IF;
END $$;

COMMIT;
