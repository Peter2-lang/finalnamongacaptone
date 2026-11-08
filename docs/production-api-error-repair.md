# Production API repair — 8 November 2026

## Confirmed causes

1. Production still served `d4304a7`, while the chatbot repair existed in `e7809b4` on the working branch/preview. Vercel production logs showed authenticated focal requests succeeding through authentication, then returning assistant `provider_unavailable` after approximately 23 seconds. The earlier private upstream probe reproduced HTTP 504 / `DEADLINE_EXCEEDED` with `gemini-flash-latest`; the same credential successfully answered through `gemini-flash-lite-latest`. The repaired engine defaults to the latter and handles supported authorized registry queries before initializing Gemini, so zero records and a provider outage do not prevent those database answers.
2. The reported configuration caller was a verified focal user. `/api/config/*` is deliberately Super Admin-only and correctly returned HTTP 403. `MasterConfigService` scheduled an unconditional fetch 100ms after construction, regardless of role or whether session restoration had finished. This produced an unauthorized request and could also leave a Super Admin without a successful fetch after restoration.

The configuration constructor no longer makes network requests. `useRoleTheme` starts synchronization when the verified role changes; the service only requests `/api/config/master` for `super_admin`. The server restriction is unchanged. No RLS, permissions, accounts, registry records, or application design was changed.

## Source and release

- Repository: `Peter2-lang/finalnamongacaptone`
- Branch: `codex/public-landing-live-data`
- Repair commit: `3cb6714ca4d81a5ecb20dfd2cc61f603c5689f5d`
- Vercel project: `lguhinunanganswineregistry`
- Production deployment: `dpl_Fm2utszrHAmeZpe97Tfqo2DaWh1S`
- Stable URL: https://lguhinunanganswineregistry.vercel.app

Deployment is READY and the stable production domain resolves to this exact commit. Vercel's remote production build (Vite, approximately 57 seconds) passed and assigned the production alias. A deployment-scoped runtime scan after the smoke tests found no error/fatal log entries. Long-term monitoring and log drains were not assessed.

## Verified production results

- `POST /api/public/assistant/chat` with `Hi`: HTTP 200, a real greeting and offer to assist.
- The same endpoint with `What is a pig?`: HTTP 200, a pig definition explicitly marked general information.
- The same endpoint with `How many swine are registered?`: HTTP 200, 0 active swine.
- `GET /api/public/registry-summary`: HTTP 200, 0 active swine and 2 registered farmers, agreeing with the assistant count.
- Anonymous `POST /api/assistant/chat`: JSON HTTP 401.
- Anonymous `GET /api/config/master`: JSON HTTP 401.
- Empty public assistant message: JSON HTTP 400.
- Unknown protected API: JSON HTTP 401, no HTML fallback.
- Real headless browser against the stable production domain: the chatbot returned HTTP 200, rendered its pig answer, and issued zero `/api/config/master` requests for an anonymous visitor.

These checks used real production provider/database responses, not intercepted browser fixtures. Authenticated production `POST /api/assistant/chat` and each role's configuration behavior are still not independently verified with live sessions: the saved demo credentials are rejected, and no accounts or passwords were changed. The real production logs identify the reported configuration caller as focal, for whom HTTP 403 is correct. A signed-in account check is still required; do not treat public API or isolated role-test success as proof of authenticated production behavior.

## Verification completed before release

- `npm run lint`: passed TypeScript checking.
- `npm run build`: frontend/PWA and both Node backend bundles passed; existing large-chunk warning remains.
- `npm test`: 162 passed, zero failed.
- Desktop/mobile Playwright: 12 passed, covering all four roles, delayed profile verification, absence of unauthorized configuration requests, authorized Super Admin fetch, assistant retry/minimize/reopen/refresh/duplicate prevention, and HTML API fallback recovery on the certificate page.
- Server role tests: admin/focal/agent receive JSON HTTP 403 for master configuration; Super Admin receives JSON HTTP 200.
- Existing assistant regressions verify zero counts, current read-only queries, focal scope, agent restrictions, database failures, JSON errors, and separate provider handling.
- `git diff --check`: passed.

The local saved demo credentials were rejected with HTTP 401 by production after including the required browser project identifier. They were not reset. Consequently authenticated production requests require a working authorized session/test credential. Role fixture tests do not replace that live verification. Production health and anonymous protected assistant requests returned valid JSON (200 and 401 respectively) before release.

## Environment

No remote environment values were changed. Required existing configuration:

- `GEMINI_API_KEY`: server-only provider credential.
- `GEMINI_MODEL`: optional override; new source default `gemini-flash-lite-latest`. An explicit override takes precedence.
- `DATABASE_URL`: existing Supabase PostgreSQL pooler connection.
- `DATABASE_SSL_CA`: optional existing CA PEM where needed for verified TLS.
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`: existing server authentication project.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`: matching browser project/publishable credentials.
- `SUPABASE_SECRET_KEY`: existing server-only application Auth Admin/Storage configuration; no new privileged key is needed by this fix.

The chatbot uses the existing PostgreSQL pool and application query functions, with trusted session role and assigned barangay restrictions. Supported record responses are freshly calculated; database errors are unavailable, never fabricated zero. General knowledge uses Gemini independently of having any registry rows. API keys, database credentials, and Supabase secret/service-role keys must never use a `VITE_` prefix or enter a browser bundle.

## Files changed in this repair

- `src/hooks/useRoleTheme.ts`
- `src/services/masterConfigService.ts`
- `src/services/masterConfigAccess.test.ts`
- `src/server/roleAuthorization.test.ts`
- `tests/browser/master-config-access.spec.ts`
- `docs/production-api-error-repair.md`

The production release also includes the already committed chatbot repairs from `e7809b4`; their complete file list and implementation details are in `docs/chatbot-functionality-repair.md`.
