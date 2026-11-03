# Database initialization and migration architecture audit

## Scope and verified limits

This audit covers the Vercel and standalone entry points, runtime database modules, Drizzle declarations, the 163-column raw/ORM contract, legal SQL, the legacy snapshot and migrations 001–012. The complete per-column static source comparison is `docs/repository-schema-comparison.json`; it includes types, declaration text, primary-key/nullability review flags and runtime default expectations. It is a declaration audit, not a simulation of conditional migrations or an export of production.

Current production catalog/row data is not available in this workspace. No DATABASE_URL or local environment file is configured; a prior read-only metadata request with the supplied public key was rejected. No production table, role, constraint, grant, policy, sequence or row was changed. Production FK/type conversions and backfill SQL cannot responsibly be finalized until the owner provides inventory and aggregate relationship results. The scripts below prepare that evidence without returning records or credentials.

## Why CREATE statements did not create or repair production tables

Vercel discovers `api/index.js`, which loads `build/vercel.cjs`, compiled from `src/server/vercelEntry.ts`. That entry loads environment configuration and exports the Express app. There was no startup caller of `initPostgresTables`; recent code also rejected it in Vercel/production. A successful build or warm function import never executed its DDL. Drizzle `pgTable` and `drizzle(pool)` declarations describe queries; they do not migrate PostgreSQL.

The legacy initializer was not a safe deployment migrator: one large, unversioned batch mixed CREATE/ALTER/DROP, defaults, registry seed rows, official legal seeds and compatibility updates. It did not create every normalized/raw-query dependency. Errors could abort setup midway, and later startup calls could repeat unrelated work. Its legal CREATE statements were a constant reached only from that dormant initializer. CREATE TABLE IF NOT EXISTS also skips existing tables without validating their shape, so it cannot repair missing columns or wrong key types. Migration 002 similarly creates issued_certificates with control_number only on initial creation; an already existing different table does not acquire that column automatically.

Historical normalized migration 001 creates core normalized tables, while the runtime still uses several legacy-layout fields. Messages, media_files and registry_schema have no CREATE declaration in migrations 001–012, despite migration 003 configuring their RLS. Blindly replaying the historical chain is not a reliable fresh bootstrap or a safe repair of a populated database. It must be reviewed/baselined against actual deployment history.

## Repository conflicts requiring owner decisions

| Area | Legacy runtime initializer/snapshot | Normalized migration declarations / current contract | Decision gate |
| --- | --- | --- | --- |
| swine_records.id | TEXT in the initializer | UUID in ORM/001; snapshot also uses UUID | Inspect every stored ID and incoming/outgoing FK. Preserve stable legacy IDs; never replace them with random UUIDs. |
| audit_logs.id/user_id | SERIAL id, TEXT user_id, entity/timestamp aliases | UUID identities and table_name/record_id/created_at in 001/current ORM | Determine the real audit store and key graph. Do not assume the current ORM is right for existing serial history. |
| swine_records.birth_date | TEXT | DATE in 001, TEXT in runtime | Review parsing, timezone/date semantics and old values before changing the adapter or database. |
| swine_records.age_months | TEXT | INTEGER in 001, TEXT in runtime | Inspect values; adapt queries or stage a reviewed mapping, not a blanket cast. |
| swine_records.price_estimate | TEXT | NUMERIC(12,2) in 001, TEXT in runtime | Review precision and units. Preserve amounts; do not cast invalid historical text blindly. |
| swine farmer/barangay relationships | Initializer lacks normalized complete linkage | 001 requires farmer_id and barangay_id FKs; ORM makes farmer nullable and omits swine barangay_id | Preserve existing constraints. The inspector flags extra mandatory columns not written by the runtime contract, which can otherwise cause 23502 after column additions. |
| users | Legacy uid/name/role/assigned_barangay/active/status | 001 uses full_name/role_id/assigned_barangay_id/phone_number; 002 adds some compatibility fields but not every runtime field | Review actual account/Auth links and permissions. Never default all old accounts to active or rewrite roles as a schema repair. |
| system_settings | key/value with key PK | 001 uses setting_key/setting_value, UUID id and setting group | Choose an explicit query adapter or approved compatibility mapping. Do not create two independent sources of settings. |
| issued_certificates vs certificates | Runtime printable snapshot with TEXT id/control_number | Normalized certificates is UUID/document_number; 002 adds a separate runtime snapshot table | They have different semantics. Do not merge, rename or replace one as a blind fix. |
| timestamps and defaults | Legacy timestamp without timezone, uppercase application defaults | Normalized timestamptz and lower-case status/type defaults | Inspector reports timezone review and expected/actual metadata. Do not reinterpret wall-clock history or overwrite existing defaults automatically. |
| PKs, unique indexes, FKs and nullability | Some constraints only in SQL, not ORM | ORM is a partial query contract, not a complete security/relationship model | Inventory real constraints/indexes/policies. No ORM diff/push is authorized to drop unmodeled objects. |
| auxiliary tables and legal DDL | Runtime-dependent bootstrap and seeds | Distributed between raw SQL, snapshot, 002 and 008–012 | Explicit absent-table SQL below; preserve populated tables and review their data separately. |

The static JSON contains all 163 required columns, including declarations/default text and missing declaration entries, so the audit is not limited to these highlighted conflicts. Conditional ALTERs, data updates, standalone indexes and policy effects must be evaluated against the actual catalog; the JSON deliberately does not claim the historical scripts produce one universally correct final schema.

Historical risk items remain immutable reference history: migration 001 contains legacy ID/type conversions, including UUID generation; 002 copies profiles, changes roles/permissions and drops the old password column; 005 backfills farmers; 008/010 relax template nullability; several migrations replace RLS policies. The legacy snapshot contains broad policies in its earlier sections. Do not replay any of these on production simply to suppress 42P01/42703.

## Architecture implemented

- Removed all CREATE/ALTER/DROP and seed execution from `src/db/index.ts`; its deprecated initializer now rejects in every environment without connecting. Git history retains the old implementation for audit.
- Removed the duplicate executable legal DDL constant. Legal APIs retain their ordinary queries and verified-actor transactional audit writes; table creation belongs to SQL migration files.
- Removed CREATE SEQUENCE from the live tag allocator. It now calls only nextval on the migrated public sequence and fails clearly when unavailable. It does not scan a small set of rows or invent random fallback IDs during retries.
- Extended the runtime column contract with expected type, nullability, PK/uniqueness/default metadata from the ORM. Raw-query requirements remain explicit. This describes what current code expects; it is not authority to rewrite production.
- Added `src/db/catalog.ts` to compare real PostgreSQL types, detect unmodeled mandatory columns, and report review items. TEXT/UUID and SERIAL/UUID are incompatible and never auto-converted. Timestamp variants require owner review; varchar/text are read-compatible but length/write constraints still need review.
- Health executes SELECT 1, LIMIT 0 projections, read-only type catalog checks and sequence existence/usage checks. It never creates objects, seeds rows or consumes a sequence. Connectivity remains separate from schema readiness; missing relations/columns, incompatible types or missing required sequence keep overall HTTP 503. PostgreSQL codes remain distinct from application SCHEMA_TYPE_MISMATCH/SCHEMA_OBJECT_MISSING diagnostics.
- Added `npm run db:inventory` (generates SQL only) and `npm run db:inspect` (read-only database inspection). There is deliberately no startup/postinstall/build migration, seed command, automatic apply runner or production push script.

These checks establish read/type/object compatibility, not permission to modify records or proof that every historical row/write constraint is valid. New-table policy review and authorized application tests are separate release gates.

## Exact review SQL and dependency order

The current canonical, timestamped SQL Editor bundle and deployment procedure are documented in [supabase-sql-editor-deployment.md](supabase-sql-editor-deployment.md). Source payloads live in `supabase/review/`, outside the automatic migration directory. The old proposals 013/014/015 are compatibility symlinks to the same payloads; they are not additional migrations to execute. The source manifest records hashes, while the offline bundle renderer adds atomic private receipts and a verified backend role.

Run stages 202611030000 through 202611030004 in order only after review. They establish a private checksum ledger, create absent auxiliary tables, add four confirmed nullable compatibility columns, create an absent tag sequence, then scope new-object access to the verified server role. Existing tables and their security policies remain unchanged. No startup, build, or health check applies these files. Never replay historical migrations 001–012 to repair a populated database.

## Complete production migration plan

1. **Owner snapshot and history:** identify the actual project/database and application role privately; record PostgreSQL version and deployed commit. Take a recoverable backup and preserve Supabase migration history, grants, indexes, triggers, RLS flags and policies. Do not change production while gathering evidence.
2. **Metadata inventory:** run `supabase/diagnostics/01_required_schema_inventory.sql`, or `npm run db:inspect` with current credentials configured privately. It reads catalog metadata, actual types, defaults and relationships. Run under an authorized owner for completeness, then check access under the real backend role. RLS/privilege filtering must not be mistaken for empty data.
3. **Data compatibility:** run `03_identifier_relationship_audit.sql` in its read-only transaction. It reports counts of non-UUID values and unmatched common FK relationships, never record values. It casts to TEXT for comparisons, never to UUID. Review NOT VALID/composite/other foreign keys from the full catalog separately; sample/common-link checks are not proof of the entire graph. Use `02_backfill_readiness.sql` for aggregate candidate-key availability. Schedule large scans appropriately.
4. **Choose contract per table:** preserve actual stable keys and references. For non-UUID historical swine IDs or serial audit IDs, adapting ORM/query types may be the correct solution. If UUID is validated as the real canonical identity, update only a reviewed adapter/contract. Do not run USING gen_random_uuid(), invent ownership, loosen an old FK/NOT NULL constraint, or mark unknown accounts active. No production-specific conversion SQL is finalized before these decisions.
5. **Approve a minimal delta:** use only the applicable reviewed proposals above. Additional missing columns or aliases, old mandatory write columns, defaults, uniqueness, FK and role semantics need a catalog-specific proposal rather than generic ORM push. Backfills are separate operations updating only approved missing values, with preservation/conflict tests. Add future constraints only after a safe backfill/validation plan.
6. **Security gate for new objects:** review the actual role, grants and scoped policy predicates before approving usage of newly created tables. Preserve all existing policies. Never grant blanket browser access or disable RLS/authentication to pass health. The generic proposal deliberately leaves new objects denied until that review; policy SQL cannot safely be invented without the role/user/barangay model from the live catalog.
7. **Restore to isolated staging:** test the approved SQL twice against a production-like copy, with exact ID/FK/value/count snapshots and all roles. Confirm no data/type/constraint/policy changes beyond the signed plan, no tag collision, and correct offline replay behavior. Check new writes still satisfy all old mandatory columns.
8. **Promote history deliberately:** baseline actual migration history without replaying legacy destructive files. Record reviewed checksums/chronological versions with the migration owner. Do not use drizzle-kit push, reset, or an unchecked db push against production. Application build/deployment has no database migration side effect.
9. **Execute only after approval:** single migration operator, maintenance window for tag cutover, writers paused where required, bounded locks. Apply only signed files and separately approved backfill/policy changes. Re-run catalog and before/after security/data assertions immediately.
10. **Deploy and verify:** Preview first, then approved production code. Require database connected, schema ready, Auth available and overall HTTP 200. On missing/type/sequence diagnostics, stop and inspect the real contract instead of incrementally guessing columns. Test existing users/farmers/swine/certificates/messages/media/audit history, correct admin/barangay/agent scopes and offline sync without clearing queues.
11. **Rollback:** code rollback first when expansion is backward-compatible. Leave added objects denied/reviewed rather than dropping them. Any snapshot restore or data repair requires separate approval and recovery planning; no destructive automatic down migration is supplied.

Production schema/record/role data was not accessible here, so steps 1–6 are explicit release gates, not claimed completed. The architecture and local migration safety are repaired; live reconciliation and production health confirmation remain pending owner inventory/approval.

## Verification evidence

- Regression tests cover no runtime DDL, initialization rejection in all modes, exact schema failure diagnostics, TEXT/UUID and SERIAL/UUID compatibility checks, unmodeled mandatory columns, missing sequence reporting, and allocation without DDL/random fallback.
- On network-isolated disposable PostgreSQL 17, ran 014 → 013 → 015 twice with existing TEXT swine IDs, SERIAL audit IDs, records, FKs, grants and private policies. IDs/data/FKs/grants/policies were preserved. Newly created tables rejected inherited browser access, including simulated unsafe default grants.
- The new sequence honored normalized historical tag columns as well as runtime tag columns, began above the existing high-water mark, and was not reset on rerun.
- The real PostgreSQL catalog identified legacy TEXT/integer identities as incompatible with the application's UUID expectation without changing either side. Catalog/aggregate diagnostics executed successfully. These fixtures do not establish the unseen production layout.

References: [PostgreSQL CREATE TABLE behavior](https://www.postgresql.org/docs/current/sql-createtable.html), [PostgreSQL RLS and default deny](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Supabase versioned migrations](https://supabase.com/docs/guides/deployment/database-migrations).


## Final results and changed areas

`npm run lint` and the production build passed; all **59 regression tests passed**. The final isolated PostgreSQL SQL bundle also passed twice, including canonical historical tag columns. Review-manifest checksums match the exact proposed SQL. No production migration, data/backfill, permission change or deployment occurred.

Changed application areas: `src/db/index.ts`, `legalDocuments.ts`, `swine.ts`, `requirements.ts`, new `catalog.ts`, `diagnostics.ts`, `src/server/databaseHealth.ts` and its health route integration. Added/updated tests cover initialization, runtime DDL exclusion, catalog types, mandatory-column review, sequence allocation and health. Tooling includes the offline declaration audit, expanded inventory generator and read-only catalog inspector; the local SQL harness is `scripts/test-migration-architecture.sh`. README/deployment instructions now prohibit unchecked historical replay. Exact SQL and checksums are under `supabase/proposals/`; schema-only and aggregate diagnostics are under `supabase/diagnostics/`. The legacy snapshot is reference material, not a production deployment command.

## Current SQL Editor bundle

The offline `db:prepare-review` command emits five ordered files with atomic SHA-256 receipts in a private `registry_migrations` schema. This ledger does not impersonate Supabase CLI or Drizzle history. New-object policies are scoped to a verified server PostgreSQL role and preserve the Express authentication/RBAC boundary; browser-role inheritance is refused. The SQL Editor integration harness additionally tests restricted audit grants, receipt idempotency and checksum drift rejection. See the linked deployment procedure for current gates and exact files.
