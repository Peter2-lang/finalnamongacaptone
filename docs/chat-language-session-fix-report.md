# Chatbot, shared language, and refresh fixes

## Scope and status

Implemented directly in the existing application. No database migrations, record mutations, role changes, deployment, or unrelated styling changes were performed. Common interface localization now covers 301 additional phrases alongside the existing keyed dictionaries, and all 41 missing literal translation keys found by the new audit have entries in English, Cebuano, and Filipino. Full translation coverage remains incomplete: the static JSX audit currently flags 2,755 distinct phrases for review, including specialized administration, legal, certificate, and report copy. This is not a claim that every screen is fully translated.

## Root causes found

- The old chatbot intercepted most natural-language requests with fixed keyword replies. A question about new records today could receive a total-registry summary without a date filter. Both backend routes discarded the supplied conversation history and language. Their AI fallback referenced a fixed `gemini-3.8-flash` model and silently substituted generic responses on failure.
- Neither the old client nor server rejected a provider response that repeated the question. The browser send lock depended on asynchronous React state, and conversations were not reset after an already-interacting user changed identity. No direct assignment of user input to the assistant reply was found; the exact deployed echo symptom was not reproduced against a live model.
- `currentRole` initialized as landing, and only Super Admin URLs had an authentication-loading gate. Normal protected routes therefore mounted the landing page before restoration finished. `activeTab` started at dashboard, several supported paths were absent from the startup route map, and some navigation callbacks changed tabs without changing the URL.
- Translation resolution was duplicated between the context and service. Many static labels bypassed translation, built-in form definitions rendered raw English labels, and the public header lacked a shared three-language selector. Existing dictionary parity tests did not detect hardcoded interface copy.

## Chatbot implementation

`assistantEngine.ts` reuses the installed server-only `@google/genai` provider. It supplies validated user/model history, the preferred language, read-only function declarations, and scoped tool results to the model. `GEMINI_MODEL` can override the documented `gemini-flash-latest` default. Replies that are empty or identical to the question are rejected.

`query_registry` supports active swine totals, Philippine-calendar registrations for today/week/month, ready-to-sell counts, barangay distributions, classifications, ASF zones, registration trends, the actual farmer-table count, and stored biosecurity audit compliance summaries. Week starts Monday. Periods use half-open UTC boundaries derived from Asia/Manila. Swine registrations use `registered_at`, with the stored creation timestamp as the legacy mapping fallback; `updated_at` is never used as a new-registration date. Missing dates no longer become today's date.

Authorization is derived from the existing verified backend session, never request-body roles or assignments. Database swine queries include focal barangay/agent ready/archival restrictions before rows are summarized, with defense-in-depth filtering afterward. Farmer counts use fixed parameterized SQL; audit scope is checked before aggregation. Guests cannot invoke private queries. Agents cannot retrieve farmer or biosecurity audit metrics. Only aggregate data reaches the model. Tool failure yields unavailable data, not a fabricated zero. No SQL or mutation tool is exposed, and no RLS configuration or constraints were changed.

`open_page` offers authorized navigation buttons without changing records. Existing explicit Super Admin configuration previews and their confirmation flow are preserved separately from the read-only AI tools.

The client sends language and bounded history, times out requests, validates reply shape, prevents duplicate sends with a synchronous ref, uses unique message IDs, ignores late responses after clearing or changing users, and provides New Chat / Clear Conversation. The assistant is keyed by verified user, role, and barangay scope. Bounded same-tab sessionStorage history survives refresh, expires after eight hours, and is cleared on sign-out. Pending configuration actions are excluded from saved conversation state. Offline mode provides explicit navigation help and does not present cached statistics as live figures.

## Translation implementation

One `resolveTranslation` function now governs fallback and interpolation for both hooks and the legacy service. Language updates set the document language, persist to localStorage, and synchronize between tabs. Hook consumers outside a provider also subscribe safely.

`interfaceLabels.ts` adds Cebuano and Filipino entries for 301 common phrases. `InterfaceText` emits only a text node and subscribes to shared language state; it does not mutate the DOM or remount forms. Static-label replacements span landing, authentication, GIS, registration, records/import, takeoff, biosecurity, legal, messaging, certificates, and administration modules. Built-in registry labels and core validation messages use localized display text, while field identifiers, entered values, custom labels without explicit translations, and stored records are preserved.

The header and existing sidebar share the same en/ceb/fil state. Public navigation and welcome/error/loading messages have shared keys. The unused landing-only language state was removed, and the standalone landing navigation component also uses the shared context.

`npm run i18n:audit` writes the remaining static-copy inventory. `npm run i18n:check` deliberately fails while unresolved copy remains. Existing dictionary parity and new catalog/fallback assertions run in `npm test`. The audit also checks literal `t(...)` calls against the English catalog. The static JSX audit does not prove coverage of programmatic report strings or all data-driven CMS/form definitions; those require additional review.

## Routing and sessions

`appRoutes.ts` maps existing canonical and alias URLs, including `/add_swine` and administrative paths. The URL selects the initial tab before authentication resolves. Every route waits for verified session restoration behind a neutral status view. A temporary verification/network failure offers retry instead of rendering public content as a placeholder. Invalid sessions return to login and retain the requested path for post-login handling; existing authorization guards still apply. Sign-out clears the current identity. Internal navigation callbacks now update browser history along with the tab, and popstate continues to restore the tab.

The existing Supabase persisted session and automatic token refresh remain enabled. The profile request and overall restoration are bounded by timeouts. Temporary profile/provider-network failures preserve the session and show retry; only invalid/forbidden profiles clear authentication. No unverified localStorage profile is used to authorize the initial render.

## Verification

The new desktop/mobile browser suite passed all 12 tests on its initial full run: four roles with delayed verification and repeated refreshes, route/language retention without landing flash, modal language switching, preservation of registration input, chatbot history/language payloads, clear conversation, and provider failure UI. These browser tests intercept APIs and never call the billable provider.

Final checks:

| Check | Result |
| --- | --- |
| `npm run lint` / TypeScript | Passed |
| `npm test` | 110 passed, zero failed |
| `npm run build` | Frontend and both backend bundles passed; existing chunk-size warning |
| Selected browser suites: system, GIS regression, Google adapter, session/language/assistant | 73 passed, 3 intentional platform skips, zero failed |
| Focused correction rerun | 9 passed, 1 intentional mobile duplicate skipped |
| `git diff --check` | Passed |
| `npm run i18n:check` | Fails intentionally: 0 missing literal keys, 2,755 static phrases awaiting review |

The three final browser skips are desktop touch/pinch, mobile mouse wheel, and the mobile duplicate of the desktop full import/edit/export journey. The final complete browser run took 9.8 minutes.

Earlier attempts exposed a stale placeholder selector, an edit-navigation ordering regression, and Chromium target crashes during concurrent browser runs. The selector now uses the field's stable accessible ID; the edit record is assigned after navigation clears a registration draft. The corrected scenarios and the final sequential complete suite passed. A separate conversation-refresh failure did not recur in the isolated corrected run or the final complete run. Initial sandbox runs could not bind local test-server ports; permitted reruns used isolated local fixtures outside that restriction. Unit/API tests use deterministic provider adapters and PostgreSQL protocol fixtures. No production database records were changed. No patched live-model success is claimed: `GEMINI_API_KEY` is absent from this workspace. Vercel variable metadata confirms that `GEMINI_API_KEY` is already configured for Production and Preview; no values were decrypted or changed. A public read-only test question to the current deployed assistant (before deploying this patch) returned a generic greeting rather than a pig definition.

## Required environment

- `GEMINI_API_KEY`: server-only Gemini credential for real model responses. Never prefix with `VITE_`.
- `GEMINI_MODEL`: optional model override; documented default is `gemini-flash-latest`.
- Existing backend database and Supabase authentication configuration, plus the existing browser publishable Supabase URL/key, remain required and unchanged.

## Remaining work / limits

- Literal translation-key gaps are now zero. Review and translate the phrases listed in `docs/audits/interface-translation-gaps.json`, plus remaining programmatic/CMS copy. Full system-wide translation is not complete.
- Verify the configured provider with a real server-side key and authorized live database after deployment. The local workspace lacks a key; Vercel metadata confirms the key name is configured for Production and Preview. Its validity and the patched provider path still need verification after deployment.
- Browser tests exercise representative protected routes for each role; every route alias is unit-tested, but not every module/role combination has a full browser refresh scenario.
- Vite's existing large-chunk warning remains.

## Exact files changed

- `.env.example`
- `docs/audits/interface-translation-gaps.json`
- `docs/audits/translation-key-gaps.json`
- `docs/chat-language-session-fix-report.md`
- `package.json`
- `scripts/audit-translations.mjs`
- `scripts/localize-interface.cjs`
- `src/App.tsx`
- `src/components/account/UserAccountView.tsx`
- `src/components/admin/ApiConfiguration.tsx`
- `src/components/admin/BarangayBiosecurity.tsx`
- `src/components/admin/ManageAccounts.tsx`
- `src/components/admin/ManageBarangays.tsx`
- `src/components/admin/ManageLandingPage.tsx`
- `src/components/admin/ManageRegistryForms.tsx`
- `src/components/admin/MasterConfigHub.tsx`
- `src/components/admin/RegistryFormCustomizer.tsx`
- `src/components/admin/SidebarColorConfig.tsx`
- `src/components/admin/landing/LandingCmsHeader.tsx`
- `src/components/admin/landing/tabs/AboutTab.tsx`
- `src/components/admin/landing/tabs/BackgroundPhotoTab.tsx`
- `src/components/admin/landing/tabs/ContactTab.tsx`
- `src/components/admin/landing/tabs/FeaturesTab.tsx`
- `src/components/admin/landing/tabs/FooterTab.tsx`
- `src/components/admin/landing/tabs/GalleryTab.tsx`
- `src/components/admin/landing/tabs/GeneralTab.tsx`
- `src/components/admin/landing/tabs/HeroTab.tsx`
- `src/components/admin/landing/tabs/LegalDocumentsTab.tsx`
- `src/components/admin/landing/tabs/MediaLibraryTab.tsx`
- `src/components/admin/landing/tabs/PageBuilderTab.tsx`
- `src/components/admin/landing/tabs/SocialMediaTab.tsx`
- `src/components/admin/landing/tabs/StatisticsTab.tsx`
- `src/components/admin/landing/tabs/VideoMediaTab.tsx`
- `src/components/admin/media/InsigniaCard.tsx`
- `src/components/admin/media/InterfaceBackgroundConfig.tsx`
- `src/components/admin/media/LogoConfiguration.tsx`
- `src/components/admin/media/PhotoMediaSettings.tsx`
- `src/components/agent/AgentAccountView.tsx`
- `src/components/agent/AgentCatalog.tsx`
- `src/components/asf/ASFOrdinanceModule.tsx`
- `src/components/asf/LegalDocumentComboBox.tsx`
- `src/components/asf/LegalDocumentEditModal.tsx`
- `src/components/asf/LegalDocumentOriginalViewerModal.tsx`
- `src/components/asf/LegalDocumentPrintView.tsx`
- `src/components/asf/LegalImportHistoryModal.tsx`
- `src/components/asf/LegalLocationalTable.tsx`
- `src/components/asf/LegalSmartImportModal.tsx`
- `src/components/assistant/BiosecurityAssistant.tsx`
- `src/components/auth/AuthModal.tsx`
- `src/components/certificate/BarangayCertificateView.tsx`
- `src/components/certificate/CertificateLogoCustomizer.tsx`
- `src/components/certificate/CertificateManager.tsx`
- `src/components/certificate/CertificateTemplateEditor.tsx`
- `src/components/certificate/CreateCertificateModal.tsx`
- `src/components/certificate/TransmittalLetterManager.tsx`
- `src/components/common/BackupModal.tsx`
- `src/components/common/Header.tsx`
- `src/components/common/Sidebar.tsx`
- `src/components/common/SyncCenterModal.tsx`
- `src/components/dashboard/Dashboard.tsx`
- `src/components/dashboard/SwineFarmRegistrationModal.tsx`
- `src/components/gis/BarangayBoundaryMap.tsx`
- `src/components/gis/GisMap.tsx`
- `src/components/gis/GoogleGisMap.tsx`
- `src/components/landing/LandingHeaderNav.tsx`
- `src/components/landing/LandingPage.tsx`
- `src/components/marketing/SwineMarketingAlerts.tsx`
- `src/components/messaging/MessagingCenter.tsx`
- `src/components/records/ImportSwineModal.tsx`
- `src/components/records/PigsRecords.tsx`
- `src/components/registry/SwineForm.tsx`
- `src/components/registry/SwineMatrixModal.tsx`
- `src/components/takeoff/SwineTakeoffManager.tsx`
- `src/context/LanguageContext.tsx`
- `src/db/swine.ts`
- `src/i18n/ceb.ts`
- `src/i18n/en.ts`
- `src/i18n/fil.ts`
- `src/i18n/index.test.ts`
- `src/i18n/index.ts`
- `src/i18n/interfaceLabels.ts`
- `src/i18n/interfaceText.tsx`
- `src/i18n/registryLabels.ts`
- `src/server/app.ts`
- `src/server/assistantEngine.test.ts`
- `src/server/assistantEngine.ts`
- `src/server/roleAuthorization.test.ts`
- `src/services/api.ts`
- `src/services/assistantConversation.test.ts`
- `src/services/assistantConversation.ts`
- `src/services/assistantService.ts`
- `src/services/languageService.ts`
- `src/utils/appRoutes.test.ts`
- `src/utils/appRoutes.ts`
- `tests/browser/session-language-assistant.spec.ts`
- `tests/browser/support/sessionFixture.ts`
