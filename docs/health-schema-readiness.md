# Health connectivity and schema readiness — current 42703 investigation

## What is confirmed

A read-only request to the production endpoint returned HTTP 503 with database schema_error, PostgreSQL 42703, and authentication available. That means a PostgreSQL statement reached the database and referenced an undefined column; it is not evidence of internet loss or a TLS failure. The previous health implementation conflated connectivity and schema readiness by changing database to schema_error when a LIMIT 0 projection failed.

The precise current production column is not present in that response. It cannot be inferred from SQLSTATE 42703 alone. A request to the supplied Supabase project's read-only PostgREST OpenAPI metadata endpoint using the previously supplied publishable key returned HTTP 401. No local DATABASE_URL, server key or environment file is configured. No direct catalog inspection succeeded, and no live production schema comparison is claimed. Obtain the inventory below or the server's structured schema log before choosing a schema/query migration.

Earlier investigation found a legacy audit ORM expecting entity/entity_id/username/timestamp where canonical migration 001 uses table_name/record_id/created_at. That ORM correction is already in the repository. Earlier reported missing control_number/file_url/sender_id/field_key remain candidates, not proof of the current first failing query. Do not claim audit_logs.entity or any other candidate is the current missing column without production evidence.

## Current health behavior

1. Acquire a connection from the existing shared pg pool and execute SELECT 1.
2. Only after that succeeds, report database connected and check application schema using the existing ORM/raw-SQL contract.
3. Successful schema probes report schema ready. PostgreSQL 42703/42P01 report schema not_ready. Other schema-query failures report schema error. If connectivity fails, schema is not_checked; known connection loss during probing also marks database error.
4. Overall HTTP 200/healthy/cloud online requires connected database, schema ready, successful required Auth checks and valid project configuration. Schema failures retain HTTP 503/unhealthy/cloud unavailable. Connectivity alone never makes synchronization ready.
5. Public schema_error contains only the failing known table and known column when determinable. SQL text, driver messages, parameters, stack traces and credentials are omitted. The server log retains the exact identifier-only LIMIT 0 statement under [HEALTH] dependency_check_failed.schema.

`src/server/databaseHealth.ts` generates the statements from `src/db/requirements.ts`. It now recognizes the missing identifier from PostgreSQL's statement position, the structured column field, or qualified/unqualified missing-column text, and only accepts a column in that known table contract. It does not skip failed schema probes.

The frontend health parser supports both the old database schema_error response and the separated database/schema fields. Even a malformed HTTP 200 claiming healthy with schema not_ready is rejected for synchronization.

## Initialization audit

- `src/server/vercelEntry.ts` and `server.ts` load environment settings and the existing Express app. Neither calls schema initialization.
- `createPool()` constructs a connection pool; `drizzle()` creates the ORM adapter. Neither runs schema DDL.
- `testDatabaseConnection()` runs SELECT 1. `updateDatabaseConnection()` changes the pool but no longer invokes schema initialization; the API connection-update route is already disabled.
- `initPostgresTables()` has no repository callers. It is a legacy compatibility helper containing CREATE/ALTER, audit definitions from the old layout, and ALTER TABLE users DROP COLUMN password. It is now explicitly blocked whenever VERCEL is present or NODE_ENV is production, before acquiring a connection. Local manual use is legacy behavior, not an approved production migration workflow.
- The health endpoint performs SELECT queries only. It never creates, updates or drops tables. No migration is executed by build or npm test against production.

## Inspect and repair the actual schema

Run `supabase/diagnostics/01_required_schema_inventory.sql` in Supabase SQL Editor as the owner for a complete schema-only inventory, then check backend-role access separately. It is a read-only transaction comparing 163 ORM/raw-query column requirements and returning metadata for types, constraints/FKs, grants and RLS. It does not return swine/user record data. A role with insufficient privileges may not see all information_schema columns.

Alternatively, configure current credentials privately in .env.local and run:

```
node --import tsx scripts/inspect-database-schema.ts
```

Provide the schema-only comparison or the structured Vercel schema log. For each confirmed failure:

- If an existing canonical column has the intended meaning, correct the application mapping/query after reviewing that schema.
- If a required field is absent with no existing equivalent, prepare a nullable additive migration and a separate approved historical backfill. Preserve constraints, RLS and account ownership.
- Do not rerun the legacy initializer, supabase_schema.sql or historical migration 001 wholesale. CREATE TABLE IF NOT EXISTS does not upgrade an existing table, and historical files contain unrelated/destructive compatibility operations.
- The previous four-column proposal remains at supabase/proposals/013_runtime_column_compatibility.sql, outside automatic migrations. It is not approved or executed by this task. Do not apply it until the actual catalog and old write constraints demonstrate it is appropriate. No new migration was generated merely from the current anonymous 42703 response.

## Deployment and verification

Review and deploy this health/initialization code to Preview first using Node 22, npm ci --include=dev, npm run build and output dist. With the intended database environment, confirm a schema failure reports database connected only after SELECT 1, schema not_ready, the actual known table/column, and HTTP 503. Check the corresponding static SQL in Vercel runtime logs.

Inspect the live catalog, review the required mapping or additive SQL, and obtain approval before applying production changes. Preserve backups and schema/permission snapshots. After the approved repair and backend deployment, require schema ready as well as database connected, Auth available and HTTP 200. Then verify authorized reads, existing records/accounts and offline synchronization. A continuing 503 means readiness remains unresolved; do not clear local queues or change permissions to suppress it.

No production SQL, schema mutation, account change or deployment was performed here. The current production missing column and complete readiness remain pending authorized schema metadata/log access.

## Validation and changed files

TypeScript and production build passed; 50 tests passed. Tests cover independent SELECT 1 failure, connected-but-schema-not-ready responses, known missing identifier diagnostics, connection release, failed-sync classification and zero SQL attempts by the legacy initializer in production/Vercel.

Changed: src/server/app.ts, src/server/databaseHealth.ts, src/server/databaseHealth.test.ts, src/server/health.test.ts, src/db/index.ts, src/db/initialization.test.ts, src/services/backendHealth.ts, src/services/backendHealth.test.ts, and this report. No production migration, schema definition, RLS policy, permission or record was changed in this follow-up.
