# Production schema repair: Nov 4, 2026

## Verified user-provided live evidence

Supabase `users.permissions` is the next missing column in the public API health check (SQLSTATE 42703). Earlier SQL Editor inspections showed `users.auth_user_id` had subsequently been created; the same live database reported `swine_records.age_months` INTEGER, `birth_date` DATE, `price_estimate` NUMERIC and `created_at` TIMESTAMPTZ. `system_settings.updated_at` is TIMESTAMPTZ. Earlier `issued_certificates.id` was TEXT, which **already matches the current ORM**. The health status was not_ready.

## Proposed code improvements

- Drizzle maps swine DATE, INTEGER, NUMERIC and TIMESTAMPTZ to the real observed column types without changing production tables.
- Swine write serialization sends integer months and calendar dates, preserving unknown values as NULL instead of empty text.
- A review-only SQL patch adds only `users.permissions` as JSONB with empty permissions by default, and retains existing rows and policies. `[]` conveys no custom permissions; it is not an admin-role grant.
- A one-result read-only full runtime gap report enumerates required schema columns from the repository instead of reporting only the first 42703.

## Rollout steps

1. Verify that the SQL Editor is targeting the **same Supabase database/project** as Vercel `DATABASE_URL`. Backup before any DDL.
2. Run `supabase/diagnostics/08_all_schema_gaps_one_result.sql` and save the `all_schema_gaps` JSON. Compare with `supabase/diagnostics/01_required_schema_inventory.sql`, actual table constraints and RLS policies. This report checks columns/types and the tag sequence, **not** required indexes, foreign keys, auth links, triggers, full write viability or backend privilege access. The report is derived from the code contract, not guaranteed live truth.
3. Only if `users.permissions` is still missing, approve and manually run `supabase/review/202611040006_add_users_permissions_nullable.sql`. This patch is additive and repeatable. Check whether `users.permissions` is an array for every existing profile; preserve authorization and never invent auth IDs or roles.
4. Resolve any remaining report items separately with a reviewed migration or a code-level mapping, especially legacy `users` constraints/relationships and `swine_tag_seq`. **Do not blindly change existing UUID IDs, unique keys, role mappings, RLS or timestamps.**
5. On a preview/staging environment using Node 22, run `npm ci`, `npm run lint`, `npm test`, `npm run build`. No tests have been executed by this GitHub connector-only change; verify before merging.
6. Deploy preview and check `/api/health`; require HTTP 200, connected, schema ready and Auth available. Verify authorized user login, disabled-account rejection, registry create/read/update, certificate generation, normalized settings updates and offline sync before production deployment.

**Limit:** This repository branch does not access the production Supabase catalog, run production SQL, or deploy Vercel. Missing 42703 errors are not guaranteed resolved until reviewed scripts and code are deployed and validated.
