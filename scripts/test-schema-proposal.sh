#!/usr/bin/env bash
set -euo pipefail
# This harness accepts only the explicitly created local, isolated test container.
container_name=${1:-swine-schema-review}
if [[ "$container_name" != swine-schema-review* ]]; then
  echo 'Refusing a container outside the disposable test namespace.' >&2
  exit 1
fi
swine_docker() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock "$@"
}
if [[ "$(swine_docker inspect --format '{{.HostConfig.NetworkMode}}' "$container_name")" != none ]]; then
  echo 'Test container must have networking disabled.' >&2
  exit 1
fi
for attempt in {1..30}; do
  if swine_docker exec "$container_name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres < scripts/fixtures/schema-compatibility-before.sql
for attempt in 1 2; do
  swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres < supabase/proposals/013_runtime_column_compatibility.sql
done
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres < scripts/fixtures/schema-compatibility-verify.sql
# A second database verifies the proposal refuses incompatible pre-existing types.
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres <<'SQL'
CREATE DATABASE incompatible_schema;
SQL
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d incompatible_schema <<'SQL'
CREATE TABLE issued_certificates(id text);
CREATE TABLE media_files(id text);
CREATE TABLE messages(id text,sender_id integer);
CREATE TABLE registry_schema(id text);
SQL
if swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d incompatible_schema < supabase/proposals/013_runtime_column_compatibility.sql; then
  echo 'Expected incompatible-type preflight rejection.' >&2
  exit 1
fi
swine_docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -U postgres -d incompatible_schema <<'SQL'
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('control_number','file_url','field_key')) THEN RAISE EXCEPTION 'Rejected proposal left partial changes'; END IF;
END $$;
SELECT 'PASS: incompatible type rejected before any additions' AS result;
SQL
