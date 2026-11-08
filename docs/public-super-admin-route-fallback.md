# Public homepage fallback for retired/unauthorized portal URLs

This change supersedes the earlier legacy-route authorization notice. The existing landing-page component, images, navigation, hero, buttons, footer, and styling are reused without redesign.

## Current behavior

- `/superadmin` and `/superadmin/<page>` always redirect to `/`, including for a signed-in Super Admin. Vercel has temporary document redirects; the SPA also handles client-side/previously loaded navigation with history replacement.
- `/kamirani` and its nested pages remain available to a verified `super_admin` profile. This is the existing internal database/Auth/RBAC identifier; it was not changed.
- Anonymous and non-Super-Admin visits to `/kamirani` redirect to `/` after session verification. They render the normal public homepage rather than either the custom 403 notice or dedicated portal login screen.
- No protected workspace is rendered during verification or while a redirect is pending. Prefix checks use path boundaries. Redirects do not expose the new portal path in an error message.
- Public-page presentation is separate from the authenticated identity. Existing staff sessions and role-specific dashboards remain usable after the homepage fallback; no sign-out or role mutation is used to render public content.
- Verified Super Admin accounts can use the existing Official Login form. The server's existing login/profile verification remains authoritative, and successful login routes the Super Admin to `/kamirani`. This avoids locking out those accounts when anonymous portal URLs must redirect to the homepage. No new sign-in page or role choice was added.
- Logging out returns to `/`.

The Super Admin API endpoints, JSON 401/403 responses, internal role names, database permissions/RLS, records, and other modules were not changed. There are no new environment variables.

## Verification

- `npm test`: 164 passed, zero failed, including route policy and existing API authorization tests.
- `npm run lint`: TypeScript passed.
- `npm run build`: frontend/PWA and both backend bundles passed; existing large-chunk warning remains.
- Browser suite: all 20 scenarios passed across the completed runs (18 passed in the initial run; the two resource-affected desktop cases both passed on rerun). It covers the normal homepage, old/new unauthorized URL fallback and refresh, header/hero/footer presence, absence of portal notices/restricted content, staff session retention, authorized Super Admin dashboard and deep links, Official Login, logout, and the existing navigation smoke test for every role on desktop/mobile.

The initial browser run, concurrent with the heavy build/unit suite, had one Chromium target crash and one slow development-module load. Both affected cases passed when rerun after those checks finished; the initial failures are retained in the verification history.

Browser authentication tests use isolated API/Supabase fixtures. A real Super Admin session is still needed to independently verify authenticated production login and dashboard access; no account/password changes were made to obtain a test session.

## Files changed

- `src/App.tsx`
- `src/components/auth/AuthModal.tsx`
- `src/utils/appRoutes.ts`
- `src/utils/appRoutes.test.ts`
- `tests/browser/superadmin-route.spec.ts`
- `vercel.json`
- `docs/public-super-admin-route-fallback.md`

## Release and production checks

Recorded after the tested source is deployed.
