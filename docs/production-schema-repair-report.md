# Production schema repair: verified findings and blocked decisions

## Evidence captured 2026-11-03

A read-only HTTPS request at **2026-11-03T14:10:16Z** returned HTTP **503**:

```json
{"status":"unhealthy","database":"connected","schema":"not_ready","cloud":"unavailable","authentication":"available","database_error_code":"42703","database_error_kind":"schema_error","schema_error":{"table":"swine_records","column":"biosecurity_warning"}}
```

The endpoint's current verified missing-column finding is **public.swine_records.biosecurity_warning**. No currently missing table, wrong existing type, production PostgreSQL role, constraint, index or grant has been established from a live catalog. A successful column projection before this failure is not proof of full read/write compatibility.

`npm run db:inspect` failed with `configuration_error / CONFIGURATION_ERROR` because this workspace has no configured database URL. There is no attached Supabase/Vercel connector. The authorized operator has been asked to return read-only catalog/role reports; production credentials must remain private. No production migration or functional write test was executed. The current endpoint is **not healthy**.

The health probe in `src/server/databaseHealth.ts` iterates the explicit runtime projection from `requirements.ts`, then checks catalog types and sequence existence/privileges. For swine it emits a `SELECT` of the declared columns from `public."swine_records" LIMIT 0`; that projection includes `"biosecurity_warning"`. `src/db/schema.ts` declares BOOLEAN. Its absence yields 42703; the API correctly separates connected PostgreSQL from schema readiness and returns 503. Initialization remains disabled with `SCHEMA_INITIALIZATION_DISABLED`.

## Coverage and repository audit

Reviewed ORM declarations, raw database modules, server query/authorization paths, migrations 001–012, all current review payloads/diagnostics, and the architecture/schema comparison documents. The contract covers **163 columns across 15 tables**, plus `public.swine_tag_seq`. `requirements.ts` derives ORM columns and explicitly includes raw-query fields. `docs/repository-schema-comparison.json` remains a static declaration audit, not production evidence.

| Runtime objects | Query dependencies and review points |
| --- | --- |
| users | UUID id/auth_user_id, uid/email/name/role/barangay/active/status/permissions. Auth profile links and account activation must never be inferred by a migration. |
| barangays | UUID identity, code/name, municipality/coordinates/is_active/metadata/timestamps. Raw inserts omit id and require its generator; code uniqueness and duplicate handling require catalog review. Reference seeding on GET has been removed. |
| farmers | UUID identity/barangay_id, names/contact/archive/metadata fields; INSERT requires database-generated id. Existing barangay FKs must remain valid. |
| swine_records | All declared registry/marketing/biosecurity fields, UUID runtime identity, farmer link, explicit ON CONFLICT(id). No automatic TEXT→UUID conversion. |
| issued_certificates | Persisted printable snapshots, TEXT id/control number, metadata and issuance fields. Distinct from normalized certificates; do not merge stores. |
| messages / media_files / registry_schema | TEXT identities, sender/URL/stable field keys plus all declared attributes. Never invent historical sender ownership, URLs or custom-field keys. |
| system_settings | Runtime key/value/updated_at, unique key required. Normalized aliases need a deliberately chosen adapter rather than parallel settings stores. |
| audit_logs | Current ORM follows normalized UUID/table_name/record_id/old_data/new_data/created_at. Legacy serial/entity/timestamp structures require adapter review; no app audit history is converted. |
| certificate_templates | UUID id, code/name/body/template_data/css_styles/scope/status/timestamps; id generator and unique code are required by raw upsert. |
| certificate_signatories / signatories | Relational joins use template_id/signatory_id/display_order and signatory names/titles/signatures/active. Preserve all FK and composite-key structures. |
| legal_documents / legal_document_audit_logs | JSON document store and verified-actor UUID audit events. New legal audit grants are SELECT/INSERT; DELETE of a document must not cascade away audit history. |
| swine_tag_seq | Existing sequence and USAGE/UPDATE access are read-checked without nextval. New sequence creation must pause writers and honor all known historical tag sources. |

Other tables present only in historical normalized migrations (roles, permissions, role_permissions, registry_forms/fields/values, normalized certificates, printed_documents, monitoring/gis/movement/mortality records, uploaded_documents and legacy_user_profiles) must remain intact. They may be dependencies of existing triggers, policies, Auth or FKs even if the current API does not directly query them. Do not drop them because Drizzle omits them.

Existing migrations include destructive conversions, backfills, profile/permission changes, triggers, RLS replacement and storage/realtime setup. Migration filenames are not proof of execution. The new diagnostic 04 checks actual tracking metadata without dumping SQL bodies. Manual review receipts use `registry_migrations.applied_migrations`; they do not impersonate Supabase or Drizzle history. No automatic apply runner is added.

## Historical observations versus current verified delta

| Observation | Current evidence | Action |
| --- | --- | --- |
| swine_records.biosecurity_warning | Confirmed missing by current production response | New canonical version **202611030005** adds nullable BOOLEAN with no default/backfill. It rejects an incompatible existing type and preserves records. |
| swine_records.actual_weight_kg, barangay | Historical only | Recheck actual catalog/types before any new SQL. No fresh change generated from old errors. |
| issued_certificates.control_number, metadata | Historical only | Existing stage 002 handles control_number only if needed; metadata and old write constraints remain catalog-dependent. Do not invent numbers or payloads. |
| certificate_templates.template_data | Historical only | Historical 008/010/011 are reference, not permission to replay their backfills/RLS. A fresh additive delta requires the catalog. |
| media_files.file_url, messages.sender_id, registry_schema.field_key | Historical only | Existing stage 002 adds nullable TEXT when applicable and rejects incompatible existing types; mapping/backfill remains blocked. |
| legal_document_audit_logs, media_files, messages, registry_schema, issued_certificates (and legal_documents) | Historical missing-table reports only | Existing stage 001 creates genuinely absent auxiliary tables only. Live absence, role and semantics still require approval. Existing tables/security are skipped. |

**No other current production missing object or incompatible type is confirmed.** Complete production-specific modifications cannot be honestly generated until catalog/data/dependency evidence is supplied. Existing review stages 000–004 were preserved byte-for-byte; their previous approval/apply status remains unknown. Stage 005 is appended, not a rewrite of applied history.

## Critical conflicts and proposed adapters (blocked pending evidence)

| Conflict | Evidence required | Safe proposed application direction |
| --- | --- | --- |
| swine id TEXT vs UUID | Exact live type, non-UUID counts, inbound/outbound FKs, offline operation IDs | If TEXT is canonical, keep TEXT in the ORM and accept existing stable IDs in lookup/upsert/sync. Remove UUID regeneration paths only after testing every identity consumer. Never assign new UUIDs to history. |
| birth_date TEXT vs DATE | Values, date precision, input formats and timezone expectations | Use a DATE adapter emitting ISO calendar dates if DATE is authoritative; avoid JS timezone shifts. Keep legacy raw text if unparseable values exist until approved reconciliation. |
| age_months TEXT vs INTEGER | Non-integer/units values, derivation rules | Use a validated numeric adapter if INTEGER is canonical; preserve original historical text where meanings differ. |
| price_estimate TEXT vs NUMERIC | Currency, scale/precision, ranges and non-numeric text | Use validated decimal strings mapped to the actual numeric type; avoid JS floating-point truncation and blind casts. |
| legacy vs normalized audit | Serial/UUID identity graph, actor links and exact audit writer/reader | Separate adapter for existing canonical audit store. Do not add duplicate aliases merely for a health projection or rewrite actors/history. |
| legacy vs normalized users | Auth links, role mappings, disabled accounts, required old columns | Explicit profile adapter using verified links and server authorization. No random new IDs, default activation or role escalation as a schema fix. |
| settings key/value vs setting_key/setting_value | Unique keys, duplicates, authoritative source and required columns | One selected repository adapter for actual key/value names; preserve a single settings store. Do not create unsynchronized aliases. |
| certificates vs issued_certificates | Existing document numbers, linkage and printable snapshot semantics | Keep distinct stores unless an independently approved mapping proves equivalence. Preserve authoritative certificate numbers. |
| mandatory columns / indexes / defaults | Full catalog, duplicate and null counts, trigger/default dependencies | Preserve constraints. Adapt INSERTs, or separately approve validated backfills/constraints. No blind NOT NULL/UNIQUE addition. |

The read-only inspector now reports usable full, immediate unique conflict indexes, omitted IDs lacking generators, unmodeled mandatory columns, table/RLS/role metadata, constraints, grants, triggers and sequences. Index checks reject partial, expression, invalid, not-ready and deferred conflict targets. This is a release report, not SQL to replace existing objects.

## Runtime safety changes

- `initPostgresTables()` remains disabled. Health remains read-only and continues to fail on missing schema.
- Barangay GET no longer installs reference rows. Existing barangay data and authorized explicit editing remain supported.
- Loading certificate templates no longer writes normalized rows or deletes the legacy settings entry. Saved legacy templates remain available through a read-through adapter; any permanent data relocation needs separate approval.
- Agent list requests cannot override ready-to-sell/archive restrictions; direct record reads reject non-sale/archived records. Agent write denial and focal/admin role checks remain in place. This closes an authorization-boundary gap found during the audit; no database account or role changes occur.
- No secrets, password/JWT rotations, browser redesign, destructive migrations or automatic production changes are included.

## Package sections and execution

See [supabase-sql-editor-deployment.md](supabase-sql-editor-deployment.md) for the operator procedure. The offline renderer preserves canonical filenames and atomic receipt hashes. Logical sections map to:

| Requested section | Executable source/output |
| --- | --- |
| 00 preflight | `supabase/diagnostics/00_preflight.sql`, rendered into `checks/00_preflight.sql` with verified database/role/backup-reference values |
| 01 missing tables | canonical `202611030001_create_missing_runtime_tables.sql` |
| 02 missing columns | existing canonical 002 plus appended `202611030005_add_verified_biosecurity_warning.sql` |
| 03 constraints/indexes | New-table keys/index already in 001; `checks/03_constraints_indexes.sql` explicitly reports remaining catalog-dependent changes BLOCKED and performs no DDL |
| 04 relationships | `checks/04_relationship_repairs.sql` is read-only: no independent repair approved |
| 05 RLS/permissions | canonical 004 for newly marked objects and the verified trusted backend role only; preserves existing policies/grants |
| 06 seeds | `checks/06_seed_data.sql` is read-only: none approved |
| 07 verification | generated `supabase/diagnostics/07_verify_schema.sql`, also rendered under checks; verifies all column/types, conflict keys, generated IDs, extra mandatory columns, projections and sequence access |

`checks/review_bundle.sql` combines preflight, canonical versions in order and final read-only verification. Every canonical migration has its own BEGIN/COMMIT and receipt. Final verification failure does **not** roll back earlier committed files; stop and inspect, preserving the additive changes. Operator attestations do not prove backup restorability or project identity; separately verify both. Existing receipt hashes must match the rendered payload exactly. Never rewrite receipt history or replay historical destructive files.

## Release gates and tests

Production release requires: complete live inventory and actual Vercel role; verified restorable backup; reviewed exact delta and checksums; approved NULL semantics for unknown biosecurity assessments; approval for all new-object grants/RLS; real backend-role staging CRUD and focal/agent scope tests; owner approval before manual SQL execution; final endpoint HTTP 200 and two-device/offline-retry functional tests. Existing swine mapping treats falsy biosecurity values as false: do not equate that display with a verified historical assessment. Any tri-state domain change needs a separately approved adapter/UI decision.

No production backup was supplied for restoration. Local PostgreSQL fixtures cover legacy TEXT swine IDs, SERIAL audit IDs, rows/FKs/policies/grants, absent tables, reruns, receipts, unsafe role inheritance, checksum drift, unknown assessments, incompatible types and full-contract verification. They are not evidence of the unseen production layout.

## Validation results and changed files

TypeScript (`npm run lint`), all **62 tests** (`npm test`) and the full frontend/backend/PWA production build (`npm run build`) passed. Local regression fixtures require socket access; the sandbox-only run was retried with that permission. The network-isolated PostgreSQL 17 SQL Editor harness passed, including two executions per canonical file, preserved historical rows/IDs/FKs/policies, restricted backend writes, receipt checksum rejection, nullable assessments, incompatible-type rejection and schema verification failure/success fixtures. Final verification SQL also executed successfully against the complete type/write-contract fixture. No production backup was available, so real production-role CRUD, two-device/offline replay and production HTTP 200 remain unverified.

Files changed in this repair:

- `README.md`
- `docs/database-migration-architecture.md`
- `docs/schema-drift-repair.md`
- `docs/supabase-sql-editor-deployment.md`
- `package.json`
- `scripts/inspect-database-schema.ts`
- `scripts/prepare-sql-editor-bundle.ts`
- `scripts/test-sql-editor-bundle.sh`
- `src/db/catalog.test.ts`
- `src/db/catalog.ts`
- `src/db/certificateTemplates.test.ts`
- `src/db/certificateTemplates.ts`
- `src/db/migrationBundle.test.ts`
- `src/server/app.ts`
- `supabase/diagnostics/01_required_schema_inventory.sql`
- `supabase/proposals/review-manifest.json`
- `docs/production-schema-repair-report.md`
- `scripts/generate-contract-test-fixture.ts`
- `scripts/generate-schema-verification.ts`
- `src/db/writeRequirements.test.ts`
- `src/db/writeRequirements.ts`
- `src/server/swineReadScope.test.ts`
- `src/server/swineReadScope.ts`
- `supabase/diagnostics/00_preflight.sql`
- `supabase/diagnostics/07_verify_schema.sql`
- `supabase/review/202611030005_add_verified_biosecurity_warning.sql`
