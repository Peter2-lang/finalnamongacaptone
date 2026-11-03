> Historical investigation below. The current production response and complete pending catalog review are recorded in [production-schema-repair-report.md](production-schema-repair-report.md). On 2026-11-03 the endpoint confirmed missing `swine_records.biosecurity_warning`; older observations below are not current catalog proof.

# Schema mismatch investigation and reviewed repair proposal

## Exact failing SQL and affected code

Given the confirmed missing audit columns, the old health checker in `src/server/databaseHealth.ts`, using `auditLogs` from `src/db/schema.ts`, generates this failing read-only statement:

```sql
SELECT "id", "action", "entity", "entity_id", "user_id", "username", "user_role", "barangay", "details", "timestamp"
FROM public."audit_logs" LIMIT 0;
```

`audit_logs.entity` is the first undefined identifier in that statement. `entity_id`, `username` and `timestamp` would fail too. This is an exact code-derived statement reproducible on canonical migration-001 layout, not a retrieved production query log. The particular first statement failing in a production invocation still depends on deployment version and other table drift; no current DATABASE_URL or live catalog export is available here.

There are two conflicting repository schemas: migration 001 defines the normalized audit table with UUID id, table_name, record_id, user_id, barangay_id, old_data, new_data and created_at. The ORM previously copied legacy supabase_schema.sql with serial id and entity/timestamp aliases. No application query imports that auditLogs ORM object; it was still included in the health check's iteration. The master config audit is stored in system_settings, and legal audit uses legal_document_audit_logs. These stores and their permissions were not changed.

`CREATE TABLE IF NOT EXISTS` does not add columns to an already existing table. Migration 002 declares control_number when creating issued_certificates but does not repair it if an older table already exists. The legacy runtime initializer and snapshot also declare messages/media/registry columns that the normalized migration history does not comprehensively repair. Do not rerun legacy snapshots or migration 001 against production as a blanket fix: they contain unrelated changes and legacy type conversions.

## Recommended decisions

| Reported missing column | Backend use | Proposed decision |
| --- | --- | --- |
| audit_logs.entity, entity_id, timestamp, username | schema.ts -> databaseHealth.ts SELECT projection | Correct the ORM to canonical migration 001. Do not add duplicate legacy audit fields. Confirm table_name, record_id and created_at in the live inventory before deployment. |
| issued_certificates.control_number | certificates.ts list, lookup, upsert, archive; health probe | Nullable text addition if live metadata confirms no existing canonical equivalent should replace the query. Preserve/reconcile original certificate numbers separately. |
| media_files.file_url | media.ts list and insert; health probe | Nullable text addition, then approved mapping of real existing URLs; do not fabricate URLs or make private assets public. |
| messages.sender_id | messages.ts mapping, sender filtering, inserts; health probe | Nullable text addition, then verified sender-identity mapping. Never invent or infer account ownership from display names. |
| registry_schema.field_key | registrySchema.ts SELECT/INSERT/ON CONFLICT; health probe | Nullable text addition, then explicit mapping of stable existing field keys. Do not regenerate keys in a way that disconnects existing record custom fields. |

The four-column proposal is a compatibility stage. It can remove these specific 42703 errors but does not prove new writes work or historical data is correctly mapped. Existing legacy NOT NULL columns, uniqueness, types, trigger requirements, FK types and semantics may require query compatibility changes after inventory. None is weakened or guessed here. The proposal must not be approved merely because adding empty columns turns health green.

## Compare all required columns with the real database

Run `supabase/diagnostics/01_required_schema_inventory.sql` in Supabase SQL Editor. It is a read-only transaction. It reports 163 required columns derived from every ORM table plus raw-query tables (certificate templates/signatories, legal documents/audit, and barangay metadata). It also reports actual columns/types/defaults, existing constraints/FKs, RLS flags, policies and table grants. It reads catalog metadata, not application records. Run as the database owner for a complete catalog; compare access using the backend role as well. information_schema can hide columns when the current role lacks privileges. A present column's type is reported for review, not assumed equivalent.

Alternatively, with the current database credentials configured privately:

```sh
node --import tsx scripts/inspect-database-schema.ts
```

That script opens a read-only transaction and reports required-vs-actual columns/types; it never runs DDL, migrations, data changes, or the startup initializer. It does not dump defaults or records. It correctly reported missing connection configuration in this workspace. The current confirmed-missing list is partial; no full production comparison is claimed until the live inventory is supplied.

Regenerate the SQL after schema/query changes with `node --import tsx scripts/generate-schema-inventory.ts`. The contract lives in `src/db/requirements.ts`. Dynamic record custom-field values are data, not SQL columns, and are not part of this catalog check.

## Proposed migration (not applied to production)

`supabase/proposals/013_runtime_column_compatibility.sql` is deliberately outside the automatic migrations directory. After review and explicit approval, execute that exact file in a transaction using an authorized migration role. Do not blindly run all historical migrations or use db push to apply this proposal before review.

It preflights that all four existing tables exist and any existing target columns have compatible text types. It then adds only control_number, file_url, sender_id and field_key using ADD COLUMN IF NOT EXISTS, all text, nullable, without defaults. Lock acquisition is bounded to five seconds and execution to 30 seconds. Incompatible types or missing tables abort the entire transaction. It does not delete, rename or recreate a table, touch existing rows, alter types/constraints, grant privileges, modify RLS policies or change foreign keys. Repeating it is safe. Test large production partition layouts and lock timing separately before scheduling execution.

## Backfill review, separately approved

`supabase/diagnostics/02_backfill_readiness.sql` returns counts of empty targets and availability of possible legacy keys. Candidate names are hypotheses, not approved source mappings. It reads aggregates only and performs no UPDATE. Large tables may require scheduling these scans.

For each target, first confirm the authoritative old column/JSON path and semantics from the live metadata and application data owner. Then prepare a separate reviewed backfill that updates only NULL target values, preserves existing non-null values, handles duplicates/conflicts, and verifies source/target row counts. Take a database snapshot before approved changes. Do not replace unknown historical senders with an admin/system user, synthesize certificate control numbers, or guess storage URLs. No NOT NULL/unique constraint should be added until all affected rows have an approved backfill and validation. Existing production constraints remain intact.

## Backend diagnostics and verification

The corrected audit ORM matches canonical migration 001. Health now checks the same ORM-plus-raw-SQL contract as the inventory using LIMIT 0 projections. On failure it records the exact static SELECT, known table and known missing column in server logs, omitting driver messages, parameters and record values. PostgreSQL 42703/42P01 classify as schema_error; public health remains sanitized HTTP 503 until all required checks succeed. It does not skip failing tables or fabricate a healthy response.

After reviewing inventory and approving any required SQL:

1. Save pre-change column/constraint/grant/policy snapshots. Apply only the approved additive proposal; confirm unchanged row counts and original values, constraints/FKs, grants and RLS.
2. Review and apply a separately approved historical backfill if needed; verify existing NOT NULL/legacy column requirements before authorizing writes. Do not assume health proves write compatibility.
3. Deploy the backend correction through Preview, then production only after approval. Review `[HEALTH] dependency_check_failed.schema` for exact table/column/statement if the next mismatch appears.
4. Rerun the catalog inventory and check https://lguhinunanganswineregistry.vercel.app/api/health. Require database connected, Auth available and status healthy with HTTP 200. A continuing schema_error means the repair is incomplete; inventory all failures together rather than adding columns one at a time blindly.
5. With authorized test accounts on a demo/Preview database, test existing certificate retrieval/control-number lookup, existing media links, message ownership/filtering, registry field keys and offline synchronization. Confirm role scopes and existing records remain unchanged. Do not create/delete production test records without approval.

Production health cannot yet be verified after migration because no production SQL or deployment was executed, and no live database connection is configured in this workspace.

## Tests and local PostgreSQL evidence

- TypeScript checks and production build passed; 46 tests passed, including canonical audit probes and precise 42703 statement diagnostics.
- On a disposable PostgreSQL 17 container with network disabled and no published ports, reproduced the audit entity 42703 and verified the corrected audit projection.
- Applied the four-column proposal twice to populated fixtures. Original rows/values, primary/foreign-key constraints, table/column grants and RLS flags/policies were preserved; target columns remained nullable with no defaults and no invented history.
- Confirmed incompatible pre-existing sender_id integer causes a preflight rejection with no partial column additions.
- Ran the generated read-only inventory successfully on PostgreSQL. This validates SQL syntax and local safety behavior, not the unseen production layout.

The local harness is `scripts/test-schema-proposal.sh` with SQL fixtures in `scripts/fixtures/`. It accepts only a deliberately named, network-isolated local test container and does not use DATABASE_URL. No production migration is invoked by npm test, build or application startup.
