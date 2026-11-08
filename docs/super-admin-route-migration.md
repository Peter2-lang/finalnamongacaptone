# Super Admin browser route migration

The canonical Super Admin dashboard URL is `/kamirani`. Existing Super Admin subpages now use `/kamirani/<page>`, and `/kamirani/dashboard` remains a supported dashboard alias. The database/Auth/RBAC identifier is `super_admin`; it has not been renamed to `kamirani` or changed in any way. No database records, roles, permissions, API endpoint identifiers, environment values, or UI designs were changed.

## Behavior

- `/kamirani` and its subpages wait for verified Supabase session restoration. A verified `super_admin` profile can render the existing dashboard/features; other signed-in roles see the existing access-denied view.
- An anonymous visitor at the new route sees the existing dedicated Super Admin sign-in screen. The dashboard is not mounted. Successful login still verifies the server profile and restores the requested new subpage.
- Refresh keeps the URL-selected module through the existing neutral session loader; it does not render or redirect to the landing page.
- Logout from the portal returns to `/kamirani` and clears the visible authenticated workspace.
- `/superadmin` and `/superadmin/<page>` redirect with `history.replaceState` only after a verified `super_admin` profile is available. The suffix, query, and fragment are preserved. Admin/focal/agent/anonymous visitors see access denied at the old URL; they are not automatically redirected.
- Route-prefix checks use exact path boundaries, so unrelated paths such as `/superadministrator` do not match the portal guard.
- Internal `/api/auth/superadmin-profile` and `/api/auth/superadmin-login` paths remain unchanged as part of the existing authentication API. All existing privileged API authentication/role enforcement remains in place.

As in the existing SPA architecture, browser route requests receive the common HTML shell. The portal gate renders the access-denied view after session verification; this is not an HTTP 301/302 or a new server-document 403. Protected APIs continue to return actual JSON 401/403 responses. An unconditional Vercel redirect would violate the requirement to redirect only authorized users, so none was added.

## Routing and hosting

Updated URL-to-tab mappings, all Super Admin navigation destinations, dedicated login/logout destinations, authenticated login fallback, route references in browser tests, and the startup smoke test. Shared pages such as `/records`, `/gis`, and existing non-Super-Admin routes are unchanged. Existing direct-tab aliases and all module permissions are preserved.

The existing Vercel extensionless-route rewrite already serves `/kamirani` and nested pages through `index.html`; no hosting rule change is necessary. A unit check verifies this and confirms no unconditional legacy redirect is configured.

## Verification

- Final `npm test`: 164 passed, zero failed.
- Final `npm run lint`: passed TypeScript checking.
- Final `npm run build`: frontend/PWA and both backend bundles passed; existing large-chunk warning remains.
- Final desktop/mobile browser run: 14 passed, zero failed.
- Standalone production and development server startup/deep-link/API JSON smoke checks passed.
- `git diff --check`: passed.
- Browser coverage includes direct navigation, refresh, all three unauthorized staff roles, anonymous old/new URLs, delayed profile verification, suffix/query/fragment preservation, logout, and dedicated login to a deep link. These tests use isolated Supabase/Auth/API fixtures rather than production account credentials.
- The existing Super Admin navigation smoke test is also run on desktop/mobile to check the renamed management URLs and preserved modules.

The first new test run used `layout` as the expected internal tab name; the existing module uses `layout_config`. That test expectation was corrected without changing the application module.

## Changed files

- `src/App.tsx`
- `src/components/auth/AuthModal.tsx`
- `src/utils/appRoutes.ts`
- `src/utils/appRoutes.test.ts`
- `scripts/smoke-startup.ts`
- `tests/browser/superadmin-route.spec.ts`
- `tests/browser/route-matrix.spec.ts`
- `tests/browser/session-language-assistant.spec.ts`
- `tests/browser/system.spec.ts`
- `docs/super-admin-route-migration.md`

## Release

The route implementation is committed as `5a79b03`. Production deployment and live anonymous route checks are recorded after release below. Authenticated production login/logout and authorized legacy redirect still require a working real Super Admin session; those flows were verified using isolated browser fixtures, not a live account.
