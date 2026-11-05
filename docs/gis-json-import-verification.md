# GIS pin placement and intelligent records import

The existing map and records import interfaces retain their design and providers.

## Implementation

- Leaflet uses the clicked geographic point, repositions a single manual marker, disables double-click zoom during selection, and prevents overlay popups from moving the camera. Coordinate feedback does not invoke camera commands.
- Google uses the clicked point, suppresses camera effects during selection, disables double-click zoom, and makes viewing overlays noninteractive during selection.
- Registration retains selected coordinates when other fields change. Standalone GIS stays on its page.
- The existing wizard accepts JSON arrays and objects containing `records` or `data` arrays, plus XLSX, XLS, and CSV. All rows contribute to field detection.
- Mappings, inferred types, mixed-type warnings, validation, field confirmation, progress, results, and rejected-row downloads remain in one import flow.
- Confirmed definitions use `registry_schema` and the published registry form setting; values use `swine_records.custom_fields` JSONB. No physical columns or constraint changes are required.
- New fields participate in dynamic table columns, details, authorized editing, filtering, search, customization, and export. Missing values remain blank.
- Backend validation enforces roles, focal scope, field definitions, farmer/barangay relationships, dates, numeric constraints, and identifiers. Bounded transactions use retry receipts and preserve database constraints.
- Confirmed saves update the records cache and trigger the existing refresh path for records, dashboard counts, and GIS analytics.
- Files are limited to 10 MB, 10,000 rows, and 150 unique fields; requests use batches of at most 25 records. Structured JSON values and ambiguous dates retain a safe Text suggestion.

## Files

Application: `src/App.tsx`; `src/components/gis/GisMap.tsx`; `src/components/gis/GoogleGisMap.tsx`; `src/components/registry/SwineForm.tsx`; `src/components/records/ImportSwineModal.tsx`; `src/components/records/PigsRecords.tsx`.

Persistence and validation: `src/db/swine.ts`; `src/server/app.ts`; `src/server/swineImportValidation.ts`; `src/services/storageService.ts`; `src/types.ts`; `src/utils/columnMatcher.ts`; `src/utils/swineImportData.ts`; `src/utils/registryFieldUtils.ts`.

Tests: `src/db/swineImportPersistence.test.ts`; `src/server/roleAuthorization.test.ts`; `src/utils/columnMatcher.test.ts`; `src/utils/swineImportData.test.ts`; `tests/browser/gis-regression.spec.ts`; `tests/browser/google-pin.spec.ts`; `tests/browser/system.spec.ts`.

## Verification scope

Tests use isolated SQL protocol fixtures and intercepted browser APIs, without modifying production records. Google tests use an SDK adapter, not the live billable Maps service. Production database connectivity and deployed schema compatibility are outside these fixture checks.

The initial sandbox test run could not bind local HTTP ports. The permitted rerun outside the sandbox passed all 97 unit/API tests. `npm run lint` (TypeScript check) passed. The focused import test file passed again after the inference correction.

The selected browser suite passed 59 tests, with three intentional platform-specific skips: desktop touch/pinch, mobile mouse wheel, and the mobile duplicate of the desktop full import/edit/export journey. Both platforms passed exact coordinate and unchanged center/zoom assertions, manual marker repositioning, JSON detection, rejected imports, and Google adapter checks. The desktop full import journey passed reload persistence, custom-field filtering, editing, CSV export, dashboard counts, and GIS marker refresh.

`npm run build` passed for frontend and both backend bundles after the final code changes. `git diff --check` passed. No test or build failures remain in these checks. Vite reports a large-chunk warning for the existing main bundle.
