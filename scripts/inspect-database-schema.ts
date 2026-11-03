import '../src/server/env.ts';
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
    const constraints = await client.query(`SELECT c.relname AS table_name, con.conname, con.contype,
      pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con
      JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' ORDER BY c.relname,con.conname`);
    const policies = await client.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname");
    // Do not dump defaults, functions, records, connection strings or credentials.
    console.log(JSON.stringify({ requiredColumns: report.length, missingColumns: report.filter(item => item.status === 'missing'), incompatibleTypes: report.filter(item => item.status === 'incompatible'), typeReviews: report.filter(item => item.status === 'review'), unmodeledRequiredColumns: findUnmodeledRequiredColumns(rows), columns: report, constraints: constraints.rows, policies: policies.rows }, null, 2));
    await client.query('ROLLBACK');
    if (report.some(item => item.status === 'missing' || item.status === 'incompatible')) process.exitCode = 1;
  } finally { client.release(); }
} catch (error) {
  console.error(JSON.stringify({ schemaInspection: 'failed', ...getDatabaseDiagnostic(error) }));
  process.exitCode = 1;
} finally { await pool?.end(); }
