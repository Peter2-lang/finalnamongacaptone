# Repository audit — 2026-11-03

This is a verified code repair pass, not certification that every feature works against production. No Supabase project or Vercel deployment was linked or modified, and no migrations were applied remotely. The workspace had no `.env.local` and none of the required runtime variables. Supabase CLI reported that login was required. No browser automation engine was installed.

## Baseline

Logs are saved under `/tmp/swine-baseline/`. The valid baseline is `npm-ci-final.log`, `tsc-valid.log`, `build-valid.log` and `tests-valid.log`. Earlier attempts are retained separately. Installation and build passed; seven existing test files passed. TypeScript reported twelve errors: ten missing seal style props, one missing logo save callback, and one nonexistent certificate client import.

## Findings and fixes

| File / module | Cause | Fix |
| --- | --- | --- |
| `src/services/certificateService.ts` | Unused service imported a nonexistent client and assumed a non-null client | Deleted the unused duplicate; the live certificate APIs remain |
| `OfficialSeals.tsx` | Certificate print dimensions were passed to components that neither accepted nor applied style | Typed CSS style prop forwarded to SVG/image roots |
| `CertificateLogoCustomizer.tsx` | Parent passed onSave but modal only closed, losing persisted settings | Await save, disable while saving/uploading and display errors |
| `src/server/app.ts` certificate assets | Upload route was unreachable after return inside module-data PUT | Register the route once at startup |
| Legal documents server / migration 012 | Only static GET existed; writes and audit fetch failed | Postgres-backed list, create, update, delete and admin audit routes; transactional audit and document write; RLS; one-time official seeds |
| Legal document client / editor / import / audit modal | No Bearer, unchecked responses, optimistic success and cache reset when official document was edited/deleted | Authenticated JSON transport; await writes; visible errors; offline-only fallback; preserve empty lists and edits |
| Session middleware | Route allowlist omitted users/messages/media/farmers/dashboard/settings/config/chat/assets | Authenticate every non-public API; narrow public routes by method; config restricted to superadmin |
| Client identity headers | Multiple callers sent spoofable role/name/barangay headers | Removed from runtime clients; server uses verified session/profile. Tests send malicious headers to prove rejection |
| Sell route | Agent/cross-barangay writes allowed and price persisted under wrong property | Enforce admin/assigned focal, validate boolean and write estimatedPricePhp |
| Messages | Content/body callers rejected; private recipient messages visible through broadcast filtering; read mutation unscoped | Accept supported content fields; expose database failures instead of empty success; filter recipients first; check visible scope before marking read; superadmin sees admin scope |
| Sync | Retry could allocate another tag; message/certificate/media IDs unstable; agent certificate/media writes possible; unknown entities acknowledged | User-scoped operation IDs; replay returns existing swine/tag; stable IDs for other creates; role checks; unsupported entities rejected |
| Next pig ID | Database failure generated random ID and returned success | Return a retryable JSON 503 instead |
| Startup | Env not loaded and multiple apps/initializations created | Env module first, one exported app and one memoized initialization promise |
| API/client errors | Some API helpers accepted failed or non-JSON responses | Validate parsed data and HTTP status in core API helpers and new transport; message/media boolean helpers now reject errors |
| Assistant | Authenticated call omitted Bearer; online errors silently switched to local answers; no request limiting | Send Bearer; visible error reply online; bounded messages and per-instance rate limiting |
| Master config | Spoofed role header, no real token, array cache became object; failed publish/restore reported local success | Authenticated transport; preserve arrays; wait for server before local publish/restore; visible UI errors; injectable test transport |
| Database configuration | Browser persisted credentials and server allowed connection changes from request bodies | Server-managed DATABASE_URL; status-only screen; remove legacy browser credential keys; reject runtime connection rewiring |
| API configuration / maps | Settings stored in unused browser keys; fake generated Maps keys and auth tokens | Save/read system_settings through authenticated API; maps consume configured key/tiles and quota flag; real Google console configuration link; accurate session-provider display |
| Google Maps | Empty API key attempted map load | Visible configuration message and Leaflet button; load failure can switch to Leaflet |
| Translation interpolation | Replacement values containing dollar sequences were expanded as replacement syntax | Literal callback substitution; dictionary coverage and interpolation tests |
| PWA | Authenticated API responses could be cached across sessions | Remove API runtime caching and retire old cache at startup; keep offline registry engine |
| Express/API fallback | Unknown API and parser failures could receive HTML | JSON API 404 and JSON error middleware; case-sensitive routing |
| Uploads / Vercel | 30 MB JSON and base64 images exceeded serverless payload ceiling | 4 MB JSON limit; signed direct Storage uploads for active media, landing and certificate clients; server verifies completed images |
| Build | Server bundle and source map were inside the public static output | Standalone server now in ignored build/; Vercel discovers source-controlled api/index.ts and bundles it itself |
| Dependencies | Unused Firebase/pg-mem/direct d3 packages, nonstandard allowScripts, Unix-only clean and two lockfiles | Remove unused packages, move build tools to dev deps, cross-platform clean, test script, npm lockfile only; compatible audit fixes and official SheetJS 0.20.3 |
| Repo/docs | Generated artifacts and empty/scratch files tracked; obsolete setup instructions | Remove from source control, add ignore rules, Vite types, maintained README and deployment guide |

## Validation and limits

Final verification passed: `npx tsc --noEmit` (exit 0), `npm run build` (exit 0, generates dist/ and build/server.cjs), `npm test` (14 tests, 0 failures), and `git diff --check`. The development/production HTTP smoke script passed for startup, SPA deep links, API JSON and reporting an unavailable database. Logs are in `/tmp/swine-baseline/*-final.log` and `startup-smoke.log`. Route tests use an intentionally unavailable database and verify missing-session rejection, spoof resistance and JSON parsing errors. Legal transaction tests use a mock pool and verify rollback and trusted audit identity; they do not prove live SQL compatibility or real RLS behavior. Existing certificate, GIS, registry and master-config tests remain.

The installed dependency audit after compatible fixes and the official SheetJS upgrade reported 14 advisories: 12 moderate and 2 low; no high or critical remained. These remaining advisories require dependency-chain review rather than a forced major upgrade. Installed versions resolved successfully; no React peer incompatibility was reported. Node in this runner is 24; deployment target is 22.

A pattern scan of the tracked working tree and 211 available historical blobs found no real Gemini key, Supabase secret key, JWT or credential-bearing database URI. The candidate database URIs in deployment.md were bracketed placeholders. No confirmed exposed key requires rotation based on this scan; it cannot rule out secrets committed outside this available history or arbitrary opaque tokens.

English, Filipino and Cebuano dictionaries have complete key parity. Hard-coded English remains throughout existing forms/admin/legal text; complete translation and mobile/console inspection need browser acceptance testing.

Remaining acceptance work: real Supabase Auth/session refresh/logout and role/barangay tests, real migrations/RLS/storage/realtime verification, complete create/edit/delete/import/export/certificate/GIS/CMS/messaging/biosecurity/chat smoke tests, offline conflict/concurrent replay testing, browser refresh/private-window persistence, PWA update/mobile/console inspection, and a Vercel preview. Offline swine replay now preserves IDs, but full concurrent replay and stale-update conflict handling are not certified. Rate limiting is per function instance, not a shared deployment-wide limit.

Application roles currently are super_admin/admin/focal/agent. Barangay staff use focal. Farmer accounts/routing do not exist as a separate supported role. Provisioning that role requires product and authorization work; it was not silently mapped to a privileged role.

The root SQL snapshot disagrees with the migrations: it omits later certificate runtime columns/policies/storage repairs and the legal tables. Use migrations, never reset the database to the snapshot.

## Deployment handoff

Environment names, sensitive flags and settings for all three Vercel environments are in [README.md](../README.md#environment-variables). Apply migration files in this order, only if not already recorded as applied:

1. 001_create_full_registry_schema.sql
2. 002_database_first_auth_certificates.sql
3. 003_secure_rls_and_swine_sequence.sql
4. 004_users_realtime_publication.sql
5. 005_farmer_swine_link_and_realtime.sql
6. 006_scoped_storage_buckets.sql
7. 007_uploaded_document_metadata.sql
8. 008_certificate_templates_runtime_schema.sql
9. 009_scoped_certificate_template_management.sql
10. 010_repair_certificate_template_runtime_column.sql
11. 011_certificate_template_assets_and_schema_repair.sql
12. 012_legal_documents_and_audit.sql

No live values were written. Run the dry-run, review pending migrations, apply, configure Auth URLs and account profiles, configure Vercel variables before the build, deploy a preview, and approve production separately. Do not overwrite production variables or reset data without approval.

## Vercel function discovery repair

The first remote build of 10a9afa failed with `[unused_function]`: vercel.json referenced api/index.js, but that ignored artifact did not exist when Vercel validated function patterns before running npm run build. The earlier local build checks did not cover that pre-build validation phase.

The fix adds source-controlled api/index.ts, points the function settings at that source file, rewrites /api/* to the extensionless /api/index route, and removes generation of a competing api/index.js. Vercel handles TypeScript compilation/bundling. A regression check verifies that the configured entry exists independently of the build command. A real remote redeploy is still required to verify the hosted build.
