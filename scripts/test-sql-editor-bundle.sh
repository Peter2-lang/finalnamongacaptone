#!/usr/bin/env bash
set -euo pipefail
container_name=${1:-swine-migration-architecture-sql-editor}
[[ "$container_name" == swine-migration-architecture* ]] || { echo 'Only an isolated test container is accepted.' >&2; exit 1; }
swine_docker() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
[[ "$(swine_docker inspect --format '{{.HostConfig.NetworkMode}}' "$container_name")" == none ]] || { echo 'Networking must be disabled.' >&2; exit 1; }
bundle_dir=$(mktemp -d /tmp/swine-editor-bundle.XXXXXX)
trap 'rm -rf "$bundle_dir"' EXIT
node --import tsx scripts/prepare-sql-editor-bundle.ts --backend-role registry_review_backend --database-name fresh_editor_review --backup-reference isolated-fixture-only --out-dir "$bundle_dir"
# First verify legacy IDs, data and existing-policy preservation on mixed layouts.
bash scripts/test-migration-architecture.sh "$container_name"
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE ROLE registry_review_backend NOLOGIN NOBYPASSRLS;
SQL
for run in 1 2; do
 for file in "$bundle_dir"/*.sql; do
  swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres < "$file"
 done
done
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
DO $$ BEGIN
 IF (SELECT count(*) FROM registry_migrations.applied_migrations)<>6 THEN RAISE EXCEPTION 'Receipts missing or duplicated'; END IF;
 IF has_table_privilege('registry_review_backend','public.messages','SELECT') THEN RAISE EXCEPTION 'Existing table grants were broadened'; END IF;
 IF has_schema_privilege('anon','registry_migrations','USAGE') THEN RAISE EXCEPTION 'Ledger schema exposed to browser'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.media_files'::regclass AND 0=ANY(polroles)) THEN RAISE EXCEPTION 'A new policy applies to PUBLIC'; END IF;
END $$;
SET ROLE registry_review_backend;
INSERT INTO legal_documents(id,document) VALUES ('test-doc','{"title":"test fixture only"}');
INSERT INTO legal_document_audit_logs(id,document_id,document_title,action,actor_id,actor_name,actor_role,details)
VALUES ('00000000-0000-4000-8000-000000000099','test-doc','test','create','test-user','test','admin','test');
DO $$ BEGIN
 IF (SELECT count(*) FROM legal_documents)<>1 THEN RAISE EXCEPTION 'Trusted backend cannot read its new table'; END IF;
 IF has_table_privilege(current_user,'public.legal_document_audit_logs','UPDATE') OR has_table_privilege(current_user,'public.legal_document_audit_logs','DELETE') THEN RAISE EXCEPTION 'Audit mutation grants are too broad'; END IF;
END $$;
RESET ROLE;
CREATE DATABASE fresh_editor_review;
SQL
# Also exercise the generated files directly on genuinely absent runtime tables.
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review <<'SQL'
CREATE TABLE swine_records(id text PRIMARY KEY,ear_tag_number text);
INSERT INTO swine_records VALUES ('original-id','HIN-2025-0900');
SQL
for run in 1 2; do
 for file in "$bundle_dir"/*.sql; do
  swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review < "$file"
 done
done
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review <<'SQL'
SET ROLE registry_review_backend;
INSERT INTO messages(id,sender_id,sender_name,text) VALUES ('test-message','test-user','test','fixture only');
DO $$ BEGIN
 IF (SELECT count(*) FROM messages)<>1 THEN RAISE EXCEPTION 'Backend policy is not usable'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF has_table_privilege('anon','public.messages','SELECT') OR has_table_privilege('authenticated','public.messages','SELECT') THEN RAISE EXCEPTION 'New messages are exposed to browser roles'; END IF;
 IF (SELECT count(*) FROM registry_migrations.applied_migrations)<>6 THEN RAISE EXCEPTION 'Fresh receipts missing'; END IF;
 IF (SELECT last_value FROM swine_tag_seq)<>901 OR (SELECT is_called FROM swine_tag_seq) THEN RAISE EXCEPTION 'Migration reset or consumed tag sequence'; END IF;
 IF NOT EXISTS(SELECT 1 FROM swine_records WHERE id='original-id') THEN RAISE EXCEPTION 'Existing identity was modified'; END IF;
END $$;
SELECT 'PASS: scoped backend RLS, immutable audit grants, private receipts and idempotent SQL Editor runs' AS result;
SQL
# Refuse dangerous inherited membership without automatically modifying roles.
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review <<'SQL'
GRANT registry_review_backend TO authenticated;
SQL
if swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review < "$bundle_dir/202611030004_scope_new_objects_to_backend.sql"; then
 echo 'Expected inherited-browser-role rejection.' >&2; exit 1
fi
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review <<'SQL'
REVOKE registry_review_backend FROM authenticated;
SELECT 'PASS: browser role membership escalation is refused' AS result;
SQL
# Refuse checksum drift; receipts and prior migration results must remain intact.
sed 's/sha256<>\x27[0-9a-f]*\x27/sha256<>\x27ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\x27/' "$bundle_dir/202611030000_create_private_migration_receipts.sql" > "$bundle_dir/drift-check.sql"
if swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review < "$bundle_dir/drift-check.sql"; then
 echo 'Expected checksum drift rejection.' >&2; exit 1
fi
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review <<'SQL'
DO $$ BEGIN IF (SELECT count(*) FROM registry_migrations.applied_migrations)<>6 THEN RAISE EXCEPTION 'Receipt history changed after rejected drift'; END IF; END $$;
SELECT 'PASS: checksum drift rejected without overwriting history' AS result;
SQL

# Confirm the production-specific additive fix preserves unknown assessments.
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review <<'SQL'
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM swine_records WHERE biosecurity_warning IS NOT NULL) THEN RAISE EXCEPTION 'Unknown historical assessment was fabricated'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='swine_records' AND column_name='biosecurity_warning' AND (is_nullable<>'YES' OR column_default IS NOT NULL)) THEN RAISE EXCEPTION 'Assessment was assigned a default or made mandatory'; END IF;
END $$;
SQL
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review < "$bundle_dir/checks/00_preflight.sql"
# Full verification must reject this deliberately incomplete fixture.
if swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review < "$bundle_dir/checks/07_verify_schema.sql"; then
 echo 'Expected incomplete-schema verification rejection.' >&2; exit 1
fi
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE DATABASE incompatible_editor_review;
CREATE DATABASE complete_contract_review;
SQL
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d incompatible_editor_review <<'SQL'
CREATE TABLE swine_records(id text PRIMARY KEY,biosecurity_warning integer);
INSERT INTO swine_records VALUES ('unchanged',1);
SQL
if swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d incompatible_editor_review < supabase/review/202611030005_add_verified_biosecurity_warning.sql; then
 echo 'Expected incompatible assessment type rejection.' >&2; exit 1
fi
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d incompatible_editor_review <<'SQL'
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM swine_records WHERE id='unchanged' AND biosecurity_warning=1) THEN RAISE EXCEPTION 'Rejected migration changed data'; END IF; END $$;
SQL
# Build only a disposable contract fixture, never a deployable bootstrap migration.
node --import tsx scripts/generate-contract-test-fixture.ts > "$bundle_dir/fixture.sql"
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d complete_contract_review < "$bundle_dir/fixture.sql"
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d complete_contract_review < "$bundle_dir/checks/07_verify_schema.sql"
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d fresh_editor_review < supabase/diagnostics/04_migration_history_and_role.sql
printf '%s\n' 'PASS: nullable unknown assessments preserved, incompatible types rejected, preflight and full contract verification validated'
