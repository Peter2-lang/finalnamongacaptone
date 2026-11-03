# Cloud connection repair and verification

## Evidence and limits

Architecture: React/Vite PWA -> same-origin `/api/*` -> `api/index.js` -> `build/vercel.cjs` -> Express (`src/server/vercelEntry.ts`, `src/server/app.ts`) -> node-postgres shared pool and Drizzle -> PostgreSQL. Supabase JS handles Auth and Storage; adding Supabase API keys alone never configured PostgreSQL.

Before this repair, importing `api/index.ts` without DATABASE_URL exited with:

```
DATABASE_URL is required. Configure the shared PostgreSQL database; local in-memory persistence is disabled.
```

The exception occurred at module scope (`export const pool = createPool()`), before Express or its health handler could run. This reproduces a function initialization failure capable of producing Vercel HTTP 500. Database failures *inside* the previous handler returned HTTP 200, so a normal refused database connection alone does not explain the reported HTTP 500.

No production URL, Vercel function logs, or Supabase connection credentials were available in this workspace. Consequently, the exact deployed cause is not proven. Check the failing deployment's function logs for the startup exception or another import exception. All eight documented connection variables (including optional DIRECT_URL and DATABASE_SSL_CA) were absent in this session's process environment; this says nothing about Vercel's environment.

## Implemented safeguards

- Function imports survive missing/invalid database and Supabase configuration. Database access validates the URI before opening a connection; no localhost or memory fallback is used.
- A shared pool per warm instance, max 1 in Vercel/production, bounded connection/query times, idle shutdown, verified TLS. URI SSL flags cannot override the configured CA or disable verification.
- Health performs read-only LIMIT 0 queries for ORM tables/columns and an Auth Admin probe. Missing tables/columns, database failures, Auth failures, and project mismatch return 503 JSON. Only successful required checks return 200 with `status: healthy`, `database: connected`, `cloud: online`. Responses are non-cacheable and omit hostnames, counts, raw errors, credentials and stack traces.
- Normal startup no longer invokes the legacy schema initializer, which contains ALTER/DROP statements. No migrations were executed.
- Frontend parses safe 503 diagnostics, rejects HTML and incomplete health responses, starts cloud connectivity unverified, and separates browser connectivity from backend availability. Periodic failures back off to five minutes; online/visibility/manual events can retry immediately. Browser `navigator.onLine` is a connectivity hint, not proof of Internet access.
- Offline simulation already defaults to false; explicit saved user preferences are retained. IndexedDB and queues are not reset.
- Swine queue acknowledgement, local ID remapping, dependent queued-ID remapping, and record reconciliation commit together in one transaction. Server push batches also resolve temporary IDs created earlier in the batch. IndexedDB writes await transaction completion; cloud pulls merge current pending/unsynced records under one transaction instead of clearing the store. Existing stable operation IDs and deterministic server IDs for create retries are retained.
- API requests use NetworkOnly and are excluded from navigation fallback. Asset/font/GeoJSON offline caching remains.
- TypeScript excludes generated dist/build output, preventing checks from scanning stale or concurrently replaced bundles.
- Builds reject secret/service-role keys in VITE Supabase key settings and detectable project mismatches. Only publishable values belong in VITE variables.

## Vercel settings (configure privately)

| Variable | Use |
| --- | --- |
| DATABASE_URL | Server-only exact Supabase **Transaction pooler** URI, port 6543, copied from Connect. Percent-encode the password component if necessary. Never use an HTTPS project URL here. |
| DATABASE_SSL_CA | Optional server-only PEM CA from Supabase when Node does not already trust the certificate. Multiline PEM and literal `\n` are supported. TLS verification stays enabled. |
| SUPABASE_URL | Server project HTTPS URL. |
| SUPABASE_PUBLISHABLE_KEY | Server Auth public key for that project. Legacy SUPABASE_ANON_KEY is supported. |
| SUPABASE_SECRET_KEY | Server-only secret key for Auth Admin and Storage. Legacy SUPABASE_SERVICE_ROLE_KEY is supported. |
| VITE_SUPABASE_URL | Browser build project HTTPS URL; must match the server. |
| VITE_SUPABASE_PUBLISHABLE_KEY | Browser publishable key. Legacy VITE_SUPABASE_ANON_KEY is supported. Never use a secret/service-role key. |
| DIRECT_URL | Optional migration tooling URI; Drizzle prefers it when set. Not used by the application pool. |

SUPABASE_DATABASE_URL and POSTGRES_URL remain supported database aliases, with DATABASE_URL taking precedence. SQL_HOST is not a runtime connection option. Use one consistent project across database, Auth, browser and Storage configuration. Modern opaque keys do not expose their project reference, so obtain them from that same project's dashboard.

Use Node 22.x (package engines), project root as the root directory, `npm ci --include=dev`, `npm run build`, and output `dist`. Vercel discovers tracked `api/index.js` before the build and includes generated `build/vercel.cjs` and routes `/api/*` to it. Do not deploy this Express/pg backend as an Edge function. Local test environment currently uses Node 24; Node 22 production validation remains required.

Sources: [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres SSL parameter precedence](https://node-postgres.com/features/ssl), [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js).

## Redeploy and verify (production approval required)

1. Review these workspace changes. Get approval before changing production environment, deploying production, running migrations or creating production test records.
2. Configure private server variables and public VITE variables for the intended Vercel environment. Redeploy; changing VITE settings requires a new browser build. Use Preview with a non-production database for tests first.
3. Request `/api/health` on the deployment. Expect JSON, Cache-Control no-store, and HTTP 200 only with all required checks successful. On 503, read the safe error kind, then inspect Vercel runtime logs for `[CONFIG]` and `[HEALTH]`. On 500 without these logs, inspect function initialization/build errors.
4. If schema probes fail, have the database owner compare the deployed schema with `src/db/schema.ts`, raw queries and migrations 001–012. Review differences and obtain approval for any migration. Do not blindly run the entire migration history or replace the database using supabase_schema.sql. Health checks cover ORM schema, not every raw SQL function, Storage policy or write permission.
5. With authorized test accounts, create one identifiable record, record its UUID, confirm it in Supabase and retrieve it from a second device with permission for the same barangay. Role-scoped users intentionally see different subsets.
6. Explicitly enable simulation, create a pending test record, reload, and confirm it remains queued. Disable simulation; confirm acknowledgement, persistence and cross-device retrieval. Repeat with browser network disabled, then reconnect. Retry a lost-response create and confirm one UUID/record.
7. Confirm API requests in browser Network tools return JSON rather than HTML, bypass caches, and health is never green during 503. Let the new worker activate/reload; do not clear site storage or IndexedDB to update it.
8. Verify Auth failures, schema mismatch and network loss independently in Preview. Inspect browser assets for accidental credentials without printing their values. If a privileged key was previously published, rotate it through the dashboard with production approval.

## Remaining verification and synchronization limitations

Live Supabase connection, existing production schema/write permissions, actual Vercel runtime, browser IndexedDB behavior, and multi-device persistence require credentials and deployment access. They were not validated by mocked health tests or the build.

Existing queued updates use last-write-wins upserts; there is no durable per-operation receipt/version check for all entity types. Concurrent create retries retain deterministic IDs, but simultaneous updates or later replay can overwrite newer values. A complete conflict-safe protocol needs a separately reviewed change with database-backed operation receipts and conditional versions, plus integration tests. Do not claim production-safe conflict resolution from this repair. Pending operations remain available on rejected requests. The atomic acknowledgement and merge paths still need browser end-to-end tests, including concurrent tabs and dependent operations referring to remapped temporary IDs. No destructive migration was introduced to address these concerns silently.

## Files changed

- `src/db/index.ts`, `src/db/poolConfig.ts`, `src/db/poolConfig.test.ts`, `src/db/drizzle.config.ts`
- `src/lib/supabase.ts`, `src/lib/supabaseServer.ts`, `src/lib/supabaseConfig.ts`, `src/lib/supabaseConfig.test.ts`
- `src/server/app.ts`, `src/server/databaseHealth.ts`, `src/server/health.test.ts`
- `src/services/connectivityState.ts`, `src/services/connectivityState.test.ts`
- `src/services/backendHealth.ts`, `src/services/backendHealth.test.ts`, `src/services/offlineSyncEngine.ts`, `src/services/indexedDbService.ts`
- `vite.config.ts`, `tsconfig.json`, `.env.example`, `deployment.md`, this report

## Validation results

- `npm run lint`: passed after excluding generated output.
- `npm test`: 37 tests passed, zero failures (some existing files also run their own assertion suites).
- `npm run build`: passed, including Vite assets, generated Workbox service worker and bundled Node server.
- `git diff --check`: passed.
- Tests required permission to bind a localhost server because the sandbox initially returned EPERM. No live database connection was used by regression tests.

The subsequently confirmed production module-load crash is investigated and repaired in [Vercel module-resolution repair](vercel-module-resolution.md). Its builder reproduction identifies an emitted `.ts` import pointing at a packaged `.js` file; this supersedes the earlier unconfirmed production diagnosis.
