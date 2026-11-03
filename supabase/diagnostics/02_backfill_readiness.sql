-- Read-only aggregate counts; candidate names are hypotheses, not approved mappings.
-- to_jsonb(row) permits inspecting optional legacy keys without undefined_column.
-- No record values, identifiers or URLs are returned.
BEGIN TRANSACTION READ ONLY;
SELECT 'issued_certificates.control_number' AS target,
 count(*) AS total_rows,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'control_number','') IS NULL) AS needs_review,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'certificate_number','') IS NOT NULL) AS candidate_certificate_number,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'document_number','') IS NOT NULL) AS candidate_document_number
FROM public.issued_certificates r;
SELECT 'media_files.file_url' AS target,
 count(*) AS total_rows,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'file_url','') IS NULL) AS needs_review,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'url','') IS NOT NULL) AS candidate_url,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'public_url','') IS NOT NULL) AS candidate_public_url
FROM public.media_files r;
SELECT 'messages.sender_id' AS target,
 count(*) AS total_rows,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'sender_id','') IS NULL) AS needs_review,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'user_id','') IS NOT NULL) AS candidate_user_id,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'from_user_id','') IS NOT NULL) AS candidate_from_user_id
FROM public.messages r;
SELECT 'registry_schema.field_key' AS target,
 count(*) AS total_rows,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'field_key','') IS NULL) AS needs_review,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'field_name','') IS NOT NULL) AS candidate_field_name,
 count(*) FILTER (WHERE NULLIF(to_jsonb(r)->>'key','') IS NOT NULL) AS candidate_key
FROM public.registry_schema r;
COMMIT;
