#!/usr/bin/env bash
set -euo pipefail
container_name=${1:-swine-migration-architecture}
[[ "$container_name" == swine-migration-architecture* ]] || { echo 'Refusing non-test container.' >&2; exit 1; }
swine_docker() { env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"; }
[[ "$(swine_docker inspect --format '{{.HostConfig.NetworkMode}}' "$container_name")" == none ]] || { echo 'Networking must be disabled.' >&2; exit 1; }
for attempt in {1..30}; do
 if swine_docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 1
done
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE users(id uuid PRIMARY KEY, name text, auth_user_id uuid);
CREATE TABLE barangays(id uuid PRIMARY KEY);
CREATE TABLE farmers(id uuid PRIMARY KEY,barangay_id uuid REFERENCES barangays(id));
CREATE TABLE swine_records(id text PRIMARY KEY,farmer_id uuid REFERENCES farmers(id),pig_id_tag text,computed_pig_id text,original_tag_number text);
CREATE TABLE audit_logs(id serial PRIMARY KEY,user_id uuid REFERENCES users(id),action text);
CREATE TABLE messages(id text PRIMARY KEY,user_id uuid REFERENCES users(id),body text);
CREATE TABLE registry_schema(id uuid PRIMARY KEY,field_key text);
INSERT INTO users VALUES ('00000000-0000-4000-8000-000000000001','Existing account','00000000-0000-4000-8000-000000000001');
INSERT INTO barangays VALUES ('00000000-0000-4000-8000-000000000002');
INSERT INTO farmers VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
INSERT INTO swine_records VALUES ('SWINE-LEGACY-001','00000000-0000-4000-8000-000000000003','HIN-2024-0047','HIN-2026-0050','HIN-2019-0100');
INSERT INTO audit_logs(user_id,action) VALUES ('00000000-0000-4000-8000-000000000001','Historical audit');
INSERT INTO messages VALUES ('legacy-message','00000000-0000-4000-8000-000000000001','Existing history');
INSERT INTO registry_schema VALUES ('00000000-0000-4000-8000-000000000004','existing_key');
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY existing_private_messages ON messages FOR SELECT TO authenticated USING(false);
GRANT SELECT ON messages TO authenticated;
CREATE TABLE _before_constraints AS SELECT oid,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace;
CREATE TABLE _before_policies AS SELECT * FROM pg_policies WHERE schemaname='public';
CREATE TABLE _before_grants AS SELECT * FROM information_schema.role_table_grants WHERE table_schema='public';
CREATE TABLE _before_rows AS
 SELECT 'users' AS table_name,to_jsonb(r) AS document FROM users r
 UNION ALL SELECT 'farmers',to_jsonb(r) FROM farmers r
 UNION ALL SELECT 'swine_records',to_jsonb(r) FROM swine_records r
 UNION ALL SELECT 'audit_logs',to_jsonb(r) FROM audit_logs r
 UNION ALL SELECT 'messages',to_jsonb(r) FROM messages r
 UNION ALL SELECT 'registry_schema',to_jsonb(r) FROM registry_schema r;
-- Simulate an unsafe Supabase default grant. New-table SQL must revoke it.
ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon;
SQL
for migration in 014_create_missing_runtime_tables.sql 013_runtime_column_compatibility.sql 015_create_missing_swine_tag_sequence.sql; do
 swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres < "supabase/proposals/$migration"
done
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE TABLE _after_oids AS SELECT oid,relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','S');
DO $$ BEGIN
 IF (SELECT last_value FROM swine_tag_seq)<>101 OR (SELECT is_called FROM swine_tag_seq) THEN RAISE EXCEPTION 'New sequence must start above existing tags without consuming one'; END IF;
END $$;
SELECT nextval('public.swine_tag_seq');
SQL
for migration in 014_create_missing_runtime_tables.sql 013_runtime_column_compatibility.sql 015_create_missing_swine_tag_sequence.sql; do
 swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres < "supabase/proposals/$migration"
done
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
DO $$ DECLARE item record; BEGIN
 IF EXISTS(SELECT * FROM _after_oids EXCEPT SELECT oid,relname FROM pg_class WHERE relnamespace='public'::regnamespace) THEN RAISE EXCEPTION 'Rerun replaced existing objects'; END IF;
 IF EXISTS(SELECT * FROM _before_constraints EXCEPT SELECT oid,pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace='public'::regnamespace) THEN RAISE EXCEPTION 'Existing foreign keys/constraints changed'; END IF;
 IF EXISTS(SELECT * FROM _before_policies EXCEPT SELECT * FROM pg_policies WHERE schemaname='public') THEN RAISE EXCEPTION 'Existing RLS changed'; END IF;
 IF EXISTS(SELECT * FROM _before_grants EXCEPT SELECT * FROM information_schema.role_table_grants WHERE table_schema='public') THEN RAISE EXCEPTION 'Existing grants changed'; END IF;
 IF EXISTS(WITH current_rows AS (
  SELECT 'users' AS table_name,to_jsonb(r) AS document FROM users r
  UNION ALL SELECT 'farmers',to_jsonb(r) FROM farmers r
  UNION ALL SELECT 'swine_records',to_jsonb(r) FROM swine_records r
  UNION ALL SELECT 'audit_logs',to_jsonb(r) FROM audit_logs r
  UNION ALL SELECT 'messages',to_jsonb(r)-'sender_id' FROM messages r
  UNION ALL SELECT 'registry_schema',to_jsonb(r) FROM registry_schema r
 ) SELECT * FROM _before_rows EXCEPT SELECT * FROM current_rows) THEN RAISE EXCEPTION 'Existing records changed'; END IF;
 IF (SELECT count(*) FROM swine_records)<>1 OR (SELECT count(*) FROM users)<>1 THEN RAISE EXCEPTION 'Existing row counts changed'; END IF;
 IF (SELECT data_type FROM information_schema.columns WHERE table_name='swine_records' AND column_name='id')<>'text' THEN RAISE EXCEPTION 'Legacy ID was converted'; END IF;
 IF (SELECT data_type FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='id')<>'integer' THEN RAISE EXCEPTION 'Legacy audit ID was converted'; END IF;
 FOR item IN SELECT oid,relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('issued_certificates','media_files','legal_documents','legal_document_audit_logs') LOOP
  IF NOT item.relrowsecurity OR NOT item.relforcerowsecurity THEN RAISE EXCEPTION 'New table % lacks RLS',item.relname; END IF;
  IF has_table_privilege('anon',item.oid,'SELECT') OR has_table_privilege('authenticated',item.oid,'SELECT') THEN RAISE EXCEPTION 'New table % exposes public access',item.relname; END IF;
 END LOOP;
 IF (SELECT last_value FROM swine_tag_seq)<>101 OR NOT (SELECT is_called FROM swine_tag_seq) THEN RAISE EXCEPTION 'Existing sequence was reset'; END IF;
 IF nextval('public.swine_tag_seq')<>102 THEN RAISE EXCEPTION 'Sequence replay is unsafe'; END IF;
END $$;
SELECT 'PASS: preserved legacy IDs, records, FKs, grants and policies; new tables deny by default; sequence is monotonic and rerunnable' AS result;
SQL
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres < supabase/diagnostics/03_identifier_relationship_audit.sql
