# Public landing data and assistant repair

## Root causes

The landing page treated zero as missing and substituted CMS/demo population values. CMS statistics bypassed real calculations entirely. Barangay cards used sample populations, names, phone numbers and a default Green zone. Top 15 was a fixed list. The detail modal also asserted clearance without evidence. A separate surveillance block asserted all-Green municipal status, zero outbreaks and three checkpoints; the legal banner hardcoded setback distances and fines. These unsupported assertions now use actual aggregates, No Verified Data, or references to verified source text. The chatbot reused panel coordinates for its launcher and had conflicting Escape handlers.

## Data contract

`GET /api/public/registry-summary` is a public, read-only, no-store aggregate endpoint. Its single PostgreSQL statement in `src/server/publicRegistry.ts` reads committed Supabase records using the existing server connection; no table grants, credentials or new schema migrations are required.

- Covered barangays: configured `barangays` rows, independent of submitted swine.
- Farmers: distinct active, nonarchived `farmers.id`; repeated swine references do not affect this number.
- Swine: nonarchived records, with `is_active` honored where present, excluding sold/deceased status (case insensitive).
- Ready to sell: the same eligible swine with `ready_to_sell = true`.
- Ranking: population descending, then barangay name ascending; only positive populations enter Top 15. All Barangays includes configured zero-population rows. Static official names remain available during database errors, with unavailable counts.
- Assessments: latest valid explicitly approved, nonarchived assessment per barangay in `system_settings.biosecurity_audits`, ordered by assessment date and ID. Checklist scores and classification are recomputed using existing server validation. Unapproved legacy assessments are not silently approved.
- Compliance: compliant latest approved assessments / latest approved assessments × 100, rounded to one decimal. Existing classification requires Green ASF zone and checklist score at least 80%; coverage is displayed separately. No approved assessments means `null`, displayed as Not Yet Available.
- Focal names: active assigned focal profiles only. No profile phones, farmer identities, auditor names, notes or raw assessment payloads are returned publicly. There is no configured publication-consent field for focal numbers, so these remain Not published.

Admin/Super Admin can explicitly approve assessments in the existing audit editor. Changed focal submissions revert to draft. Public statistics and published CMS configuration refresh every 30 seconds and on window focus; failures show Unavailable rather than zero or stale numbers.

The assistant can query this same public aggregate endpoint logic and allowlisted published CMS office fields. Existing legal-source verification remains enforced. Contacts/services/registration requirements without verified sources require administrator verification.

## Chatbot

Launcher uses fixed bottom/right positioning with safe-area insets. Close and Escape dismiss the panel and reset panel position; messages are retained by existing session handling. Minimize retains the compact panel header. Removed launcher dragging and duplicate Escape handler. Header buttons do not propagate drag events. Mobile panel height responds to dynamic viewport and visualViewport keyboard resize.

## Contact audit

Unverified default office address, hours, email, phones, emergency footer links and Facebook URLs are withheld or marked Pending administrator review. Removed the default all-Green announcement claim and sample statistic values. Existing explicitly published CMS content remains the administrator-controlled publication source and needs administrator review for legacy contact accuracy; no production content was modified by this repair.

## Read-only live verification

Production public JavaScript identifies Supabase project `pxwjxrhkukonztmfczpm`. On 2026-11-08 the actual aggregate query returned 40 barangays, 2 active farmer identities, 0 eligible active swine, 0 ready-to-sell swine. One saved assessment exists, with 0 explicitly approved assessments. No production fixture records were created or changed.

## Validation and deployment

`npm run lint` and `npm run build` passed; all 149 unit tests passed. Desktop and mobile landing regressions passed. See the final task response for preview URL/status. Tests use isolated fixtures and cover public endpoint authorization/privacy, real-zero projection, assessment approval/validation, database failures, ranking/search/zone filters, all 40 cards, CMS updates, refresh, and desktop/mobile chatbot lifecycle and launcher position. `npm run lint` performs TypeScript checking in this repository.
