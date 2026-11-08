# Refresh and navigation restoration

Implementation commit: `166fc06e72c9cd75edae952cddd921852679a069`.

## Confirmed causes and changes

- Page imports and Suspense had no deadline; a stalled import could leave “Loading module...” indefinitely, and rejected React.lazy promises were retained. Imports now have a 20-second deadline, a scoped error boundary, fresh lazy components on retry, and explicit current-URL reload recovery. The closed batch import dialog no longer loads its large dependencies on every page.
- Startup saved the new build ID before comparing it to the saved ID. Build-change detection now runs first, with a once-per-build reload guard. Recovery removes only application precaches/legacy API cache and root service-worker registrations; it preserves sessions and unrelated storage.
- Query-bearing destinations could be treated as unknown paths and fall back to Dashboard. Path matching now excludes query/fragment while browser navigation and login return destinations retain safe context. Authentication verification finishes before workspace rendering. Ordinary expired protected sessions open login with an explanation; temporary verification failures offer retry.
- Module filters and pagination lived only in component memory. Validated primitive preferences now use URL parameters and identity-scoped, eight-hour session storage. Records, GIS, Certificates, and Dashboard retain applicable filters/selections; Records retains pagination and tag searches. Free-text farmer searches, rows, credentials, certificate drafts, and unsaved forms are not saved by this feature.
- An open record is represented only by its UUID. The dialog reopens only after a fresh successful authorized records fetch finds that UUID. Its existing dialog markup is portaled above the sticky header so Close remains usable.
- Read requests now have 25-second deadlines; mutations retain their existing behavior. Missing asset requests no longer receive the standalone server's HTML shell. The PWA navigation denylist also excludes module/JSON assets. Existing Vercel API/asset exclusions and `/superadmin` redirects already satisfy routing requirements and were preserved.

No schema, database records, server permissions, internal role names, or `/kamirani` access policies were changed. No additional application environment variables are required.

## Verification

- `npm test`: 170 passed.
- `npm run lint`: passed.
- `npm run build`: frontend and backend passed; existing large-chunk warnings remain.
- `npm run test:browser -- --config playwright.refresh.config.ts`: 12 passed against the compiled app on desktop/mobile. Cases cover direct navigation and refresh for Dashboard, Records, GIS, Certificates, `/kamirani` and a nested portal page; safe filters and real second-page pagination; authorized record-reference restoration; failed/stalled module recovery; Back/Forward; expired-session login.
- Production deployment `dpl_6acM8J5GEqfhhdneZutgFjxNt2VR` reached READY and was aliased to `https://lguhinunanganswineregistry.vercel.app` with implementation commit `166fc06`.
- Non-intercepted production checks passed on desktop and mobile with service workers enabled: homepage direct access/refresh, `/superadmin` HTTP 307 to `/` and homepage rendering, anonymous Records/GIS/Certificates to login with an explanation (including login refresh), anonymous `/kamirani` to homepage under its existing policy, missing JS asset 404 without the app shell, and protected `/api/config/master` JSON 401.
- Production browser fixture run: all 12 tests passed on desktop/mobile (2.0 minutes). Command: `REFRESH_PRODUCTION_URL=https://lguhinunanganswineregistry.vercel.app PLAYWRIGHT_SUPABASE_PROJECT=pxwjxrhkukonztmfczpm npm run test:browser -- --config playwright.refresh.config.ts`. This loads the actual deployed frontend/chunks and exercises direct navigation/refresh through Vercel, while intercepting Auth/API requests with isolated fixtures.

Browser fixture tests intercept authentication and API responses with isolated data. They verify routing and UI behavior, not actual production account sessions or database authorization. Real signed-in production refresh still requires a working authorized test session; no account credentials were changed and no records were written.

## Changed files

```text
playwright.refresh.config.ts
server.ts
src/App.tsx
src/components/auth/AuthModal.tsx
src/components/certificate/CertificateManager.tsx
src/components/common/ErrorBoundary.tsx
src/components/common/ModuleBoundary.tsx
src/components/dashboard/Dashboard.tsx
src/components/gis/GisMap.tsx
src/components/records/PigsRecords.tsx
src/hooks/usePagePreference.test.ts
src/hooks/usePagePreference.ts
src/main.tsx
src/services/api.ts
src/services/http.ts
src/services/readFetch.ts
src/services/storageService.ts
src/services/swineApi.ts
src/utils/appRoutes.ts
src/utils/buildMetadata.test.ts
src/utils/buildMetadata.ts
src/utils/chunkLoadRecovery.ts
src/utils/moduleLoading.test.ts
src/utils/moduleLoading.ts
tests/browser/refresh-restoration.spec.ts
tests/browser/support/sessionFixture.ts
vite.config.ts
docs/refresh-restoration-verification.md
```
