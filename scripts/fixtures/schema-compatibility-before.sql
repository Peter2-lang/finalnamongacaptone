-- Disposable local PostgreSQL fixture only; deliberately not production DDL.
CREATE ROLE schema_demo_reader NOLOGIN;
CREATE TABLE public.demo_actors (id uuid PRIMARY KEY);
INSERT INTO public.demo_actors VALUES ('00000000-0000-4000-8000-000000000001');
CREATE TABLE public.issued_certificates (id text PRIMARY KEY, certificate_number text NOT NULL, actor_id uuid REFERENCES public.demo_actors(id));
CREATE TABLE public.media_files (id text PRIMARY KEY, url text NOT NULL);
CREATE TABLE public.messages (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.demo_actors(id), body text NOT NULL);
CREATE TABLE public.registry_schema (id text PRIMARY KEY, field_name text NOT NULL);
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY, user_id uuid, barangay_id uuid, action text NOT NULL, table_name text NOT NULL, record_id uuid, old_data jsonb, new_data jsonb, created_at timestamptz DEFAULT now());
INSERT INTO public.issued_certificates VALUES ('cert-1','EXISTING-001','00000000-0000-4000-8000-000000000001');
INSERT INTO public.media_files VALUES ('media-1','https://example.invalid/existing.png');
INSERT INTO public.messages VALUES ('msg-1','00000000-0000-4000-8000-000000000001','Existing private message');
INSERT INTO public.registry_schema VALUES ('field-1','existing_field');
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY messages_fixture_select ON public.messages FOR SELECT TO schema_demo_reader USING (false);
GRANT SELECT ON public.messages TO schema_demo_reader;
GRANT SELECT(id) ON public.media_files TO schema_demo_reader;
CREATE TABLE public._test_before AS
 SELECT 'issued_certificates' AS tbl,to_jsonb(r) AS document FROM public.issued_certificates r
 UNION ALL SELECT 'media_files',to_jsonb(r) FROM public.media_files r
 UNION ALL SELECT 'messages',to_jsonb(r) FROM public.messages r
 UNION ALL SELECT 'registry_schema',to_jsonb(r) FROM public.registry_schema r;
CREATE TABLE public._test_constraints AS SELECT oid, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace;
CREATE TABLE public._test_policies AS SELECT * FROM pg_policies WHERE schemaname='public';
CREATE TABLE public._test_grants AS SELECT * FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('issued_certificates','media_files','messages','registry_schema','audit_logs');
DO $$ BEGIN
  BEGIN
    PERFORM entity FROM public.audit_logs LIMIT 0;
    RAISE EXCEPTION 'Fixture must reproduce legacy audit 42703';
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  PERFORM id,user_id,barangay_id,action,table_name,record_id,old_data,new_data,created_at FROM public.audit_logs LIMIT 0;
END $$;
