-- Read-only full runtime-column gap report, generated from canonical inventory.
-- Returns ONE JSON result containing EVERY detected missing table/column
-- and incompatible type, rather than only the first failing health probe.
-- Does not expose row data, users, role assignments, credentials or settings.
BEGIN TRANSACTION READ ONLY;
WITH required(table_name,column_name,expected_type,required_by,expected_not_null,expected_primary_key,expected_has_default,expected_default) AS (VALUES
  ('audit_logs', 'action', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('audit_logs', 'barangay_id', 'uuid', 'src/db/schema.ts', false, false, false, NULL),
  ('audit_logs', 'created_at', 'timestamp with time zone', 'src/db/schema.ts', false, false, true, 'now()'),
  ('audit_logs', 'id', 'uuid', 'src/db/schema.ts', true, true, true, 'gen_random_uuid()'),
  ('audit_logs', 'new_data', 'jsonb', 'src/db/schema.ts', false, false, false, NULL),
  ('audit_logs', 'old_data', 'jsonb', 'src/db/schema.ts', false, false, false, NULL),
  ('audit_logs', 'record_id', 'uuid', 'src/db/schema.ts', false, false, false, NULL),
  ('audit_logs', 'table_name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('audit_logs', 'user_id', 'uuid', 'src/db/schema.ts', false, false, false, NULL),
  ('barangays', 'code', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('barangays', 'id', 'uuid', 'src/db/schema.ts', true, true, false, NULL),
  ('barangays', 'is_active', 'boolean', 'src/server/app.ts', NULL, NULL, NULL, NULL),
  ('barangays', 'latitude', 'double precision', 'src/server/app.ts', NULL, NULL, NULL, NULL),
  ('barangays', 'longitude', 'double precision', 'src/server/app.ts', NULL, NULL, NULL, NULL),
  ('barangays', 'metadata', 'jsonb', 'src/server/app.ts', NULL, NULL, NULL, NULL),
  ('barangays', 'municipality', 'text', 'src/server/app.ts', NULL, NULL, NULL, NULL),
  ('barangays', 'name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('barangays', 'updated_at', 'timestamp with time zone', 'src/server/app.ts', NULL, NULL, NULL, NULL),
  ('certificate_signatories', 'display_order', 'integer', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_signatories', 'signatory_id', 'uuid', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_signatories', 'template_id', 'uuid', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'barangay_id', 'uuid', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'code', 'text', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'created_at', 'timestamp with time zone', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'css_styles', 'jsonb', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'id', 'uuid', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'is_active', 'boolean', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'is_archived', 'boolean', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'name', 'text', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'template_body', 'text', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'template_data', 'jsonb', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('certificate_templates', 'updated_at', 'timestamp with time zone', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('farmers', 'barangay_id', 'uuid', 'src/db/schema.ts', true, false, false, NULL),
  ('farmers', 'contact_number', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('farmers', 'created_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('farmers', 'email', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('farmers', 'farm_address', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('farmers', 'farm_name', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('farmers', 'first_name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('farmers', 'gender', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('farmers', 'id', 'uuid', 'src/db/schema.ts', true, true, true, 'gen_random_uuid()'),
  ('farmers', 'is_active', 'boolean', 'src/db/schema.ts', true, false, true, 'true'),
  ('farmers', 'is_archived', 'boolean', 'src/db/schema.ts', true, false, true, 'false'),
  ('farmers', 'last_name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('farmers', 'metadata', 'jsonb', 'src/db/schema.ts', true, false, true, '{}'),
  ('farmers', 'middle_name', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('farmers', 'suffix', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('farmers', 'updated_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('issued_certificates', 'barangay', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('issued_certificates', 'control_number', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('issued_certificates', 'created_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('issued_certificates', 'destination', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('issued_certificates', 'farmer_name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('issued_certificates', 'id', 'text', 'src/db/schema.ts', true, true, false, NULL),
  ('issued_certificates', 'inspected_by', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('issued_certificates', 'issue_date', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('issued_certificates', 'metadata', 'jsonb', 'src/db/schema.ts', true, false, true, '{}'),
  ('issued_certificates', 'purpose', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('issued_certificates', 'qr_payload', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('issued_certificates', 'status', 'text', 'src/db/schema.ts', true, false, true, '"VALID"'),
  ('issued_certificates', 'swine_id', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('issued_certificates', 'valid_until', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('legal_document_audit_logs', 'action', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'actor_id', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'actor_name', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'actor_role', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'created_at', 'timestamp with time zone', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'details', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'document_id', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'document_title', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_document_audit_logs', 'id', 'uuid', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_documents', 'document', 'jsonb', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_documents', 'id', 'text', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('legal_documents', 'updated_at', 'timestamp with time zone', 'src/db/legalDocuments.ts; src/server/app.ts', NULL, NULL, NULL, NULL),
  ('media_files', 'alt_text', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('media_files', 'category', 'text', 'src/db/schema.ts', true, false, true, '"OTHER"'),
  ('media_files', 'created_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('media_files', 'file_name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('media_files', 'file_path', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('media_files', 'file_size', 'integer', 'src/db/schema.ts', false, false, false, NULL),
  ('media_files', 'file_url', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('media_files', 'id', 'text', 'src/db/schema.ts', true, true, false, NULL),
  ('media_files', 'mime_type', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('media_files', 'uploaded_by', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('messages', 'attachments', 'jsonb', 'src/db/schema.ts', false, false, false, NULL),
  ('messages', 'barangay', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('messages', 'created_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('messages', 'id', 'text', 'src/db/schema.ts', true, true, false, NULL),
  ('messages', 'is_read', 'boolean', 'src/db/schema.ts', true, false, true, 'false'),
  ('messages', 'receiver_id', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('messages', 'receiver_role', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('messages', 'sender_id', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('messages', 'sender_name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('messages', 'sender_role', 'text', 'src/db/schema.ts', true, false, true, '"focal"'),
  ('messages', 'text', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('registry_schema', 'auto_gen_pattern', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'auto_gen_prefix', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'auto_gen_type', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'created_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('registry_schema', 'default_value', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'field_key', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('registry_schema', 'field_order', 'integer', 'src/db/schema.ts', true, false, true, '0'),
  ('registry_schema', 'field_type', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('registry_schema', 'fixed_value', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'help_text', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'id', 'text', 'src/db/schema.ts', true, true, false, NULL),
  ('registry_schema', 'is_auto_generated', 'boolean', 'src/db/schema.ts', false, false, true, 'false'),
  ('registry_schema', 'is_fixed', 'boolean', 'src/db/schema.ts', false, false, true, 'false'),
  ('registry_schema', 'label', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('registry_schema', 'options', 'jsonb', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'placeholder', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'required', 'boolean', 'src/db/schema.ts', true, false, true, 'false'),
  ('registry_schema', 'section_id', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'section_title', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('registry_schema', 'updated_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('registry_schema', 'visible', 'boolean', 'src/db/schema.ts', true, false, true, 'true'),
  ('signatories', 'full_name', 'text', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('signatories', 'id', 'uuid', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('signatories', 'is_active', 'boolean', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('signatories', 'position_title', 'text', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('signatories', 'signature_image_url', 'text', 'src/db/certificateTemplates.ts', NULL, NULL, NULL, NULL),
  ('swine_records', 'actual_weight_kg', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'age_days', 'integer', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'age_months', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'asf_zone', 'text', 'src/db/schema.ts', true, false, true, '"RED"'),
  ('swine_records', 'barangay', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('swine_records', 'biosecurity_warning', 'boolean', 'src/db/schema.ts', true, false, true, 'false'),
  ('swine_records', 'birth_date', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'computed_pig_id', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('swine_records', 'created_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('swine_records', 'custom_fields', 'jsonb', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'ear_tag_no', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'estimated_weight_kg', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'farm_name', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'farm_scale', 'text', 'src/db/schema.ts', true, false, true, '"BACKYARD"'),
  ('swine_records', 'farmer_contact', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'farmer_id', 'uuid', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'farmer_name', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('swine_records', 'id', 'uuid', 'src/db/schema.ts', true, true, false, NULL),
  ('swine_records', 'is_archived', 'boolean', 'src/db/schema.ts', true, false, true, 'false'),
  ('swine_records', 'photo_url', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'pig_id_tag', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'price_estimate', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('swine_records', 'ready_to_sell', 'boolean', 'src/db/schema.ts', true, false, true, 'false'),
  ('swine_records', 'registered_at', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('swine_records', 'status', 'text', 'src/db/schema.ts', true, false, true, '"HEALTHY"'),
  ('swine_records', 'swine_type', 'text', 'src/db/schema.ts', true, false, true, '"FATTER_GROWER"'),
  ('system_settings', 'id', 'uuid', 'src/db/schema.ts', true, true, true, 'gen_random_uuid()'),
  ('system_settings', 'setting_key', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('system_settings', 'setting_value', 'jsonb', 'src/db/schema.ts', true, false, true, '{}'),
  ('system_settings', 'updated_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('users', 'active', 'boolean', 'src/db/schema.ts', true, false, true, 'true'),
  ('users', 'assigned_barangay', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('users', 'auth_user_id', 'uuid', 'src/db/schema.ts', false, false, false, NULL),
  ('users', 'created_at', 'timestamp', 'src/db/schema.ts', false, false, true, 'now()'),
  ('users', 'email', 'text', 'src/db/schema.ts', true, false, false, NULL),
  ('users', 'id', 'uuid', 'src/db/schema.ts', true, true, false, NULL),
  ('users', 'is_active', 'boolean', 'src/db/schema.ts', true, false, true, 'true'),
  ('users', 'name', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('users', 'permissions', 'jsonb', 'src/db/schema.ts', true, false, true, '[]'),
  ('users', 'phone', 'text', 'src/db/schema.ts', false, false, false, NULL),
  ('users', 'role', 'text', 'src/db/schema.ts', true, false, true, '"focal"'),
  ('users', 'status', 'text', 'src/db/schema.ts', true, false, true, '"active"'),
  ('users', 'uid', 'text', 'src/db/schema.ts', true, false, false, NULL)
),
observed AS (
 SELECT r.table_name,r.column_name,r.expected_type,r.required_by,
   t.oid AS table_oid,
   pg_catalog.format_type(a.atttypid,a.atttypmod) AS actual_type
 FROM required r
 LEFT JOIN pg_catalog.pg_class t ON t.relnamespace='public'::regnamespace
   AND t.relname=r.table_name AND t.relkind IN ('r','p')
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attname=r.column_name
   AND a.attnum>0 AND NOT a.attisdropped
),
classified AS (
 SELECT table_name,column_name,expected_type,actual_type,required_by,
 CASE
  WHEN table_oid IS NULL THEN 'MISSING_TABLE'
  WHEN actual_type IS NULL THEN 'MISSING_COLUMN'
  WHEN (
    CASE lower(regexp_replace(expected_type,'\\([^)]*\\)','','g'))
     WHEN 'int4' THEN 'integer'
     WHEN 'bool' THEN 'boolean'
     WHEN 'timestamp without time zone' THEN 'timestamp'
     WHEN 'timestamp with time zone' THEN 'timestamptz'
     ELSE lower(regexp_replace(expected_type,'\\([^)]*\\)','','g'))
    END
  ) IS DISTINCT FROM (
    CASE lower(regexp_replace(actual_type,'\\([^)]*\\)','','g'))
     WHEN 'int4' THEN 'integer'
     WHEN 'bool' THEN 'boolean'
     WHEN 'timestamp without time zone' THEN 'timestamp'
     WHEN 'timestamp with time zone' THEN 'timestamptz'
     WHEN 'character varying' THEN 'text'
     ELSE lower(regexp_replace(actual_type,'\\([^)]*\\)','','g'))
    END
  ) AND NOT (
    lower(regexp_replace(expected_type,'\\([^)]*\\)','','g')) IN ('text','character varying')
    AND lower(regexp_replace(actual_type,'\\([^)]*\\)','','g')) IN ('text','character varying')
  ) THEN 'TYPE_MISMATCH'
  ELSE 'OK' END AS issue
 FROM observed
),
gaps AS (
 SELECT table_name,column_name,expected_type,actual_type,required_by,issue
 FROM classified WHERE issue<>'OK'
 UNION ALL
 SELECT 'swine_tag_seq','(sequence)','sequence',NULL,'src/db/swine.ts','MISSING_SEQUENCE'
 WHERE to_regclass('public.swine_tag_seq') IS NULL
)
SELECT
 COUNT(*) AS total_schema_gaps,
 COALESCE(jsonb_agg(jsonb_build_object(
  'table',table_name,'column',column_name,'issue',issue,
  'expected',expected_type,'actual',actual_type,'source',required_by
 ) ORDER BY table_name,column_name),'[]'::jsonb) AS all_schema_gaps
FROM gaps;
COMMIT;
