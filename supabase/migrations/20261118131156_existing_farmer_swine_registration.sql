-- Restrict this write path to the registry backend. Existing API roles and policies stay in place.
CREATE ROLE registry_farmer_swine_writer NOLOGIN NOBYPASSRLS;
GRANT registry_farmer_swine_writer TO postgres;
GRANT USAGE ON SCHEMA public TO registry_farmer_swine_writer;
GRANT INSERT ON public.swine_records TO registry_farmer_swine_writer;

CREATE SCHEMA registry_internal;
REVOKE ALL ON SCHEMA registry_internal FROM PUBLIC;
GRANT USAGE ON SCHEMA registry_internal TO registry_farmer_swine_writer;

CREATE FUNCTION registry_internal.can_register_farmer_swine(target_farmer uuid, target_barangay uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS profile
    JOIN public.farmers AS farmer ON farmer.id = target_farmer
    JOIN public.barangays AS barangay ON barangay.id = farmer.barangay_id
    WHERE profile.auth_user_id = (SELECT auth.uid())
      AND profile.active AND profile.is_active AND profile.status = 'active'
      AND farmer.is_active AND NOT farmer.is_archived
      AND barangay.id = target_barangay
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

REVOKE ALL ON FUNCTION registry_internal.can_register_farmer_swine(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registry_internal.can_register_farmer_swine(uuid, uuid) TO registry_farmer_swine_writer;

CREATE POLICY swine_records_existing_farmer_registration
  ON public.swine_records FOR INSERT TO registry_farmer_swine_writer
  WITH CHECK (registry_internal.can_register_farmer_swine(farmer_id, barangay_id));
