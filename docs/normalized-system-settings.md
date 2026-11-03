# Normalized system_settings compatibility fix

The existing Supabase table uses `setting_key TEXT` and `setting_value JSONB`. The application still mapped/queried legacy `key` and `value`, including health projections, causing PostgreSQL 42703. This is an application mapping error; adding duplicate columns or renaming production columns is unnecessary.

Changes:

- `src/db/schema.ts`: application properties `key`/`value` now map to SQL `setting_key`/`setting_value`. The normalized UUID primary key and unique setting key are modeled separately. Existing IDs are not updated by settings upserts.
- `src/db/settings.ts`: reads use the normalized mapping. pg already parses JSONB; the selected SQL expression avoids a second Drizzle JSON parse of legitimate JSON-looking string values. Writes bind serialized values with `::jsonb`, including JSON null, arrays, objects, booleans, numbers and strings. Undefined/unserializable values fail before a write.
- `src/db/registrySchema.ts`: raw reads, JSONB inserts and ON CONFLICT updates use normalized columns. Result alias `value` is an application result name, not a legacy database column.
- `src/db/certificateTemplates.ts`: the read-only legacy-template settings lookup uses normalized columns and preserves the saved settings entry.
- `src/db/writeRequirements.ts`: conflict target is `setting_key`; omitted UUID id must have a database generator. Existing constraints/defaults are inspected, never changed automatically.
- Generated `supabase/diagnostics/01_required_schema_inventory.sql`, `07_verify_schema.sql` and `docs/repository-schema-comparison.json` now reflect the normalized contract (164 required columns). `requirements.ts` and health derive these columns from Drizzle automatically.
- Regression tests cover generated SQL, UUID preservation, JSONB value fidelity, raw readers/upserts and template access.

No migration is required for this mismatch on the confirmed normalized table. No existing settings, rows, columns, policies, grants or versioned migration payloads were modified. Runtime initialization remains disabled. Historical SQL files remain history and must not be replayed to add legacy aliases.

After approval, deploy the application commit using the existing Vercel configuration, then request `/api/health`. The system_settings projection must reference `id`, `setting_key`, `setting_value`, `updated_at`. Test existing appearance, registry-form and certificate settings through authorized APIs and confirm focal/admin permissions remain intact.

Other schema drift still requires the read-only live inventory (`npm run db:inspect` with a privately configured DATABASE_URL). Existing review versions 000–005 remain review-only and unchanged; apply only the subset justified by the current catalog and approved by the operator. This fix does not prove those historical missing objects are still absent or that all production health checks pass. No production deployment or migration was performed.
