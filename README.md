# DA Hinunangan Swine Registry

React 19, Vite 6, Tailwind 4 and Express with Supabase Postgres, Auth and Storage. Node **22** and npm are required. Use `package-lock.json`; Bun is not used.

## Local development

Copy `.env.example` to the gitignored `.env.local` and configure the names below. Never commit credentials. `server.ts` loads `.env.local`, then `.env`, before database or Auth modules are evaluated; existing environment variables take precedence. Set `NODE_ENV=development` locally.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. A reachable Supabase Postgres database is required for data features; there is no embedded database. Offline registry synchronization remains available through IndexedDB and the sync APIs.

```sh
npx tsc --noEmit
npm test
npm run build
NODE_ENV=production npm start
```

`npm run build` produces static `dist/`, standalone `build/server.cjs`, and the serverless `build/vercel.cjs`. Generated output is ignored. The source-controlled JavaScript launcher `api/index.js` loads the compiled serverless bundle; `vercel.json` explicitly includes it. All application TypeScript imports are resolved at build time rather than left for the Node ESM loader. Keeping both server artifacts outside `dist/` prevents publishing backend code as static files. `npm run build:backend` builds just the two backend artifacts. Alternatively, after building, run `NODE_ENV=production npx tsx server.ts`.

## Supabase configuration

Use one project for the database, browser client and server clients. For Vercel use the Supavisor transaction-pooler connection on port 6543 with `sslmode=require`; its username includes the project ref. Production uses pool max 1. Drizzle transactions use transaction-scoped operations; do not add session-scoped locks or temporary tables with a transaction pooler.

**Existing production databases require a reviewed catalog/history baseline before any migration.** Do not replay 001–012 or use the legacy snapshot as a repair: historical files contain incompatible layouts, data backfills and destructive compatibility operations. Runtime DDL and seeding have been removed. Use the [architecture audit and staged migration plan](docs/database-migration-architecture.md); its exact SQL proposals require approval and are outside automatic migration discovery. Never reset a database containing data. A fresh project also needs a reviewed baseline rather than an unchecked historical replay.

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
# Review the dry-run before applying:
# Only after approval of the exact pending SQL and verified history:
# npx supabase db push
npx supabase db lint --linked
```

Migration 012 creates legal documents and immutable API-written audit entries with RLS enabled. It seeds the official regulations once and preserves subsequent edits/deletions. Browser roles have no direct write policies for these tables: use the authenticated API. Normal startup performs no schema migrations; health uses read-only schema probes.

Create accounts using Supabase Auth and link `users.auth_user_id` to each Auth UUID. Application roles are `super_admin`, `admin`, `focal` (barangay personnel) and `agent`. Set `active=true`, `is_active=true`, `status=active` and assign a barangay for focal accounts. Farmers are registry entities; a separate farmer login role is not implemented. No real passwords are seeded.

In Auth URL settings, add the production Site URL, localhost callback URLs, and a preview redirect pattern restricted to your Vercel project/team. Verify storage buckets `landing-page-media` (public), `certificates` and `documents` (private), RLS policies from 003/009/011, and Realtime publication membership from 004/005/011.

## Environment variables

Set these in **Production, Preview and Development** on Vercel before building. Locally store them only in `.env.local`.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Server-only Supabase transaction-pooler URI; sensitive |
| `SUPABASE_URL` | Server project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Server Auth verification client key |
| `SUPABASE_SECRET_KEY` | Server-only Auth administration and Storage; sensitive |
| `VITE_SUPABASE_URL` | Browser project URL, same project |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser public key, same project |
| `GEMINI_API_KEY` | Server-only chatbot key; sensitive |
| `NODE_ENV` | `production` on Vercel; `development` for local dev |
| `VITE_GOOGLE_MAPS_API_KEY` | Optional restricted browser Maps key; can also be configured in API settings |
| `VITE_GOOGLE_MAPS_MAP_ID` | Optional Google Maps map ID |

Optional `SUPABASE_LANDING_MEDIA_BUCKET` overrides the default public bucket. Never use `VITE_GEMINI_API_KEY` or a `VITE_` prefix for database/service secrets. Restrict the public Maps key by API and allowed HTTP referrers. Changing `VITE_*` variables requires a rebuild. Do not overwrite existing production values without review.

## Vercel deployment

Project settings: Framework **Vite** (or Other), install **npm ci --include=dev**, build **npm run build**, output **dist**, Node **22.x**. Function routing targets `/api/index`, backed by source-controlled `api/index.js` and generated `build/vercel.cjs`; static files are excluded from the SPA fallback. The function has a 60-second duration setting and 1024 MB memory setting for non-Fluid deployments; verify actual memory in the dashboard if Fluid Compute manages it. PDF/Excel rendering primarily runs in the browser. Load-test chatbot/export workloads before production approval.

The install command must include `--include=dev`: Vite, esbuild and the Vite plugins are build-time devDependencies. Plain `npm ci` can omit them when `NODE_ENV=production` or npm is configured to omit dev dependencies, causing `vite: command not found`. Keep `NODE_ENV=production` for deployment; explicitly install the build tools before building. See [npm ci configuration](https://docs.npmjs.com/cli/v10/commands/npm-ci/).

Vercel limits function request/response payloads to 4.5 MB. Express JSON is limited to 4 MB. Image clients obtain a scoped signed upload ticket, upload bytes directly to Supabase Storage, and submit metadata for server-side image validation. Keep large spreadsheet import batches under the JSON limit. See [Vercel limits](https://vercel.com/docs/functions/limitations).

```sh
npx vercel login
npx vercel link
npx vercel env ls
# Add missing variable names for each environment using the dashboard or vercel env add.
# Mark DATABASE_URL, SUPABASE_SECRET_KEY and GEMINI_API_KEY sensitive.
npx vercel pull --yes --environment=preview
npx vercel build
npx vercel deploy
```

Review the preview: `/api/health` must report `database: connected`; sign in and test every role, writes, uploads, exports, PWA updates and deep-link refreshes. Unknown `/api/*` paths always return JSON; protected paths require Bearer authentication. Review `npx vercel logs PREVIEW_URL`. Only after production approval run `npx vercel --prod`.

See [the audit report](docs/AUDIT.md) for findings, validation and remaining verification work. The standalone HTTP smoke script is `node --import tsx scripts/smoke-startup.ts`; it uses a deliberately unavailable test database and does not verify real Supabase persistence.

For the reproduced Vercel TypeScript import crash, bundle verification, and redeployment procedure, see [Vercel module-resolution repair](docs/vercel-module-resolution.md).

For existing-database 42703 errors, run the [read-only schema inventory and reviewed repair procedure](docs/schema-drift-repair.md) before approving migrations. The nullable compatibility proposal is outside the automatic migration directory and must not be applied blindly.

Database inspection: `npm run db:inventory` generates read-only SQL; `npm run db:inspect` inspects the configured catalog without applying changes. Runtime schema initialization is disabled in every environment.
