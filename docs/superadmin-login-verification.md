# Super Admin entry login

The previous route guard sent all visitors without a verified Super Admin profile away from `/kamirani`, including signed-out visitors. The existing `SuperAdminAuth` component was not mounted by the application.

The entry route now displays that existing form after session restoration finishes. The form uses the existing Supabase sign-in flow and the server's `/api/auth/superadmin-profile` check. Only a verified active `super_admin` application profile opens the existing dashboard. Authenticated Super Admin sessions and authorized deep links retain their prior behavior. Other authenticated roles continue to be redirected to the public homepage when requesting Super Admin routes, with their own sessions preserved. Nested protected routes keep their existing access rules.

The `/superadmin` redirects, public navigation, public Official Login, server authorization, database records, internal roles, and existing form/dashboard designs are unchanged. No new environment variables are required.

## Checks

- Production frontend/backend build passed as part of the compiled-app Playwright run; existing bundle-size warnings remain.
- `npm run lint`: passed.
- `npm test`: 170 passed outside the sandbox. The initial sandbox run could not bind localhost servers (`EPERM`); the unrestricted rerun passed.
- `node --import tsx --test src/server/app.test.ts`: passed, including `/api/auth/superadmin-profile` rejecting a spoofed role header without a verified bearer session.
- `npm run test:browser -- --config playwright.superadmin.config.ts`: 22 compiled-app tests passed on desktop/mobile, covering dedicated sign-in and profile rejection, dashboard/deep-link refresh, logout, anonymous login refresh, legacy redirects, and public login for all existing roles. Deployed verification follows below.

Browser authentication/API fixture tests are isolated from real accounts and records. Actual production credential acceptance requires a working authorized account and was not verified by fixture tests. No credentials were reset and no records were created.

## Production verification

- Implementation commit `a3db4807a22634394d96d26b0c3990d709ffea70` was deployed as `dpl_CAaC6u7wSC83yqqPJ5xyu9NnQSjq`, reached READY, and was aliased to `https://lguhinunanganswineregistry.vercel.app`.
- Non-intercepted desktop/mobile checks passed with service workers enabled: `/kamirani` shows the existing login form on direct navigation and refresh, no protected workspace is rendered, Return to Public Portal opens the landing page, `/superadmin` returns HTTP 307 to `/`, public Official Login opens, and both `/api/auth/superadmin-profile` and `/api/config/master` return JSON 401 without an authorized bearer session even with a spoofed role header.
- All 22 deployed frontend regression tests passed on desktop/mobile (2.4 minutes), using `REFRESH_PRODUCTION_URL=https://lguhinunanganswineregistry.vercel.app PLAYWRIGHT_SUPABASE_PROJECT=pxwjxrhkukonztmfczpm npm run test:browser -- --config playwright.superadmin.config.ts`. This serves actual production HTML/JavaScript and intercepts Auth/API responses with isolated fixtures; it does not verify real production credentials.

## Changed files

```text
src/App.tsx
src/utils/appRoutes.ts
src/utils/appRoutes.test.ts
src/server/app.test.ts
tests/browser/superadmin-route.spec.ts
playwright.superadmin.config.ts
docs/superadmin-login-verification.md
```
