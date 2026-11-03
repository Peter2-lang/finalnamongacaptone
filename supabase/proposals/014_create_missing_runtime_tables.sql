-- REVIEW ONLY. Apply after owner inventory confirms these names are genuinely absent.
-- Existing tables, columns, rows, grants, FKs and policies are never changed.
-- New tables are empty and DENY BY DEFAULT. A separately reviewed access policy
-- for the intended backend role is required before production writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $migration$
DECLARE item record; role_name text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('issued_certificates',$ddl$CREATE TABLE public.issued_certificates (
      id text PRIMARY KEY, control_number text NOT NULL, swine_id text,
      farmer_name text NOT NULL, barangay text NOT NULL, issue_date text NOT NULL,
      purpose text NOT NULL, destination text, inspected_by text NOT NULL,
      qr_payload text, valid_until text, status text NOT NULL DEFAULT 'VALID',
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now()
    )$ddl$),
    ('messages',$ddl$CREATE TABLE public.messages (
      id text PRIMARY KEY, sender_id text NOT NULL, sender_name text NOT NULL,
      sender_role text NOT NULL DEFAULT 'focal', receiver_id text, receiver_role text,
      barangay text, text text NOT NULL, attachments jsonb, is_read boolean NOT NULL DEFAULT false,
      created_at timestamptz DEFAULT now()
    )$ddl$),
    ('media_files',$ddl$CREATE TABLE public.media_files (
      id text PRIMARY KEY, file_name text NOT NULL, file_path text, file_url text NOT NULL,
      mime_type text, file_size integer, category text NOT NULL DEFAULT 'OTHER',
      alt_text text, uploaded_by text, created_at timestamptz DEFAULT now()
    )$ddl$),
    ('registry_schema',$ddl$CREATE TABLE public.registry_schema (
      id text PRIMARY KEY, field_key text NOT NULL, label text NOT NULL,
      field_type text NOT NULL DEFAULT 'text', required boolean NOT NULL DEFAULT false,
      visible boolean NOT NULL DEFAULT true, options jsonb, field_order integer NOT NULL DEFAULT 0,
      section_id text, section_title text, help_text text, placeholder text, default_value text,
      is_fixed boolean DEFAULT false, fixed_value text, is_auto_generated boolean DEFAULT false,
      auto_gen_type text, auto_gen_pattern text, auto_gen_prefix text,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    )$ddl$),
    ('legal_documents',$ddl$CREATE TABLE public.legal_documents (
      id text PRIMARY KEY, document jsonb NOT NULL CHECK (jsonb_typeof(document)='object'),
      updated_at timestamptz NOT NULL DEFAULT now()
    )$ddl$),
    ('legal_document_audit_logs',$ddl$CREATE TABLE public.legal_document_audit_logs (
      id uuid PRIMARY KEY, document_id text NOT NULL, document_title text NOT NULL,
      action text NOT NULL CHECK (action IN ('create','update','archive','restore','delete','import')),
      actor_id text NOT NULL, actor_name text NOT NULL, actor_role text NOT NULL,
      details text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )$ddl$)
  ) AS definitions(table_name,ddl)
  LOOP
    IF to_regclass(format('public.%I',item.table_name)) IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=to_regclass(format('public.%I',item.table_name)) AND relkind IN ('r','p')) THEN
        RAISE EXCEPTION 'Existing public.% is not a table; inspect it instead of replacing it.',item.table_name;
      END IF;
      CONTINUE;
    END IF;
    EXECUTE item.ddl;
    IF item.table_name='legal_document_audit_logs' THEN
      CREATE INDEX legal_document_audit_document_idx ON public.legal_document_audit_logs(document_id,created_at DESC);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',item.table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',item.table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',item.table_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
END $migration$;
COMMIT;
