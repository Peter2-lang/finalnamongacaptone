# Vercel serverless module-resolution repair

## Exact reproduced failure

Production `/api/health` returned HTTP 500 with `FUNCTION_INVOCATION_FAILED`; a read-only request confirmed the error. The supplied Vercel log reported `ERR_MODULE_NOT_FOUND` under `/var/task/src/server/`, with no external API requests. Because the supplied log abbreviated the filename, it alone cannot identify the final path component. The following local reproduction identifies the offending import from the repository and verifies the fix using Vercel's own builder.

Original source entry, `api/index.ts`:

```ts
export { default } from '../src/server/vercelEntry.ts';
```

Using `@vercel/node` 29.0.1 with this project's TypeScript 5.8.3 and configuration, the builder emitted `api/index.js` **with that same `.ts` import**, while packaging `src/server/vercelEntry.js`, not `src/server/vercelEntry.ts`. The other local backend files were also emitted as JavaScript. Importing the staged function with plain Node produced:

```
ERR_MODULE_NOT_FOUND Cannot find module '…/src/server/vercelEntry.ts'
imported from …/api/index.js
```

The source file exists and matches case. The relative path points to the right source directory. The failure is the mismatch between the emitted ESM specifier and deployed extension, before Express initializes. The old standalone build bundled `server.ts` only; it did not exercise the separately compiled serverless entry. A successful tsx import or Vite build could not detect this deployment error.

## Repair

- `api/index.ts` is replaced by tracked `api/index.js`. It statically imports `../build/vercel.cjs` and exports the compiled module's default Express app. There are no runtime source-TypeScript imports or hardcoded runtime paths.
- `scripts/build-backend.mjs` uses existing esbuild to bundle every local backend dependency into `build/vercel.cjs`, targeting Node 22. Installed npm packages remain external and Vercel traces their runtime dependencies. It also preserves standalone `build/server.cjs` and its source map. `build/vercel.meta.json` records compilation inputs and runtime imports for verification.
- `npm run build` builds Vite and invokes `npm run build:backend`. No database values are baked into the artifact; process.env reads remain runtime reads.
- `vercel.json` matches tracked `api/index.js` and explicitly includes `build/vercel.cjs`. Existing `/api/(.*)` -> `/api/index` routing is correct and retained. SPA fallback still excludes API requests.
- `.gitignore` no longer ignores the tracked launcher, and `npm run clean` removes generated output only. This avoids the earlier pre-build function-discovery error and prevents clean from deleting the launcher.
- The source `src/server/vercelEntry.ts` still loads server environment settings and exports the existing Express app. The shared database pool, verified TLS, actual health checks, role enforcement, schema and synchronization are unchanged.

The generated backend belongs under `build/`, never under public `dist/`. The API launcher is source-controlled, so Vercel can discover it before the build. Do not leave both api/index.ts and api/index.js in the deployment.

References: [Vercel function inclusion and configuration](https://vercel.com/docs/project-configuration/vercel-json#functions), [Vercel Node runtime](https://vercel.com/docs/functions/runtimes/node-js).

## Verification

The Vercel builder was installed in a temporary directory, not added to application dependencies. Its pre-fix output contained 724 files and the broken `.ts` import. Its repaired output contained 692 files, included `build/vercel.cjs`, and contained no `src/` application files. Importing the actual traced output succeeded. Running its Express handler on Node 22.23.4 returned HTTP 503 JSON for missing database configuration, rather than a module crash.

`src/server/vercelBundle.test.ts` independently builds the real artifacts into a temporary directory, checks the esbuild graph, and stages only the launcher, compiled bundle and installed dependencies. A plain Node child (no tsx loader, no src directory, no .env) starts the real Express handler. It verifies:

- Missing DATABASE_URL: HTTP 503, JSON, no-store and configuration_error.
- Deliberately refused localhost PostgreSQL connection: HTTP 503 and connection_refused.
- Protected users API: HTTP 401; the real middleware is present.
- The artifact imports only npm dependencies and Node builtins; required application modules are compiled into it.

The existing health tests cover successful checks, failed PostgreSQL authentication, missing schema columns, Auth outage, project mismatch and sanitized errors. The deployment tests check entry discovery, bundle inclusion and route consistency. No test fabricates a production healthy result.

No live Supabase credentials or local `.env`/`.env.local` were available in this workspace. Database authentication, TLS trust, schema and project state must be checked after redeployment against the real environment. The server reads DATABASE_URL securely at runtime and retains certificate verification. This repair does not change schema, records, accounts, roles, frontend or synchronization.

## Redeploy and confirm

1. Review and commit the new `api/index.js`, deletion of `api/index.ts`, `.gitignore`, package.json, build script, Vercel configuration and regression tests together. Include documentation. The pending demo-account changes are separate from this repair and need not be included.
2. Use project root as the Vercel Root Directory, Node 22.x, install `npm ci --include=dev`, build `npm run build`, output `dist`. Confirm the build log contains both `build/server.cjs` and `build/vercel.cjs`.
3. Keep server-side DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY configured in the intended Vercel environment. VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must match the same project. Optional DATABASE_SSL_CA supplies a trusted CA; never disable TLS verification. Use the exact Supabase transaction-pooler URI for DATABASE_URL; a Supabase API key or HTTPS URL is not a database URI.
4. Deploy a Preview first. If inspecting local Vercel build output, the function must include `api/index.js`, `build/vercel.cjs`, package metadata and traced npm dependencies. It no longer needs `src/server/*.ts` or an on-demand TypeScript loader. A full `vercel build` requires project linking/settings; the local builder reproduction does not authenticate, deploy, or modify a Vercel project.
5. Request the Preview `/api/health`. It must return JSON. HTTP 200 means required database/schema/Auth checks passed, with status healthy, database connected and cloud online. HTTP 503 means the function loaded but a real dependency/configuration check failed; inspect its safe database_error_kind/configuration_error and corresponding runtime logs before changing settings. A 503 is a diagnostic result, not verified successful connectivity.
6. After production deployment approval, redeploy production once without the existing build cache. Request `https://lguhinunanganswineregistry.vercel.app/api/health` again. Confirm no ERR_MODULE_NOT_FOUND or FUNCTION_INVOCATION_FAILED, then confirm actual healthy checks. Test an authorized login and normal synchronization without clearing IndexedDB.
7. Do not run migrations or reseed/reset the database to resolve a module-load error. Report any subsequent database error separately with credentials removed.

No production redeploy or environment changes were performed during this repair.

## Final check results

- `npm run lint`: passed.
- `npm run build`: passed, including Vite/PWA output and both backend artifacts.
- `npm test` on Node 24: 38 passed, zero failures.
- Full suite on Node 22.23.4: 38 passed, zero failures.
- Actual Vercel-builder output under Node 22: imports and serves real HTTP 503 JSON for absent configuration.
- `git diff --check`: passed.

Files changed for this repair: `.gitignore`, `api/index.ts` (removed), `api/index.js` (added), `package.json`, `scripts/build-backend.mjs` (added), `vercel.json`, `src/server/deploymentConfig.test.ts`, `src/server/vercelBundle.test.ts` (added), `README.md`, `deployment.md`, `docs/AUDIT.md`, `docs/cloud-connection-repair.md`, and this report. Pre-existing demo changes were preserved.
