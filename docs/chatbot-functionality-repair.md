# DA Hinunangan chatbot repair

Implemented in the existing Express/Vite chatbot. No production deployment, database migration, record mutation, or unrelated feature replacement was performed.

## Confirmed failure and repair

A read-only production request to `/api/public/assistant/chat` returned HTTP 503 / `provider_unavailable`. Vercel logs showed that the protected focal request had passed authentication before the assistant failed. A private server-side probe using the configured Gemini credential reproduced HTTP 504 / `DEADLINE_EXCEEDED` with `gemini-flash-latest`. The credential successfully listed models and generated a real answer using `gemini-flash-lite-latest`. The default now uses that accessible lightweight model, with `GEMINI_MODEL` still available as a server override. Three real requests through the repaired full assistant engine returned nonempty answers for `What is a pig?`, `Unsa ang ASF?`, and `Ano ang swine biosecurity?`. No key values were printed or written into source files.

The previous engine required Gemini before every registry query. This coupled database availability to provider availability. Supported record questions now resolve to bounded read-only queries before provider initialization. Provider timeouts and quota failures have specific recoverable messages. Unknown questions retain the existing read-only model tools, legal-document retrieval, application navigation, and Super Admin configuration preview flow.

The client previously converted request failures into ordinary replies, with no retry state, and used a single-line input. It now distinguishes failures, retries the original request without duplicating the user message, rejects HTML API fallback responses, and accepts Enter / Shift+Enter. X and Minimize return to the circular launcher, preserving the conversation. The panel uses a 400px desktop width, independently scrolling messages, visual-viewport keyboard handling, touch scrolling, and safe mobile offsets above bottom controls. Existing modal z-index behavior and branding are preserved.

## Live records and access

The existing server PostgreSQL pool and Drizzle swine reader are reused. The database schema was inspected through the Supabase connector. Fixed parameterized SQL reads `farmers`, `issued_certificates`, and the barangay directory; the existing swine reader applies archive, focal barangay, and agent ready-to-sell predicates before retrieval. Defense-in-depth filtering checks the resulting records again. Today/week/month boundaries use Asia/Manila; weeks start Monday. Swine activity uses `registered_at`; farmer and certificate activity use `created_at`.

Supported direct questions cover swine totals, today/week/month registrations, named barangays, ready-to-sell swine, farmers, issued certificates, archived swine, latest five swine, barangay summaries including zero counts, and stored ASF/biosecurity assessments. Latest swine responses omit farmer names, contacts, and personal details. ASF answers use the latest approved nonarchived assessment per barangay and identify a missing assessment as unavailable; they do not infer a disease diagnosis from a swine record's default zone. Complex classifications continue through the existing AI query tool.

Authorization comes from the verified backend session and current database profile, never body/header role or barangay claims. Admins and Super Admins retain municipality scope. Focal users are restricted to their assigned barangay and receive HTTP 403 for recognized cross-barangay requests. Agents receive only nonarchived ready-to-sell swine and cannot query farmer, certificate, archive, or assessment data. Unknown/inactive profiles are blocked by the existing middleware. Public users retain only the existing published aggregate tool.

A successful zero-count query returns exactly `Currently, there are 0 registered swine records.` for an English municipality-wide total. Database failures return HTTP 503, never zero. Database answers are marked as database queries with timestamps; model replies are marked AI. Each new question re-queries data. Existing session conversation memory is bounded, identity-scoped, and cleared on sign-out.

Read-only checks found 0 nonarchived swine, 0 archived swine, 2 active nonarchived farmers, and 0 issued certificates in the matching Supabase database. Production's public registry endpoint independently returned 0 active swine, 2 farmers, and 40 barangays. These are observations at repair time, not hardcoded application values.

Both chatbot routes already existed in the Vercel Express launcher. API rewrites, JSON 404 handling, PWA API `NetworkOnly` handling, and navigation fallback exclusion for `/api` were already correct and were preserved. Responses are `no-store`; the client uses a 55-second timeout, provider requests use a 20-second timeout without SDK retries, and the existing database pool bounds connections/statements. The existing 20-request-per-minute limiter remains per warm server instance, not a distributed global quota. Logs contain fixed error categories, numeric provider status, and the configured model name, without raw provider payloads or credentials.

## Environment

- `GEMINI_API_KEY`: required server-side Gemini credential for general AI replies.
- `GEMINI_MODEL`: optional server-side override; new default `gemini-flash-lite-latest`. An explicit override takes precedence.
- `DATABASE_URL`: existing production Supabase PostgreSQL pooler connection.
- `DATABASE_SSL_CA`: existing optional trusted CA PEM when required by the database endpoint.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: existing server authentication project configuration; must match the browser project.
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`: existing browser authentication configuration; publishable credentials only.
- `SUPABASE_SECRET_KEY`: existing server-only Auth Admin/Storage configuration used elsewhere in the application; the chatbot does not require a new privileged key.

Never prefix AI credentials, PostgreSQL credentials, or a Supabase secret/service-role key with `VITE_`. No environment values were changed remotely.

## Verification

- Final `npm test`: 160 passed, zero failures.
- Final chatbot/role API regression suite: 27 passed, including the two added cases, scoped SQL, cross-barangay HTTP 403, spoofed role rejection, provider errors, zero data, and missing ASF assessments.
- Final `npm run lint` / TypeScript: passed.
- Final `npm run build`: frontend, PWA, standalone backend, and Vercel backend passed; existing large-chunk warnings remain.
- Real provider probes: default model deadline reproduced; lightweight model and all three full-engine language requests succeeded.
- Read-only production database and public-summary checks succeeded. No production write tests were performed.
- `git diff --check`: passed.
- Browser checks: 16 passed across the desktop/mobile session, language, and assistant suite; 4 additional final chatbot tests passed across desktop/mobile, including HTML fallback recovery on the certificate page. Browser API responses are isolated fixtures; they do not substitute for the separate real-provider and real-database probes.

After deployment, verify authenticated chatbot requests with real accounts for all four roles, the actual Vercel runtime provider path, certificates/printing, and a physical mobile keyboard. Local automated browser tests exercise desktop/mobile viewport behavior but cannot prove every device keyboard. Arbitrary free-form model responses still depend on Gemini availability; supported direct record questions do not. A production deployment is required before the public site receives these source changes.

## Modified files

- `.env.example`
- `docs/chatbot-functionality-repair.md`
- `src/components/assistant/BiosecurityAssistant.tsx`
- `src/index.css`
- `src/server/app.ts`
- `src/server/assistantEngine.ts`
- `src/server/assistantEngine.test.ts`
- `src/server/assistantErrors.ts`
- `src/server/assistantErrors.test.ts`
- `src/server/assistantLiveRecords.test.ts`
- `src/server/assistantRegistryIntent.ts`
- `src/server/roleAuthorization.test.ts`
- `src/services/assistantConversation.ts`
- `src/services/assistantService.ts`
- `tests/browser/chatbot-functionality.spec.ts`
- `tests/browser/session-language-assistant.spec.ts`
