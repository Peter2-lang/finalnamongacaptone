# GIS, hook ordering and feature audit — 2026-11-04

Release status: **Final Preview READY; live workflow verification incomplete; production unchanged.** No production records were created, updated or deleted. No migrations were applied. Existing screen colors and sidebar layout were preserved. New map controls address missing functionality.

## Reproduced root causes

1. `LeafletGisMap` called `onPickLocationRef.current` on every map click, outside its pin-mode condition. `GoogleGisMap` also called `onPickLocation` unconditionally. `App` supplied a callback that opened `add_swine`, so ordinary map clicks opened registration. A real Leaflet browser test reproduced 20 callbacks from 20 normal clicks before repair.
2. Leaflet and Google swine marker handlers called `onSelectSwine`; `App` connected that to `handleEditSwine`. Clicking a marker therefore opened editing instead of allowing its popup to remain visible.
3. `ImportSwineModal` remained mounted while closed but returned before its validation effect and two memo hooks. Opening it changed hook 23 from absent to `useEffect`. The development browser reported **“Rendered more hooks than during the previous render.”** Its stack identified `ImportSwineModal` → `updateEffectImpl` → `updateWorkInProgressHook`. The closed/open/closed test reproduced the crash before repair.
4. `PhotoMediaSettings` also returned before its hooks when access was denied. Its permission guard now renders a separate content component, preserving access checks without conditional hooks.
5. Print CSS hid `#root *` with greater specificity than the rule revealing printable documents. It could produce blank printouts. It also revealed all mounted document previews. The shared print utility now marks the selected preview, excludes others, restores attributes after printing, rejects missing previews, and uses corrected CSS specificity.

React and React DOM installed versions are both **19.3.0**.

Additional confirmed defects repaired during browser verification:

- Leaflet CSS existed only as an external CDN link. The GIS component now imports the installed package's identical stylesheet, and the CDN link is removed from `index.html`, so the service worker can precache map styling.
- Farmer icons overlapped swine icons. Both engines now retain actual farmer GPS coordinates and offset only the icon in pixels. They no longer add invented latitude/longitude offsets.
- The mobile map toolbar extended outside the viewport. It now wraps within the map; navigation controls sit clear of the toolbar and legend. Rapid Leaflet zoom-control actions use immediate zoom updates to avoid dropping a click during animation.
- Anonymous landing startup requested protected registry data. `refreshAllData` now clears private view state and returns for anonymous users. The local public page is covered by browser checks; the previously deployed Preview predates these repairs.

## Changes

| Files / functions | Final behavior |
| --- | --- |
| `src/components/gis/GisMap.tsx`: map initialization click handler, boundary handlers, marker effect, manual pin toggle | Viewing clicks never call the registration callback. Explicit location-selection/picker mode can select coordinates. Marker clicks keep the popup open; record navigation requires the explicit popup action. Focus uses `preventScroll`; keyed markers survive refreshes, their hit areas align with their icons, and their stacking remains above labels. Boundaries stop bubbling into location selection. |
| `src/components/gis/GoogleGisMap.tsx`: GoogleMap click, AdvancedMarker click, camera controls | Location callback requires `isLocationPicker`; marker click selects popup only. Controls call the actual map instance. |
| `src/components/gis/MapNavigationControls.tsx` | Accessible zoom in/out, default Hinunangan reset, geolocation permission request and device-location focus; denial/unavailability feedback; controls do not bubble clicks. |
| `src/App.tsx`: GIS rendering | Removed marker-to-edit callback. Agent GIS navigation now renders the view-only map instead of falling through to the sales catalog. |
| `src/utils/gisCalculations.ts`: `filterSwineByAuthorization` | Shared map scope also filters agent records to ready/nonarchived records and fails closed for an unassigned focal person. Both engines apply scope before metrics, search, targeting and popups. A whitespace-only focal assignment also fails closed, including for records with an empty barangay. |
| `src/components/records/ImportSwineModal.tsx` | All hooks execute before the closed-state return. |
| `src/components/admin/media/PhotoMediaSettings.tsx` | Access guard and hook-bearing content use separate components. |
| `src/utils/printUtils.ts`, `src/index.css` | Only the selected document prints; document visibility overrides application-hiding CSS. Existing named paper-size rules remain. |
| `src/components/records/PigsRecords.tsx`, `src/utils/exportEncoding.ts` | CSV cells consistently quote commas, quotes and line breaks, and neutralize spreadsheet formulas. Invalid/missing registration dates no longer throw during export. Word export encodes record text as literal text. Leaflet popup text also uses HTML encoding. |
| `src/utils/hookOrder.test.ts`, `src/utils/exportEncoding.test.ts` | Source-wide hook-order regression audit and record-export encoding tests. |
| `tests/browser/gis-regression.spec.ts`, `tests/browser/system.spec.ts`, `playwright.production.config.ts` | GIS, hook transitions, role visibility, print isolation, mobile gestures, expanded module navigation and production-bundle checks. |

## Module audit matrix

The regenerated static inventory covers 82 components and 105 API registrations. The action register tracks discovered actions individually; an inventoried action is **not** a functional pass. Component fixtures and API/database-driver fixtures never establish live Supabase persistence or actual account authentication. The public Preview check does not sign into the application. Browser module tests intercept APIs and restore synthetic fixture sessions; they are UI isolation tests, not successful real logins or an application authentication bypass.

| Module | Evidence reviewed / exercised | Still requires isolated live testing |
| --- | --- | --- |
| Login / authentication | Role middleware, disabled/unknown roles, anonymous protected-route denial, session-restoration profile fixtures; anonymous deep-link browser test | Real login/logout, token refresh and account switching with four authorized accounts |
| Dashboard | Record-based committed counters and role scope reviewed; role KPI API fixtures; module rendering | Cloud create/update/delete → live counters, realtime and multiple devices |
| GIS | Actual Leaflet interactions, normal-click callback regression, markers, layers, boundaries, scopes; Google source handlers reviewed | Billing-authorized Google runtime, actual device GPS and real role data |
| Swine records | Browser rendering, importer hook transition, mutation validation, database save/rollback/tag-delete fixtures | Real create/read/update/delete/search/filter lifecycle and refresh persistence |
| Farmers | Farmer identity tests; transactional farmer association and duplicate matching fixtures | Real registration, editing and duplicate conflict lifecycle |
| Ready for Take-Off | Navigation rendering, scoped module-item writes and atomic sold-status transaction tests | Real dispatch/sale lifecycle and role visibility |
| Print reports | Browser print-media isolation; shared utility and paper-size/page-break rules reviewed | Genuine authorized record preview, physical printing and long-table page review |
| Certificates | Template database/filter/error tests, module rendering and shared print fix | Logo upload persistence, genuine generation/history, downloadable PDF and physical printing |
| Biosecurity | Server score recomputation and scope tests; role module rendering | Checklist save/load and live certificate workflow |
| ASF legal decrees | Module rendering, document validation and document/audit transaction rollback tests | Real authorized edits, attachment downloads and source-document printing |
| Messaging | Read/attachment field mapping tests, authorization tests, module rendering | Real delivery, attachment upload/download and read-state propagation |
| Manage Barangay | Navigation rendering; focal administration denial; GIS boundary source review | CRUD, assignment/boundary persistence and cross-device GIS refresh |
| User Accounts | Navigation rendering, privilege/active-role middleware tests | Auth user creation/edit/disable/reset lifecycle |
| Registry customization | Navigation rendering, schema service/write-requirement tests and source review | Dynamic-field validation and actual cloud saving |
| Landing CMS | Navigation rendering, role guards, public Preview rendering | Real media upload/edit/publish persistence |
| Sidebar configuration | Navigation rendering; master configuration and RBAC tests; preserved sidebar design | Cross-session saving, publication and role visibility changes |
| System settings | Settings JSONB/query tests, API permission checks and configuration rendering | Real setting save/load persistence and deployment-specific configuration |
| Offline sync | IndexedDB, connectivity and queue-ownership/session-authorization tests | Real disconnection/reconnection, conflicting edits, expired sessions and multiple devices |

## Verification and deployment

Final command results and preview status are recorded below. Earlier failed browser runs revealed harness issues (wrong heading, duplicate module import URL, synthetic mouse events aimed under overlays), and a real control/legend overlap. These failures were investigated; they are not counted as successful runs.

Real data operations remain blocked on identification of an isolated test environment and authorized role accounts. The repository's Supabase linked project reference does not match either project accessible through the connected Supabase account. Preview health reports a connected, ready database, but a health check is not CRUD, RLS or policy verification.

These test results do not establish production readiness for every workflow. Production remains unchanged.


## Revalidation in the current session

- The original `HEAD` versions of `GisMap.tsx` and `ImportSwineModal.tsx` were reproduced in `/tmp/swine-baseline-20261104`, with no changes to the working application or a database. Both regression tests failed as expected: normal map clicks invoked the registration callback, and opening the importer changed the hook sequence. The captured development stack is in [baseline-react-error.json](evidence/gis-react-20261104/baseline-react-error.json); the failing baseline test output is in [baseline-reproduction.txt](evidence/gis-react-20261104/baseline-reproduction.txt).
- `npm run lint`: PASS (`tsc --noEmit`).
- `npm test`: PASS, 84 tests, zero failures. Server tests required local-listener permission; the initial sandbox-only run failed with `EPERM` and is not counted as a pass.
- GIS and hook audit after the focal-assignment fix: PASS, 2 test files; includes unassigned/blank focal scope and ready/nonarchived agent scope.
- `npm run build`: PASS, including the PWA and both backend bundles. The existing main-chunk-size warning remains. No dependency versions were changed.
- Initial complete GIS browser run: 21 PASS, 1 desktop skip for the mobile-only gesture scenario. Added GPS-denial and mouse-wheel cases are included in the final run below.
- Concurrent follow-up browser runs initially collided in Playwright's shared trace directory (`browserContext.close: ENOENT`). These runs were stopped; development and production outputs are now separate, and final suites are rerun with the corrected configuration. This was a test artifact failure, not a successful application check.
- The four-role browser fixtures do not establish real authentication. No live credentials were supplied in this session, and no authentication was bypassed to perform real data operations.

Final browser results and deployment provenance follow when available.


### Popup stability follow-up

A final browser check exposed marker churn: `LeafletGisMap` rebuilt all markers whenever the parent supplied a fresh `onViewSwineRecord` callback. That could close a popup during unrelated parent counter/session rendering. The marker listener now calls the latest callback through a ref, and callback identity no longer invalidates the marker effect. The popup-open → parent-callback-change regression passes on desktop and mobile (`popup-stability.txt`).

The integration test was also corrected to exercise 20 empty-map clicks before loading marker fixtures. Its previous fixed coordinates could activate a marker's explicit **View Swine Record** button on mobile, correctly opening Records and invalidating the empty-map assertion. It now waits for initial refresh requests before checking the populated marker popup.

The full development run recorded 39 passes, one mobile GIS failure and two platform skips. The full production run recorded 13 passes, one mobile GIS failure and two development-source-import skips. Those failed runs are retained; final targeted GIS reruns below verify the corrected scenario and popup fix. They must not be described as clean full-suite runs.


### Final full-page GIS diagnosis

The failing integration scenario exposed a separate, confirmed Leaflet focus defect. Instrumented browser events recorded `<main>` scrolling from 0 to 81 pixels between `mousedown` and `mouseup`: Leaflet's keyboard handler focuses the entire map container and restores only window scroll. The visible marker therefore moved away from the pointer; mouse-up hit a barangay label and the resulting click targeted the map pane. The map now focuses itself with `{preventScroll:true}` in the mouse-down capture phase, before Leaflet's handler. Keyboard focus remains available. Both desktop and mobile full-page integration checks now pass (four focused checks including component popup refresh stability).

Marker DOM is also reconciled by record ID, its geometry uses Leaflet's anchor without a second inner translation, and livestock hit areas are above barangay labels. This preserves popup and pointer targets across equivalent data refreshes and label overlap. Farmer popup names are HTML-encoded. The corrected fixture returns consistent authoritative records from both `/api/swine-records` and `/api/sync/pull`; previously the sync fixture incorrectly returned an empty registry.

Earlier hypotheses (callback churn, inconsistent fixtures, hit-area overlap) identified separate improvements but did not alone resolve the full-page click failure. The scroll event trace and passing full-page rerun establish the final focus fix; earlier failed runs are not passes.


### Final source and verification status

- Final application commit: `23fd5b45ae04003356b1e4ea535a02f95e0629b6`, pushed to `fix/system-functional-repair-20261103`.
- Final focus/refresh checks: 4/4 PASS in development (desktop and mobile component plus full-page checks).
- Final production GIS checks: 2/2 PASS. This suite runs `npm run build` before starting the preview server; both the frontend/PWA and backend builds completed successfully. It includes unchanged parent scroll during marker clicks, 20 empty-map clicks, marker popups and page refresh.
- Final source-wide hook audit and GIS scope tests: 2/2 PASS.
- Final type-check: PASS.
- The complete Node suite previously passed 84/84 tests. The later application changes are confined to Leaflet rendering and test fixtures.
- Broad role/module navigation was exercised in the earlier full runs. Their failing GIS case has now been diagnosed and retested; the logs remain as failures rather than being rewritten as clean full-suite results.
- Live-role login/logout/token refresh, real Supabase CRUD/counter/map/print persistence, Storage uploads, physical printing, Google Maps runtime authorization, actual device GPS, and multi-device/offline conflict workflows remain unverified. No test accounts or isolated environment were supplied in response to the access question. Existing dependency advisories and the bundle-size warning from the earlier audit remain unresolved. Production readiness is not certified.
- No migrations were applied and no real registry records were mutated. The unrelated existing SQL edit and generated inventory/action-register working-tree changes were left out of the application commits.

Final 28-scenario GIS run: **26 PASS, 2 platform-specific skips, zero failures**. The skips are desktop touch gestures and mobile mouse wheel. This includes all final map changes, importer/media hook transitions, print isolation, role-scoped markers, empty clicks, marker popup refresh stability, GPS success/denial, mouse-wheel/double-click zoom, pan, reset, layers, boundaries, mobile pinch/drag, page refresh, and unchanged parent scroll during marker click. See [final-gis-tests.txt](evidence/gis-react-20261104/final-gis-tests.txt).

Final immutable Preview: https://lguhinunanganswineregistry-6d4mhfz8h-peter2-langs-projects.vercel.app — deployment `dpl_3eRFwkqFoQWTRkM3uLEso7mcksQs`, **READY**, application commit `23fd5b45ae04003356b1e4ea535a02f95e0629b6`. `/api/health` returned **HTTP 200** at `2026-11-04T04:53:22.570Z`: healthy, database connected, schema ready, cloud online, authentication available. See [final-preview.json](evidence/gis-react-20261104/final-preview.json). This health check does not establish live CRUD, RLS, role authentication or upload success.

Production was not promoted or replaced. No production data were created, changed or deleted. The subsequent evidence-only commit does not alter the application code tested in this immutable Preview.


### Continued production module-suite verification

After the final GIS repair, reran the full production-bundle `system.spec.ts` suite using isolated browser fixtures. **14 passed, 2 skipped, zero failed** across desktop and mobile: four role navigation fixtures, anonymous admin-route denial, GIS empty clicks/refresh, and populated/empty dashboard snapshots. The two skips are the development-only import of source modules. Full output: [production-module-suite.txt](evidence/gis-react-20261104/production-module-suite.txt). This closes the earlier full-suite GIS regression gap; it still does not establish real credential or database behavior.


### Production status check

Read-only Vercel production health check at `2026-11-04T05:05:29.581Z`: HTTP 200, database connected, schema ready, cloud online, authentication available. Production still serves deployment `dpl_5EPuzkSKm3wSU5LLNwFRhoGwV4kA` from commit `0bd949b0677095d70349783c66fbe13a08d2eb92`; the GIS fixes have **not** been released there. See [production-health.json](evidence/gis-react-20261104/production-health.json). Health confirms availability only, not workflow correctness.
