# System audit and functional repair

Audit date: 2026-11-03 (UTC). Branch: `fix/system-functional-repair-20261103`.

**Release decision: NOT READY.** Source repairs and isolated tests do not establish that every production workflow works. Live role authentication, database mutation persistence, RLS enforcement, uploads, genuine offline reconnection and multi-device tests require an authorized isolated Supabase environment and four role accounts. No genuine records were changed, no migrations applied, and production was not released.

## Scope and inventory

[system-inventory.json](system-inventory.json) inventories source/configuration/SQL/document files, all 81 React components, API registrations, event handlers, service methods and exported functions. [action-register.md](action-register.md) supplies the requested seven-column action register for every statically discovered action. Static discovery is not functional verification: its individual actions remain NOT VERIFIED unless a scenario below explicitly supplies evidence. This is a complete static inventory with targeted manual review and automated coverage, not a claim that every source line or every control has been manually exercised.

The initial working tree already contained dashboard, queue, authentication guard and inventory/test scaffolding changes. Those were preserved, inspected and included in this repair branch; they were not assumed to be verified. The inventory generator now includes untracked source files and excludes its own generated report.

## Executed scenarios

| Module | Feature / Action | Initial Result | Issue Found | Fix Applied | Final Test | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Authentication | Protected API boundary | Existing targeted test | Other routes had no exhaustive anonymous coverage | Test every inventoried protected API without token and with spoofed role headers | routeProtection.test.ts executes real Express middleware | PASS |
| Authentication | Four role authorization | Needed separate role fixtures | Unknown active profile roles reached handlers as guests | Reject roles outside the four-role allowlist | roleAuthorization.test.ts verifies role reads and denials | FIXED |
| Authentication | Disabled accounts | Source check | No comprehensive live account evidence | Preserved active/status checks | Inactive fixture receives 403 through real middleware | PASS |
| Authentication | Valid/invalid login, persistence, refresh, logout, reset/change password | Source inspected | Live role accounts unavailable | No authentication bypass or production accounts created | Browser uses intercepted fixture sessions only; real login NOT VERIFIED | BLOCKED |
| Accounts | Create/edit/delete/reset; profile linking; privilege escalation | Source inventoried | Live Auth administration and four role fixtures unavailable | Existing server account management checks preserved | Anonymous route protection only; lifecycle NOT VERIFIED | BLOCKED |
| Dashboard | Committed records and role/barangay scope | Existing unverified changes | Local drafts and out-of-scope rows could affect totals/charts | Shared committed scope, excluded drafts banner, scoped API queries | Fixture API read scope and farmer identity regressions | FIXED |
| Dashboard | Valuation | Hardcoded fallback prices in charts | Missing prices became invented asset values | Use recorded prices, zero for unavailable values | Source reviewed; full chart interaction NOT VERIFIED | NOT VERIFIED |
| Dashboard | Live create/update/delete and multiple devices | Source inspected | Realtime exists but live delivery unavailable | Preserve authorized refetch subscription | No live write/realtime test | BLOCKED |
| Swine | Create authorization and identifiers | Source inspected | Client-supplied UUID could overwrite an existing row through upsert | Server-generated UUID for direct create; sequence allocation failures return 503 | Validation and authorization regressions; genuine create blocked | NOT VERIFIED |
| Swine | Read/search/filter/archive scope | Existing tests | Agent queries must never widen scope | Preserved forced ready-to-sell/nonarchived filters; fixed sync pull archive filter | swineReadScope.test.ts and roleAuthorization.test.ts | FIXED |
| Swine | Update immutable identifiers | Source inspected | Normal update could accept computed identifier changes | Reject immutable field changes in direct update and offline replay | swineMutationValidation.test.ts | FIXED |
| Swine | Date/numeric/type boundaries | Source inspected | Invalid dates, negative/nonfinite numbers, fractional integer ages accepted by some paths | Shared server validation for direct writes, imports and database save/replay | Boundary tests include invalid leap date, future date, fractional age, coordinates and flags | FIXED |
| Swine | age_months INTEGER | Existing conversion | Deployed type cannot be inferred from TypeScript | Preserve integer month conversion and reject fractional input | Local mapping/validation; deployed column NOT VERIFIED | BLOCKED |
| Swine | Delete by tag | Broken source path | UUID predicate executed before tag resolution; duplicate DELETE | Remove unconditional UUID DELETE | swinePersistence.test.ts executes actual query builder with tag | FIXED |
| Swine | Archive/sell/bulk deletion; photo CRUD | Inventoried | No isolated live fixture | Preserve data and authorization | Anonymous endpoints tested; full lifecycle NOT VERIFIED | BLOCKED |
| Farmers | Identity association | Confirmed source defect | Name OR contact lookup merged different people on names alone | Require name AND contact unless explicit farmer ID selected; no name-only merge | Driver fixture executes farmer lookup during transactional batch save | FIXED |
| Farmers | Dropdown dedup/search/edit/delete | Inventoried | Actual deployed linked identities unverified | No merge of genuine farmer records | Live farmer association/UI lifecycle unavailable | BLOCKED |
| Import | Automatic registry field creation | Confirmed source defect | Spreadsheet keys automatically modified shared registry form | Imports keep values in JSON; schema changes require existing explicit editor | Removed import schema writes; validation/transaction tests | FIXED |
| Import | Farmer links and atomic batch | Confirmed source defect | Bulk path bypassed farmer linking and partially committed earlier rows | Shared save path inside enclosing transaction; preflight existing scope/identifiers | swinePersistence.test.ts forces later failure and verifies batch rollback | FIXED |
| Import | XLSX/CSV mapping, duplicates, empty/large files | Inventoried | Browser workflows not individually exercised | Added server payload validation and existing-ID/barangay preflight | Local business tests only; file workflow NOT VERIFIED | NOT VERIFIED |
| GIS | Missing coordinates | Confirmed source defect | Unknown locations became a fabricated municipal point | Missing coordinates map to zero sentinel, excluded by existing map filters | Stored-coordinate and absent-coordinate mapping regression | FIXED |
| GIS | Google/Leaflet map, overlays, pin/GPS/heatmap/labels/search | Inventoried | External Maps billing/restrictions and GPS unavailable | Existing fallback/error states preserved | GIS calculation tests only; interactive map workflows NOT VERIFIED | NOT VERIFIED |
| Certificates | Logo upload persistence | Confirmed source defect | Customizer used general media upload and retained URL without durable private path | Use certificate asset API and retain matching storage path | Source and type checks; actual Storage upload/refresh blocked | NOT VERIFIED |
| Certificates | Template save/load/selection/scope/legacy data | Existing tests | Production storage/database unavailable | Existing template normalization/signing preserved | certificateTemplates.test.ts, filters and database error tests pass with fixtures | PASS |
| Certificates | Generate/history/print/PDF/signatories/delete | Inventoried | No live fixture or physical print validation | No invented success claims | Module import/navigation only; functional workflows NOT VERIFIED | NOT VERIFIED |
| Biosecurity | Checklist scoring | Confirmed server validation gap | Client-submitted scores were trusted | Recompute score, level and risk on server from eight boolean answers | biosecurityValidation.test.ts | FIXED |
| Biosecurity | Scoped read/write | Confirmed source defect | Shared arrays could expose/overwrite another barangay; agents could write | Scope focal rows, deny agents, preserve other rows under transaction/advisory lock | Scope/scoring tests; live policy behavior blocked | NOT VERIFIED |
| ASF ordinances | Import/edit/delete/originals/audit/print/compliance | Inventoried | Live lifecycle unavailable | Existing transaction and validation paths retained | Legal document transaction/rollback tests pass; complete UI flow NOT VERIFIED | NOT VERIFIED |
| Barangays | Create/edit/deactivate/boundaries/focal assignment | Inventoried | Live database fixtures unavailable | No genuine barangay records changed | Focal administration denial tested; CRUD persistence blocked | BLOCKED |
| Agent | Authorized catalog, search/filter/details, view-only writes | Source/test reviewed | Add-swine navigation allowed agents; API summary/sync scopes inconsistent | Deny add_swine navigation; enforce ready/nonarchived API scope | Role tests, read-scope tests and RBAC regression | FIXED |
| Dispatch | Create/status/delete persistence | Confirmed source defect | Only local browser storage was changed | Protected cloud item endpoints; scoped reads and individual transactional writes | moduleItems.test.ts authorization/visibility and transaction tests | FIXED |
| Dispatch | Complete sale | Confirmed consistency defect | Dispatch completion did not atomically persist sold swine | Dispatch and associated sold status update in same transaction | Injected metadata write failure rolls both changes back | FIXED |
| Marketing | Create/toggle/delete persistence | Confirmed source defect | Local browser storage only | Administrative cloud writes; scoped reads | Module service authorization tests; browser lifecycle NOT VERIFIED | NOT VERIFIED |
| Transmittal letters | Create/edit/delete persistence | Confirmed source defect | Local browser storage only | Scoped cloud item CRUD; show database errors | Module service scope tests; browser lifecycle NOT VERIFIED | NOT VERIFIED |
| Messaging | Send/load/read persistence | Confirmed source defect | Compose/read actions used local storage only | Authenticated message API, cloud load, pending offline sends, visible errors | Messaging permission/serialization tests; live send/read blocked | NOT VERIFIED |
| Messaging | Broadcast/recipient authorization and deletion ownership | Confirmed source defect | Focal broadcast targets accepted; deletion ownership compared mutable display name | Server restricts focal reports to assigned barangay; ownership uses sender ID | messageAuthorization.test.ts and role fixtures | FIXED |
| Messaging | Subject/urgency/attachment retrieval | Confirmed source defect | Subject/priority lost and stored attachments omitted on reads | Preserve metadata in existing JSONB envelope; legacy array compatibility | messages.test.ts | FIXED |
| Messaging | Per-recipient unread and attachment upload UI | Source inspected | Global is_read flag cannot represent separate recipients; upload lifecycle not covered | No unreviewed production schema change | Requires designed/read-receipt migration and upload integration | FAIL |
| Offline | Valid session and active linked profile | Existing unverified changes | Public health could not establish write authorization | Verify current Auth user/profile and token refresh; enforce queue owner | syncAuthorization.test.ts | FIXED |
| Offline | Atomic draft/queue; deletion tombstones; remapped IDs | Existing unverified changes | Local deleted rows could reappear during pull; local writes needed atomic queue storage | Atomic IndexedDB transactions and tombstone-aware merge | indexedDbService.test.ts | FIXED |
| Offline | False success/loss of queue | Existing unverified changes | Legacy sync marked all local rows synced without acknowledgement | Legacy path no longer claims success; keep queue until acknowledgement | Source review plus queue tests; complete engine network lifecycle NOT VERIFIED | NOT VERIFIED |
| Offline | Full retry/reconnect/expired-session/multiple-device conflict resolution | Source inspected | No complete version-based conflict resolution; full engine recovery not exercised | Retain failed operations; no destructive queue clearing | Unit gates cover session and queue parts only | FAIL |
| Landing CMS | All 19 tabs, draft/preview/publish/uploads | Inventoried | No isolated storage/database/browser content fixtures | Preserved existing APIs and permission boundaries | All components import; mutation workflows NOT VERIFIED | NOT VERIFIED |
| Registry customization | Sections/fields/order/required/options/publish/reset | Inventoried | Import must not silently alter this configuration | Removed automatic import-driven registration | Existing registry tests and typecheck; editor persistence NOT VERIFIED | NOT VERIFIED |
| System customization | Sidebar/colors/fonts/background/logos/API/database/chatbot/master versions/audit | Inventoried | Live customization workflows untested; API settings write allowed admin although navigation is Super Admin only | API-settings writes now require Super Admin; no live configuration changed | masterConfig and role tests and anonymous route checks only | NOT VERIFIED |
| Languages | English/Filipino/Cebuano keys and interpolation | Existing tests | No key mismatch observed | No change required | i18n/index.test.ts | PASS |
| Reports/exports | Filtered official report/Excel/Word/PDF/print/backup | Inventoried | No end-to-end file content or physical print evidence | No genuine data exported | PDF/print source inventoried; functional outputs NOT VERIFIED | NOT VERIFIED |
| UI | Desktop/mobile/tablet menus/forms/tables/modals/errors | Inventoried | Every control requires individual exercise | Added browser fixture navigation and all-component import checks | See final validation record; tablet/individual control coverage incomplete | NOT VERIFIED |
| Database security | RLS, constraints, profile links, storage policies, live catalog | Blocked | Linked project inaccessible to connected Supabase identity | Never disabled RLS or applied schema changes | Supabase get_project returns permission denial for linked ref | BLOCKED |
| Deployment | Existing production health | Read-only live check | Health alone cannot certify workflows | No production release | HTTP 200; database connected; schema ready; authentication available; cloud online | PASS |
| Deployment | Preview/release and post-release critical workflows | Pending validation | Preview uses existing project environments; isolated test environment unidentified | Production release withheld | See deployment record below | BLOCKED |

## Live dependencies and evidence limits

- The repository's linked project ref is `wuxivpxsnixabfvlunvg`. Supabase `get_project` returned `You do not have permission to perform this action`. The connected projects named maoni and Capstone are different projects and were not substituted.
- Vercel project: `prj_kCOL4Ayv8ymN7S4zZO2csOpLXfn8`; team: `team_HoosLmQKmgVqMiUxDwSHSQoW`. Environment metadata confirms production/preview keys for database URL, CA, Supabase URL/publishable/server secret and Google Maps configuration. Values were not printed. Presence does not prove correctness or isolation. Vercel metadata flags readable-secret issues for DATABASE_URL, SUPABASE_SECRET_KEY and GEMINI_API_KEY; configuration was not changed.
- The inspected production deployment is `dpl_5EPuzkSKm3wSU5LLNwFRhoGwV4kA`, deployed from main commit `0bd949b0677095d70349783c66fbe13a08d2eb92`. Its `/api/health` returned HTTP 200 with `database: connected`, `schema: ready`, `cloud: online`, `authentication: available` at `2026-11-03T19:23:35.076Z`. This is the pre-existing production build, not these repairs.
- Local runtime is Node 24.22.2, whereas package.json declares Node 22.x. Vercel project metadata reports Node 26.x. Final release should use and verify the declared supported runtime. No runtime setting was changed during this audit.
- `npm ci` reports 14 dependency vulnerabilities (2 low, 12 moderate). No blind force upgrade was performed.
- Browser tests intercept Supabase Auth and API requests; they demonstrate rendering/navigation with role fixtures, not actual Supabase password login, RLS, Google Maps authorization, Storage upload, database persistence or service-worker/offline caching. Service workers are blocked in that suite.
- Driver-fixture transaction tests execute actual application methods and SQL generation, but do not verify PostgreSQL constraints, database role grants or deployed RLS.
- Existing local-only records in secondary modules are not automatically uploaded or treated as committed cloud rows. Their browser storage is preserved. Authorized review/import is needed if legacy local records must be migrated.

## Remaining release gates

1. Supply access to the linked project and designate an isolated test environment; provision four role fixtures there without embedding credentials in source.
2. Verify all action-register rows with live fixtures; extend browser coverage to CRUD, certificate logo refresh, reports, GIS and offline PWA operation.
3. Implement reviewed per-recipient message receipts, full multi-device conflict handling and attachment upload/access flows.
4. Verify every assigned admin permission and perform separate RLS tests.
5. Review dependency findings, runtime mismatch and proposed deployment/migration impacts; release production only after these gates pass and approval is given.

## Validation record

| Command | Result | Evidence / limitation |
| --- | --- | --- |
| `npm ci` | PASS after sandbox escalation | 732 packages installed; esbuild subprocess initially blocked; dependency findings recorded above |
| `npm run lint` | PASS | TypeScript noEmit; see evidence/lint.txt |
| `npm test` | PASS: 81/81 | Final full suite includes API-settings role regression; see evidence/unit-tests.txt |
| `npm run build` | PASS | Vite frontend, PWA generation and both backend bundles; large chunk warning remains |
| `npm run build:backend` | PASS after final authorization change | Server and Vercel function bundles generated |
| `npm run test:browser -- --output=test-results/retest` | PASS: 12/12 | Six scenarios each on desktop Chromium and iPhone-sized Chromium; all four roles, anonymous admin deep-link and all 81 module imports |
| `git diff --check` | PASS | No whitespace errors |

Browser environment initially lacked Chromium shared libraries. `npx playwright install-deps chromium` resolved that dependency. Earlier browser runs exposed harness timeout/hidden-sidebar locator issues and overlapping artifact directories; these were corrected before the clean 12/12 run. No earlier failing run is represented as a pass. Automated browser fixtures do not use hardcoded production accounts or bypass application authentication outside the intercepted test environment.

## Affected files

Application changes: `src/server/app.ts`, `src/server/swineMutationValidation.ts`, `src/server/messageAuthorization.ts`, `src/server/biosecurityValidation.ts`, `src/server/moduleItems.ts`, `src/db/swine.ts`, `src/db/messages.ts`, `src/services/storageService.ts`, `src/services/indexedDbService.ts`, `src/services/offlineSyncEngine.ts`, `src/services/syncAuthorization.ts`, `src/hooks/useCloudItems.ts`, `src/utils/farmerIdentity.ts`, `src/utils/rbacPermissions.ts`, `src/types.ts`, and the dashboard, messaging, certificate logo, transmittal letter, marketing and dispatch components. Test/inventory tooling: `package.json`, `package-lock.json`, `.gitignore`, `playwright.config.ts`, `tests/browser/system.spec.ts`, `scripts/inventory-system.mjs`, and the new adjacent regression tests.

No SQL migration or production environment change was applied.
