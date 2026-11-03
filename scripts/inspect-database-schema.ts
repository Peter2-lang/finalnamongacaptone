import '../src/server/env.ts';
import { INDEX_CATALOG_SQL, findMissingConflictKeys, REQUIRED_GENERATED_IDS, type CatalogIndex } from '../src/db/writeRequirements.ts';
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/db/poolConfig.ts';
import { COLUMN_CATALOG_SQL, compareDatabaseCatalog, findUnmodeledRequiredColumns, type CatalogColumn } from '../src/db/catalog.ts';
import { getDatabaseDiagnostic } from '../src/db/diagnostics.ts';

let pool: Pool | undefined;
try {
  pool = new Pool(getDatabasePoolConfig());
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const { rows } = await client.query<CatalogColumn>(COLUMN_CATALOG_SQL);
    const report = compareDatabaseCatalog(rows);
    const identity = await client.query('SELECT current_user AS database_role,current_database() AS database_name');
    const indexes = await client.query<CatalogIndex>(INDEX_CATALOG_SQL);
    const missingConflictKeys = findMissingConflictKeys(indexes.rows);
    const missingGeneratedIds = REQUIRED_GENERATED_IDS.filter(([table,column]) => !rows.some(item => item.table_name===table && item.column_name===column && (item.column_default!==null || item.identity_kind || item.generated_kind))).map(([table,column])=>({table,column,reason:'insert_omits_id_without_database_generator'}));
    const tables = await client.query("SELECT c.relname AS table_name,c.relkind,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced,pg_get_userbyid(c.relowner) AS owner FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m') ORDER BY c.relname");
    const grants = await client.query("SELECT table_name,grantee,privilege_type,is_grantable FROM information_schema.role_table_grants WHERE table_schema='public' ORDER BY table_name,grantee,privilege_type");
    const triggers = await client.query("SELECT c.relname AS table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal ORDER BY c.relname,t.tgname");
    const sequences = await client.query("SELECT c.relname AS sequence_name,pg_get_userbyid(c.relowner) AS owner,has_sequence_privilege(c.oid,'USAGE') AS usable FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='S' ORDER BY c.relname");
    const role = await client.query("SELECT rolname,rolcanlogin,rolinherit,rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user");
    const missingTables = [...new Set(report.filter(item=>item.status==='missing').map(item=>item.table))].filter(table=>!tables.rows.some(item=>item.table_name===table));
    const constraints = await client.query(`SELECT c.relname AS table_name, con.conname, con.contype,
      pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,con.conname`);
    const policies = await client.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname");
    // Do not dump defaults, functions, records, connection strings or credentials.
    console.log(JSON.stringify({ reportVersion:2, readOnly:true, capturedAt:new Date().toISOString(), identity:identity.rows[0], databaseRole:role.rows[0], missingTables, missingConflictKeys, missingGeneratedIds, tables:tables.rows, indexes:indexes.rows, grants:grants.rows, triggers:triggers.rows, sequences:sequences.rows, requiredColumns: report.length, missingColumns: report.filter(item => item.status === 'missing'), incompatibleTypes: report.filter(item => item.status === 'incompatible'), typeReviews: report.filter(item => item.status === 'review'), unmodeledRequiredColumns: findUnmodeledRequiredColumns(rows), columns: report, constraints: constraints.rows, policies: policies.rows }, null, 2));
    await client.query('ROLLBACK');
    if (missingConflictKeys.length || missingGeneratedIds.length || findUnmodeledRequiredColumns(rows).length || report.some(item => item.status === 'missing' || item.status === 'incompatible')) process.exitCode = 1;
  } finally { client.release(); }
} catch (error) {
  console.error(JSON.stringify({ schemaInspection: 'failed', ...getDatabaseDiagnostic(error) }));
  process.exitCode = 1;
} finally { await pool?.end(); }
