# Smart legal import repair

Branch: `codex/public-landing-live-data`.

## Root cause

`legalDocumentParserService.ts` decoded compressed DOCX and PDF bytes as plain text. Its image path simulated OCR by selecting hard-coded ordinance/resolution provisions from filenames. The analyzer then supplied fabricated default sections, legal bases, penalties, signatories, current dates and Active status. The uploader saved that result without storing the original through the authenticated attachment flow.

## Implementation

- Inspect file signatures and ZIP package contents; filename text is never legal source text. A misleading extension is corrected on the source attachment while retaining original bytes and the original filename in provenance.
- Read `word/document.xml` in body order, resolve DrawingML/VML image relationships, honor explicit/rendered page breaks, inspect page dimensions and infer boundaries between large page images. Retain blank pages at explicit breaks. Handle alternate-content fallback without extracting both representations.
- Preserve DOCX paragraphs and table cells/rows; OCR images at their positions among native paragraphs. Embedded TIFF frames are rasterized. Missing image relationships and unsupported image formats produce visible warnings or extraction errors.
- Use PDF.js for real page count, native text and page rendering. Native pages do not require OCR. Scanned/mixed pages use raster OCR; matching native lines replace their OCR equivalents. Unmatched native text is retained with an alignment/duplication warning.
- Use Tesseract.js WebAssembly in browser workers, grayscale/contrast preprocessing, automatic deskew, and confidence-based right-angle rotation trials. No generative AI rewrites legal wording. Low-confidence and blank results are flagged. Original scans remain available.
- Bundle the OCR worker, WASM cores and English model from pinned installed packages under `/legal-ocr/` during Vite setup/build. No runtime OCR CDN or provider key is required. Exclude these assets from the general PWA precache.
- Split on changed, anchored ordinance/resolution headings. Repeated headings and new articles/sections do not split documents. All boundaries require human confirmation. Review supports splitting before a page, splitting at a text cursor within a page, merging adjacent documents from the same source, correcting metadata and page transcription, and confirming each document separately.
- Keep the complete page transcription independently of classified sections. No default hierarchy is manufactured. New imports default to Draft; missing metadata remains blank for correction.
- Persist review drafts, original local Files, job state and content-hashed OCR checkpoints in IndexedDB. Active computation requires the browser tab; interrupted work resumes through reprocessing with completed OCR checkpoints. This is a browser workflow, not a remotely running server queue.
- Save each confirmed document separately through the authenticated registry API and preserve its original in private Supabase `documents` Storage through existing signed-upload and attachment-registration APIs. Existing JSONB records carry batch identifier, source pages, confidence, warnings, metadata and complete text. Existing audit transactions bind attribution and upload time to the authenticated server actor. No schema migration is required.
- Stable import IDs, saved draft receipts and checking existing registry records/attachments make retries reuse records rather than generating new legal records after a lost response. Saving requires an online connection; storage failures are reported and leave draft records available for retry.
- Reopening the original-source inspector shows saved full page text, including content outside sections. DOCX images and TIFF pages can be rendered from the private original without rerunning OCR; PDF previews use the original page number.

## Supported inputs

DOCX (native, scanned or mixed), PDF (native, scanned or mixed), JPEG/JPG, PNG, WebP, multipage TIFF/TIF, UTF-8 TXT, XLSX and CSV. Maximum source upload: 25 MB. Raster pages above 25 million pixels are rejected with an explicit resize instruction. Legacy binary DOC/OLE, XLS, RTF and ODT are not passed off as readable text: convert to DOCX/PDF or a supported format first.

## Verification and limitations

- `npm test`: 186 reported tests passed, zero failures; includes actual Express authorization middleware tests. Added unauthorized attachment/upload-ticket cases.
- Direct extraction assertions: seven tests passed (signatures, no filename-based metadata or sections, full text, boundaries, same-line section text, blank extraction and cancellation).
- Browser suite: nine tests passed in the combined importer/responsive run. Real OCR executed for scanned DOCX, mixed DOCX, multipage scanned PDF, JPEG, PNG, WebP and multipage TIFF. Other checks cover native DOCX/PDF, independent document splits, image relationship order, misleading filenames, rotation, blank scans, invalid-image retry, cancellation, draft restoration and save/refresh.
- Additional browser regression: two tests passed after the TIFF safeguards/table change, including a generated **25-page scanned DOCX** that produced three documents with page ranges **1–8, 9–16 and 17–25**, detected numbers **2023-144, 376 and 2025-59**, no fabricated articles, and preserved a native table.
- Direct server audit assertions: seven passed. Storage path/type assertions: two passed.
- Save/refresh uses simulated authenticated API and Supabase Storage responses. It verifies application requests and retained records, not a live database/storage deployment. No production writes or deployment were performed.
- `npm run lint` and `npm run build` passed. The build retains existing bundle-size warnings.
- `resulotion.docx` was not present in the checkout; the actual 25-page upload and its wording have **not** been validated. Generated fixtures are explicitly synthetic and are not substitutes for the original legal documents.
- Word's flowing pagination cannot be reproduced exactly without a Word layout engine. Inferred image boundaries and ancillary header/footer/footnote content are explicitly flagged for review against the original. Complex tables, stamps, handwriting and signatures require source verification. PDF native/OCR alignment can require manual correction; unmatched text is not silently discarded.
- Drafts and OCR checkpoints are local to this browser profile. Confirmed records and originals use the existing remote database/Storage infrastructure. Active OCR does not continue after closing the browser.

## Exact changed files

- `.gitignore`
- `docs/legal-smart-import-verification.md`
- `package-lock.json`
- `package.json`
- `scripts/prepare-legal-ocr-assets.mjs`
- `src/components/asf/LegalDocumentOriginalViewerModal.tsx`
- `src/components/asf/LegalSmartImportModal.tsx`
- `src/db/legalDocuments.test.ts`
- `src/db/legalDocuments.ts`
- `src/server/app.test.ts`
- `src/server/app.ts`
- `src/server/supabaseStorage.test.ts`
- `src/server/supabaseStorage.ts`
- `src/services/directUpload.ts`
- `src/services/legalDocumentParserService.ts`
- `src/services/legalExtraction.test.ts`
- `src/services/legalExtraction.ts`
- `src/services/legalOcrCheckpoint.ts`
- `src/services/storageService.ts`
- `src/types.ts`
- `src/types/legalImport.ts`
- `tests/browser/legal-smart-extraction.spec.ts`
- `tests/browser/support/tiffFixture.ts`
- `vite.config.ts`
