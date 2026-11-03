# Reviewed Supabase schema expansion through SQL Editor

## Status and release gate

The application connects to PostgreSQL but fails its read-only schema contract. Runtime initialization intentionally rejects with `SCHEMA_INITIALIZATION_DISABLED`; neither Drizzle declarations nor a Vercel redeploy creates missing database objects. Historical migrations are incomplete for current runtime tables and contain incompatible legacy conversions. `CREATE TABLE IF NOT EXISTS` cannot repair an existing table's columns.

No production database credentials or catalog export are available in this workspace. The exact live delta is therefore **not verified**. These files cover the confirmed missing auxiliary tables and four previously reported columns, not every possible production discrepancy. No production migration, seed, permission change or deployment has been executed. Existing primary keys, foreign keys, accounts, data and policies must remain intact.

## 1. Capture the actual catalog and approve the delta

In the correct Supabase project's SQL Editor, use an authorized migration operator. Save a recoverable database backup and deployment commit. Run and save all result sets and notices from these **read-only** scripts:

1. `supabase/diagnostics/01_required_schema_inventory.sql`: every required column with actual type/default/nullability, table inventory, constraints, indexes, sequences, RLS and policies.
2. `supabase/diagnostics/02_backfill_readiness.sql`: aggregate compatibility/backfill readiness.
3. `supabase/diagnostics/03_identifier_relationship_audit.sql`: aggregate identity and relationship checks. It does not expose record values or cast historical IDs to UUID.
4. `supabase/diagnostics/04_migration_history_and_role.sql`: indexes and existing Supabase, Drizzle and private migration history metadata. Missing tracking relations produce notices.

Inventory must include owner-level metadata and access through the actual backend role. The SQL Editor's `current_user` is not proof of Vercel's role. With the Vercel project's `DATABASE_URL` configured privately in a trusted shell, `npm run db:inspect` uses that connection and reports its database role/name and schema findings without writing. Do not paste credentials into SQL files, issues, browser variables or command arguments. Keep generated reports private.

Compare the catalog with `src/db/requirements.ts`, `schema.ts`, `legalDocuments.ts` and `docs/repository-schema-comparison.json`. Stop on TEXT/UUID or SERIAL/UUID conflicts, extra mandatory columns, unknown account mappings, incompatible defaults or FKs. Preserve actual IDs; these scripts never convert PKs. Existing partial legal/message tables may need additional catalog-specific nullable columns or a query adapter. Generate and review a separate minimal migration for such findings. Do not loosen constraints or guess backfill values to pass health.

## 2. Review the exact six payloads

| Order | Source in `supabase/review/` | Effect |
| --- | --- | --- |
| 1 | `202611030000_create_private_migration_receipts.sql` | Private, forced-RLS receipt ledger. Existing conflicting ledger ownership/security fails closed. |
| 2 | `202611030001_create_missing_runtime_tables.sql` | Creates only absent `issued_certificates`, `messages`, `media_files`, `registry_schema`, `legal_documents`, `legal_document_audit_logs`. Existing tables and their OIDs/data/security are skipped. New objects start empty with forced RLS and browser grants revoked. |
| 3 | `202611030002_add_confirmed_runtime_columns.sql` | Adds nullable TEXT `issued_certificates.control_number`, `media_files.file_url`, `messages.sender_id`, `registry_schema.field_key` when absent; rejects incompatible existing types. No backfill or new NOT NULL constraint. |
| 4 | `202611030003_create_missing_tag_sequence.sql` | Creates only an absent sequence above recognized existing tag numbers. Never resets or consumes an existing sequence. Pause tag writers during this step. |
| 5 | `202611030004_scope_new_objects_to_backend.sql` | Grants only required operations to the verified backend PostgreSQL role on objects marked as created by this bundle. Existing unmarked objects' grants/policies are skipped. |
| 6 | `202611030005_add_verified_biosecurity_warning.sql` | Adds nullable BOOLEAN without a default or backfill, based on the current endpoint finding; rejects incompatible existing types. Historical assessments remain unknown. |

Do not execute old proposals 013/014/015 as additional migrations: those paths are aliases to these canonical sources. Do not blindly run `supabase db push`, Drizzle push, the historical snapshot or migrations 001–012.

Security model: these six runtime tables are accessed through the Express backend, whose authentication, verified actor and role/barangay checks remain enforced. The final SQL grants a trusted **server connection role**, never `anon`, `authenticated`, `authenticator` or PUBLIC. Policies allow that server role to perform the API's required operations; per-user authorization remains enforced by Express. They are inappropriate for direct browser table access. Audit permissions are SELECT/INSERT only. No new roles, memberships, public policies, authentication bypass or browser grants are created. Browser inheritance of the chosen role is rejected. Existing superuser/BYPASSRLS properties are not altered; a policy cannot restrict a role that already bypasses RLS. Review the actual role's effective privileges independently.

## 3. Render a reviewable SQL Editor bundle offline

After verifying the actual PostgreSQL backend role, run locally (replace the example role):

```sh
npm run db:prepare-review -- --backend-role YOUR_VERIFIED_BACKEND_ROLE --database-name YOUR_VERIFIED_DATABASE_NAME --backup-reference YOUR_APPROVED_BACKUP_REFERENCE
```

This reads repository SQL, substitutes the role, writes `build/sql-editor-review/*.sql` and `manifest.json`, and **does not contact a database**. Use the PostgreSQL role returned through the backend connection, not a pooler username with a project suffix. Do not assume the SQL Editor role matches. The supplied role must already exist; the renderer and SQL reject browser roles. Never use the fixture role from the tests for production.

Review every generated file and manifest with the owner. Preserve a private copy as the approved release artifact; generated build output is ignored by Git and can be removed by later builds. Payload SHA-256 covers source SQL after role substitution and before receipt injection; file SHA-256 covers the complete executable file. Changing the approved role/payload after execution creates a checksum conflict and requires a new reviewed version. Do not edit receipts to bypass that conflict.

## 4. Apply manually after approval

1. Restore a production-like backup into isolated staging. Apply the generated six files twice and compare record counts, stable IDs, constraints, indexes, policies and grants. Test the actual backend connection role and normal authorized API operations. Review any unrelated objects or missing contract fields before production approval.
2. Obtain approval for the exact generated files and checksum manifest. Choose one migration operator. Schedule a maintenance window; pause tag allocation while creating a previously absent sequence. Do not run concurrent migration operators.
3. Open a new SQL Editor query for each generated `.sql` file, paste the **whole file including BEGIN, receipt and COMMIT**, and run files in filename order 000 → 005. Save results and notices. Each file is transactional with bounded lock and statement timeouts.
4. On any error, stop. The failed transaction must be rolled back before retrying. Do not remove guards, disable RLS or continue to later files. Previously committed versions remain recorded. An identical approved file can be rerun; a changed checksum is refused.
5. Source payloads alone deliberately have no generated receipts. Execute the rendered files so DDL and receipt commit atomically. The private ledger is separate from existing Supabase/Drizzle history: no old migration is falsely marked applied, and no historical statement body or data is copied.

There is no automatic destructive rollback. Keep successful additive objects during investigation; roll application code back if needed. Do not drop newly created tables once users may have written data. Data restore/repair needs separate approval.

## 5. Verify before releasing writers

Run the rendered `checks/00_preflight.sql` before migrations. It fails without the supplied database name, verified backend role and backup reference. These values are operator attestations; the SQL cannot prove that a backup is recoverable. The renderer also supplies a copy-paste `checks/review_bundle.sql` with the same ordered canonical files and final verification; choose the combined or per-file procedure and retain the same receipt history. Each version commits independently.

After execution, run `checks/07_verify_schema.sql`, re-run diagnostics 01–04, then `npm run db:inspect` under the backend connection. Confirm all required columns/types, constraints, role privileges and sequence usage are correct. Inspect the six versions and hashes in `registry_migrations.applied_migrations` as the migration operator. New marked tables must retain enabled/forced RLS, no browser grants and only reviewed server policies. Existing object definitions/policies and record counts/IDs must match the baseline. This metadata check does not consume a sequence or write a test record.

A Vercel redeploy is needed only for accompanying application changes; schema files are never applied during deployment. If deploying, use the reviewed commit and existing server-only `DATABASE_URL`; do not change SSL verification or expose it as a `VITE_` variable. Check:

```sh
curl --fail-with-body https://lguhinunanganswineregistry.vercel.app/api/health
```

Require real `database: connected`, `schema: ready` and overall HTTP 200. A connected database with a missing/incompatible schema must remain 503. If another requirement fails, use safe health diagnostics and the catalog to prepare the next minimal reviewed delta; do not turn off validation.

With approved demo/test accounts, verify existing records and role scopes first. Then test an authorized record creation, retrieval on a second device, offline pending changes and reconnection retries without duplicates. Preserve IndexedDB and pending queues. New writes are an explicit operational verification step, not something these migrations or health checks perform. Do not claim production synchronization is fixed until these real checks succeed.

## Local verification

`npm run lint` (TypeScript), `npm test` (62 tests), and `npm run build` passed. `scripts/test-sql-editor-bundle.sh` exercises disposable network-isolated PostgreSQL 17, including legacy IDs/FKs/data/policy preservation, fresh absent tables, reruns, role-restricted RLS, audit grants, receipts, unsafe membership refusal and checksum drift refusal. These fixtures are not evidence of the unknown production catalog.

## Current verified production delta

See [production-schema-repair-report.md](production-schema-repair-report.md) for the 2026-11-03 live endpoint finding, complete audit scope, historical unverified observations, critical type conflicts and proposed adapters. Stages 000–004 and their source checksums remain unchanged; stage 005 is appended. Unknown biosecurity values remain NULL; domain/display semantics require operator approval before rollout. Do not present this package as a complete live reconciliation until the actual catalog and backend role are verified.
