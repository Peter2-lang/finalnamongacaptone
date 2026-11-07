BEGIN;

-- Existing imported records do not include usable signed originals. Keep them
-- out of public/assistant legal answers until an administrator verifies them.
UPDATE public.legal_documents
SET document = jsonb_set(document, '{status}', '"for_verification"'::jsonb, true),
    updated_at = now()
WHERE id IN (
  'mo-hinunangan-2025-59',
  'res-hinunangan-376-2026',
  'po-southern-leyte-2023-144'
)
AND document->>'status' = 'active';

UPDATE public.legal_documents
SET document = jsonb_set(
  jsonb_set(document, '{sourceCompleteness}', '"metadata_only"'::jsonb, true),
  '{sourceDocuments}',
  '[]'::jsonb,
  true
),
updated_at = now()
WHERE id = 'po-southern-leyte-2023-144';

-- Earlier seed data used a site icon as a stand-in attachment. Remove that
-- non-document link rather than presenting it as an official scanned copy.
UPDATE public.legal_documents
SET document = jsonb_set(document, '{sourceDocuments}', '[]'::jsonb, true),
    updated_at = now()
WHERE document->'sourceDocuments' @> '[{"url":"/icon.svg"}]'::jsonb;

UPDATE public.legal_documents
SET document =
  (document
    - 'author'
    - 'dateEnacted'
    - 'effectiveDate'
    - 'fullText'
    - 'legalBasis'
    - 'articles'
    - 'keyArticles'
    - 'setbackRules'
    - 'penalties'
    - 'locationalStandards'
    - 'proximityRegulations'
    - 'mltfMembers'
    - 'sourceDocuments'
    - 'versionHistory'
    - 'auditLogs')
  || jsonb_build_object(
    'title', CASE id
      WHEN 'mo-hinunangan-2025-59' THEN 'Municipal Ordinance No. 2025-59'
      WHEN 'res-hinunangan-376-2026' THEN 'Resolution No. 376, Series of 2026'
      ELSE 'Provincial Ordinance No. 2023-144'
    END,
    'officialNumber', CASE id
      WHEN 'mo-hinunangan-2025-59' THEN 'Municipal Ordinance No. 2025-59'
      WHEN 'res-hinunangan-376-2026' THEN 'Resolution No. 376, Series of 2026'
      ELSE 'Provincial Ordinance No. 2023-144'
    END,
    'issuingAuthority', CASE id
      WHEN 'po-southern-leyte-2023-144' THEN 'Province of Southern Leyte'
      ELSE 'Municipality of Hinunangan'
    END,
    'signatory', '',
    'signatoryTitle', '',
    'status', 'for_verification',
    'sourceCompleteness', 'metadata_only',
    'shortSummary', CASE id
      WHEN 'mo-hinunangan-2025-59' THEN 'Regulation of commercial and backyard piggery, poultry, and other livestock or animal farms within Hinunangan. Source text and signed original are pending verification.'
      WHEN 'res-hinunangan-376-2026' THEN 'Requires local breeders and backyard hog raisers in Hinunangan to register livestock and other ruminants in their respective barangays for OMAS consolidation and recording. Source text and signed original are pending verification.'
      ELSE 'Bantay ASF of the Province of Southern Leyte. Reference pages are not present in the repository; completeness and provisions have not been verified.'
    END,
    'description', 'Pending official verification. The referenced source document is not available in the repository.',
    'legalBasis', '[]'::jsonb,
    'articles', '[]'::jsonb,
    'keyArticles', '[]'::jsonb,
    'setbackRules', '[]'::jsonb,
    'penalties', '[]'::jsonb,
    'sourceDocuments', '[]'::jsonb,
    'versionHistory', '[]'::jsonb,
    'auditLogs', '[]'::jsonb
  ),
  updated_at = now()
WHERE id IN ('mo-hinunangan-2025-59', 'res-hinunangan-376-2026', 'po-southern-leyte-2023-144')
  AND document->>'status' IN ('for_verification', 'draft');

INSERT INTO public.legal_documents (id, document)
VALUES (
  'eo-hinunangan-asf-checkpoints-2025',
  jsonb_build_object(
    'id', 'eo-hinunangan-asf-checkpoints-2025',
    'type', 'municipal_eo',
    'category', 'executive_order',
    'title', 'Executive Order for Municipal ASF Checkpoint Operations — Series of 2025',
    'officialNumber', 'Unnumbered Executive Order (draft), Series of 2025',
    'seriesYear', 'Series of 2025',
    'jurisdiction', 'Municipality of Hinunangan, Southern Leyte',
    'issuingAuthority', 'Office of the Municipal Mayor',
    'author', '',
    'signatory', '',
    'signatoryTitle', 'Municipal Mayor',
    'dateEnacted', '',
    'effectiveDate', '',
    'status', 'draft',
    'sourceCompleteness', 'metadata_only',
    'shortSummary', 'Draft metadata placeholder only. The referenced source DOCX was not present when this record was created; its wording, order number, signing date, locations, protocols, legal citations, and provisions have not been supplied or verified.',
    'description', 'Draft / Pending Official Verification. Upload the source and an authorized signed final version before treating this document as official.',
    'fullText', '',
    'legalBasis', jsonb_build_array(),
    'tags', jsonb_build_array('ASF', 'checkpoint', 'draft', 'pending verification'),
    'articles', jsonb_build_array(),
    'keyArticles', jsonb_build_array(),
    'setbackRules', jsonb_build_array(),
    'penalties', jsonb_build_array(),
    'sourceDocuments', jsonb_build_array(),
    'versionHistory', jsonb_build_array(),
    'auditLogs', jsonb_build_array(),
    'isArchived', false
  )
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
