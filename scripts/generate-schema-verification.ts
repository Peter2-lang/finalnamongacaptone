import { writeFileSync } from 'node:fs';
import { COLUMN_CATALOG_SQL, normalizePostgresType } from '../src/db/catalog.ts';
import { getRequiredDatabaseColumns } from '../src/db/requirements.ts';
import { INDEX_CATALOG_SQL, REQUIRED_CONFLICT_KEYS, REQUIRED_GENERATED_IDS } from '../src/db/writeRequirements.ts';
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'";
const values=getRequiredDatabaseColumns().map(item=>`(${literal(item.table)},${literal(item.column)},${literal(normalizePostgresType(item.sqlType))})`).join(',\n');
const keyValues=REQUIRED_CONFLICT_KEYS.map(([table,column])=>`(${literal(table)},${literal(column)})`).join(',');
const idValues=REQUIRED_GENERATED_IDS.map(([table,column])=>`(${literal(table)},${literal(column)})`).join(',');
const columnsCte=`WITH required(table_name,column_name,expected_type) AS (VALUES ${values}),
actual AS (${COLUMN_CATALOG_SQL}), normalized AS (
 SELECT *,CASE regexp_replace(data_type,'\\([^)]*\\)','','g')
 WHEN 'timestamp without time zone' THEN 'timestamp' WHEN 'timestamp with time zone' THEN 'timestamptz'
 ELSE regexp_replace(data_type,'\\([^)]*\\)','','g') END AS actual_type FROM actual),
comparison AS (SELECT r.*,a.actual_type,
 CASE WHEN a.column_name IS NULL THEN 'missing'
 WHEN expected_type=actual_type OR (expected_type IN ('text','character varying') AND actual_type IN ('text','character varying')) THEN 'compatible'
 WHEN expected_type IN ('timestamp','timestamptz') AND actual_type IN ('timestamp','timestamptz') THEN 'review_timezone'
 ELSE 'incompatible' END AS status
 FROM required r LEFT JOIN normalized a USING(table_name,column_name))`;
const conflictCte=`WITH required(table_name,column_name) AS (VALUES ${keyValues}), indexes AS (${INDEX_CATALOG_SQL})
 SELECT r.* FROM required r WHERE NOT EXISTS(SELECT 1 FROM indexes i WHERE i.table_name=r.table_name AND i.is_unique AND i.is_valid AND i.is_ready AND i.is_immediate AND i.predicate IS NULL AND i.expression IS NULL AND i.columns=ARRAY[r.column_name])`;
const generatorCte=`WITH required(table_name,column_name) AS (VALUES ${idValues}), actual AS (${COLUMN_CATALOG_SQL})
 SELECT r.* FROM required r LEFT JOIN actual a USING(table_name,column_name)
 WHERE a.column_name IS NULL OR (a.column_default IS NULL AND a.identity_kind='' AND a.generated_kind='')`;
const mandatoryCte=`WITH required(table_name,column_name,expected_type) AS (VALUES ${values}), actual AS (${COLUMN_CATALOG_SQL})
 SELECT a.* FROM actual a WHERE a.table_name IN (SELECT table_name FROM required)
 AND a.not_null AND a.column_default IS NULL AND a.identity_kind='' AND a.generated_kind=''
 AND NOT EXISTS(SELECT 1 FROM required r WHERE r.table_name=a.table_name AND r.column_name=a.column_name)`;
const sql=`-- Generated read-only verification. No DDL, row updates, seeds or nextval.
-- Run first as catalog owner, then under the real backend connection role.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name,current_user AS inspecting_role;
${columnsCte} SELECT * FROM comparison ORDER BY table_name,column_name;
-- All below are release blockers, not instructions to create guessed relationships.
${conflictCte};
${generatorCte};
${mandatoryCte};
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c
WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') ORDER BY c.relname;
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
DO $verification$
DECLARE problem record;
BEGIN
 FOR problem IN ${columnsCte} SELECT * FROM comparison WHERE status IN ('missing','incompatible') LOOP
  RAISE EXCEPTION 'Schema contract blocked: %.% expected %, actual %',problem.table_name,problem.column_name,problem.expected_type,coalesce(problem.actual_type,'missing');
 END LOOP;
 FOR problem IN ${conflictCte} LOOP
  RAISE EXCEPTION 'Write contract blocked: %.% needs a usable unique conflict target; inspect duplicates and dependencies first.',problem.table_name,problem.column_name;
 END LOOP;
 FOR problem IN ${generatorCte} LOOP
  RAISE EXCEPTION 'Write contract blocked: %.% is omitted on INSERT without a database generator.',problem.table_name,problem.column_name;
 END LOOP;
 FOR problem IN ${mandatoryCte} LOOP
  RAISE EXCEPTION 'Write contract review required: extra mandatory %.% is not modeled; preserve its constraint and adapt the INSERT.',problem.table_name,problem.column_name;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.swine_tag_seq') AND relkind='S') THEN
  RAISE EXCEPTION 'Required public.swine_tag_seq is missing or not a sequence.';
 END IF;
 IF NOT (has_sequence_privilege('public.swine_tag_seq','USAGE') OR has_sequence_privilege('public.swine_tag_seq','UPDATE')) THEN
  RAISE EXCEPTION 'Inspecting role cannot allocate tags; verify with the actual backend connection role.';
 END IF;
 -- Reproduce the health projections to detect SELECT permission failures without reading rows.
 ${[...new Set(getRequiredDatabaseColumns().map(item=>item.table))].map(table=>`PERFORM ${getRequiredDatabaseColumns().filter(item=>item.table===table).map(item=>'"'+item.column+'"').join(',')} FROM public."${table}" LIMIT 0;`).join('\n ')}
END $verification$;
-- Passing this probe is NOT proof of RLS scope, historical data semantics or CRUD.
-- Also compare diagnostics 01-04, legacy mandatory columns and API functional tests.
COMMIT;
`;
writeFileSync('supabase/diagnostics/07_verify_schema.sql',sql);
console.log('Generated read-only full column/type, upsert-index and generated-ID verification. No database contacted.');
