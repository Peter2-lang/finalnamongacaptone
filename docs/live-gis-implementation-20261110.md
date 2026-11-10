# Live GIS implementation and verification — 2026-11-10

Branch: `codex/public-landing-live-data`.

## Delivery status

Implemented locally in the existing application; not deployed by this task. **Read-only production database/schema verification completed; live registration/update/Realtime write acceptance is not complete.**

The local CLI link `wuxivpxsnixabfvlunvg` is stale or points at a different project and denied connector access. Inspection of the public production application bundle `/assets/index-Cvd9xnxY.js` identified the actual browser project as `pxwjxrhkukonztmfczpm`, which is accessible. Do not apply migrations using the local link without explicitly correcting/verifying the intended project.

Read-only production inspection found:

- One swine record, with one numeric GPS pair and no missing farmer relationship.
- The existing record is inside a configured barangay polygon, and its recorded barangay matches that polygon. Verification returned aggregate counts only; private coordinates/names are not reproduced here.
- `swine_records.custom_fields` is JSONB. There are no dedicated swine latitude/longitude columns. Swine and farmer/barangay relationship keys are UUIDs; farmer/barangay foreign keys use `ON DELETE RESTRICT`.
- RLS is enabled on swine, farmers and users.
- The Supabase Realtime publication exists, but swine, farmers and users are not members. Therefore production Postgres Changes is **not configured** for registry records.
- Existing swine policies use authenticated `ALL` rules through `user_can_access_barangay` and `is_super_admin`, rather than distinct per-operation role policies. The helper reads active profiles by `users.id = auth.uid()` and assigned barangay. This does not establish the required municipality-wide Admin / ready-only Agent / Agent read-only contracts; actual authenticated role tests and policy review are still needed. User policies also permit same-barangay access, so trusted profile authority must be reviewed before enabling browser streams.
- Management migration history is empty; no application migration/receipt tables were found in the catalog scan. Historical SQL files cannot be assumed applied.

Production HTTP verification returned `/api/health` 200 (database connected, schema ready), `/api/public/registry-summary` 200 (one farmer, one active and ready-to-sell swine), and anonymous `/api/swine-records` 401. Individual authorized production CRUD was not exercised.

No production rows, schema, publication, grants or policies were changed. No arbitrary farm coordinates were generated.

## Root causes and changes

- Registration initialized latitude/longitude from barangay centroids or a municipal default, and the reset action wrote a centroid into the record. Coordinates now start empty and the reset action clears them. Defaults remain available only for map viewing. A manual pin or GPS selection fills the actual coordinates, detects the containing polygon, and permits correction. Invalid selections remain in the fields so an old valid location cannot be accidentally submitted while the displayed pin is elsewhere.
- GPS acquisition did not detect barangay or enforce focal scope. It now performs both checks, preserves exact device coordinates, and leaves manual selection available after failure.
- GPS rendering accepted any positive numbers, including Infinity and coordinates outside Hinunangan. Both engines, metrics, and heatmap use the same finite-coordinate/polygon predicate. Missing GPS is counted separately.
- Backend mutation validation checked only global coordinate ranges. It now checks municipal polygons and barangay consistency when a pair is supplied, including direct API and offline replay writes through `upsertSwineRecord`. Legacy null/zero GPS remains missing; it is never converted into a farm location.
- Active and archived API reads each published a partial list. They now publish one combined snapshot, deduplicated by database ID. Session identity is checked before caching or publishing an asynchronous response.
- The Realtime listener had no reconnect recovery or polling fallback. The application now checks a protected backend capability endpoint for publication membership, enabled RLS, explicit SELECT policies and the absence of broad authenticated ALL policies; it serializes refreshes, coalesces event bursts, refetches on subscription/reconnection, browser reconnect, visibility restoration, and simulation changes, and reconciles every 30 seconds while visible. Subscriptions/listeners/timers are removed on unmount or profile scope change.
- Realtime payloads are **invalidation signals**, never trusted record data. Every refresh uses the existing authenticated backend, which applies admin, focal and agent read scope. Local mutations retain the existing `swine_records_updated` event so Records, GIS and dashboard update together. Snapshot events carry a source flag; local mutations trigger another authoritative refresh without creating a snapshot feedback loop. Ready-to-sell navigation counts also derive from the shared record list.
- Snapshot polling could replace unsynchronized local changes. Combined snapshots retain the current queue owner's pending edits and omit pending deletes. Offline registration now awaits the existing sync engine's IndexedDB queue transaction rather than publishing a local save before a fire-and-forget queue write.
- Cached registry reads are tied to account ID, role and barangay. Legacy unscoped localStorage lists are not displayed; an online authorized read establishes the cache scope. IndexedDB queues are retained, not cleared.
- Heatmap data ignored the map's type, market and ASF filters. Heatmap input now starts from the same filtered records as markers, then applies heatmap classifications and ready-only selection. Sold/deceased records are excluded from the normal view; sold records can be explicitly selected. Zero records produce zero pins and no heat points.
- Registration activity was a synthetic weighted population index. It now counts actual registrations in the previous 30 days. Farmer counts prefer the actual farmer relationship ID. The barangay panel includes active swine, farms/records with GPS, missing GPS and registration activity.
- Popups now include swine type, registration date, ready status and an available HTTP(S) photo. Leaflet values are HTML escaped. Google popups follow updated authorized snapshots and close when the record leaves the active view. Missing Google credentials switch to Leaflet automatically.

- The dashboard farm modal had a separate write path that generated tags, RSBSA values, weights and inventory defaults, replaced denied GPS with a barangay center, and displayed success without awaiting persistence. It now embeds the existing `SwineForm` in the same modal shell and opens the existing batch-registration module for batch work. Both entry points therefore share validation, exact GPS, durable offline queues and persisted success behavior.

## Existing architecture preserved

Reviewed `GisMap.tsx`, `GoogleGisMap.tsx`, `BarangayBoundaryMap.tsx`, `gisCalculations.ts`, `SwineForm.tsx`, `PigsRecords.tsx`, `swineApi.ts`, `api.ts`, `offlineSyncEngine.ts`, `indexedDbService.ts`, backend routes in `src/server/app.ts`, normalized Drizzle mappings in `src/db/swine.ts`/`schema.ts`, and existing SQL migrations/review scripts.

The existing boundary editor, service-worker configuration, login endpoints and routing are unchanged. Existing PWA map asset/tile caching remains in place; uncached remote tiles still require a connection. No duplicate map application, database table, or sync queue was introduced. Public landing data continues through `/api/public/registry-summary`; the individual-record GIS authorization helper returns no records for the landing role.

## Database and Realtime requirements

No coordinate schema migration is needed for the verified production types. The guarded publication proposal `supabase/review/live_gis_realtime_publication.sql` is provided for review, not applied; it intentionally refuses the current broad ALL policies. It must follow verified operation-specific policy remediation in a safe environment. In the current ORM, farm latitude/longitude are JSON numbers in `swine_records.custom_fields.latitude` and `.longitude`; `mapSwineToDb`/`mapDbToSwine` preserve this mapping. Missing legacy values map to zero and are excluded from location rendering. Do not add competing coordinate columns or backfill farm positions with barangay centers.

Run `supabase/diagnostics/09_live_gis.sql` against the verified registry project, plus the existing `04_migration_history_and_role.sql` and `07_verify_schema.sql`. The new SQL returns schema types, relationships, RLS/policy metadata, publication membership and aggregate GPS representation counts, without returning private coordinates or farmer names.

The existing migration `005_farmer_swine_link_and_realtime.sql` contains the farmer foreign key and `swine_records` publication configuration. Inspect migration receipts and current catalog before applying any existing migration. Production must have:

1. The correct browser Supabase URL and publishable/anon key, with an authenticated session for the same project. Browser initialization rejects privileged keys.
2. `public.swine_records` in `supabase_realtime`.
3. Enabled RLS and SELECT policies matching verified `public.users` profiles and role scope. Never broaden policies to make Realtime work. Backend authorization remains required for all snapshots and direct record URLs.
4. Working server database access and existing schema contract, including JSONB `custom_fields`, UUID farmer/barangay relationships, and identity constraints.

Supabase documents publication setup and authorized Postgres Changes in [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes). If unavailable, the map reports `ONLINE / POLLING`, not LIVE. `LIVE` requires the backend capability gate, a subscribed channel and a successful backend snapshot. The capability is rechecked during polling, and catalog failures fail closed to polling. Pending writes show SYNCING; actual offline use shows OFFLINE/CACHED; request failures show CACHED/RETRYING. These runtime labels do not constitute deployment verification.

## Tests and remaining verification

All browser and persistence write tests use isolated fixtures/adapters, not production rows.

| Check | Result |
| --- | --- |
| `npm run lint` | Passed (TypeScript, no emit). |
| `npm run build` | Passed, frontend/PWA and backend/Vercel bundles; existing large-chunk warnings remain. |
| `npm test` | 177 passed, 0 failed in the complete run including the capability gate. |
| GIS + registration + Google + route refresh + public browser run | 61 passed, 2 device-specific skips, 1 mobile public-launcher assertion failed; the test assumed a desktop bottom offset. |
| Corrected public + application polling/offline/reconnect follow-up | 4 passed (desktop/mobile), 0 failed. Product launcher positioning was not changed. |
| Dashboard shared-form modal/Agent restriction | 2 passed (desktop/mobile), 0 failed. |
| Snapshot/queue, coalescing, GPS validation and metrics focused checks | Passed. Final save-confirmation, capability and snapshot checks also passed (3 files); a missing saved database ID cannot manufacture a registration success. |

All GIS/manual pin/GPS, empty snapshots, invalid GPS, marker movement, archive/restore/sold visibility, role marker visibility, Google adapter, and route-refresh cases in the final main browser run passed on their supported devices. The mobile public assertion was corrected to the existing 88px mobile safe offset and passed in the follow-up. Earlier exploratory runs also encountered Chromium target crashes under overlapping runs and stale import/chatbot fixture assumptions. An exploratory extended legacy-login run was interrupted after target crashes; that full extended suite is not claimed clean. The final refresh suite did pass `/gis` and `/kamirani` restoration on desktop and mobile.


Live write acceptance remains blocked until an isolated test environment with authorized role sessions is identified. Device-GPS/manual registration → Supabase read-back → refreshed GIS, two authenticated sessions receiving a real database event, actual per-role RLS behavior, and real offline replay/conflicts have not been verified against Supabase. Google is adapter tested; external Google credentials and availability remain deployment-specific. Production Realtime is intentionally unavailable pending publication and policy remediation; the deployed code must use polling until that work is completed.

The production security advisor also reported mutable search paths in the existing GIS policy helper functions ([Supabase remediation](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)), an RLS-disabled PostGIS reference table, and pre-existing security-definer execution notices. These were inspected without changing unrelated production objects. They do not substitute for authenticated role acceptance tests.

## Exact changed files

- `src/App.tsx`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/dashboard/SwineFarmRegistrationModal.tsx`
- `src/components/gis/GisMap.tsx`
- `src/components/gis/GoogleGisMap.tsx`
- `src/components/registry/SwineForm.tsx`
- `src/server/app.ts`
- `src/server/registryRealtime.ts`
- `src/server/registryRealtime.test.ts`
- `src/server/swineMutationValidation.ts`
- `src/services/storageService.ts`
- `src/services/swineApi.ts`
- `src/services/coalescedRefresh.ts`
- `src/services/coalescedRefresh.test.ts`
- `src/services/gisSnapshot.test.ts`
- `src/services/swineApi.test.ts`
- `src/utils/gisCalculations.ts`
- `src/utils/gisCalculations.test.ts`
- `src/utils/gisLocation.ts`
- `src/utils/gisLocation.test.ts`
- `tests/browser/gis-live-sync.spec.ts`
- `tests/browser/gis-regression.spec.ts`
- `tests/browser/public-landing.spec.ts`
- `supabase/diagnostics/09_live_gis.sql`
- `supabase/review/live_gis_realtime_publication.sql`
- `docs/live-gis-implementation-20261110.md`
