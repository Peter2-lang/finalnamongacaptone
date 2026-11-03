import '../src/server/env.ts';
import { Pool } from 'pg';
import { getDatabasePoolConfig } from '../src/db/poolConfig.ts';
import { getRequiredDatabaseColumns } from '../src/db/requirements.ts';
import { getDatabaseDiagnostic } from '../src/db/diagnostics.ts';

let pool: Pool | undefined;
try {
  pool = new Pool(getDatabasePoolConfig());
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    const { rows } = await client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      "SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name,ordinal_position",
    );
    const actual = new Map(rows.map(item => [`${item.table_name}.${item.column_name}`, item]));
    const report = getRequiredDatabaseColumns().map(required => {
      const column = actual.get(`${required.table}.${required.column}`);
      return { ...required, status: column ? 'present_review_type' : 'missing_column_or_not_visible', actualType: column?.data_type, nullable: column?.is_nullable };
    });
    // Do not dump defaults, functions, records, connection strings or credentials.
    console.log(JSON.stringify({ requiredColumns: report.length, missingColumns: report.filter(item => item.status !== 'present_review_type'), columns: report }, null, 2));
    await client.query('ROLLBACK');
    if (report.some(item => item.status !== 'present_review_type')) process.exitCode = 1;
  } finally { client.release(); }
} catch (error) {
  console.error(JSON.stringify({ schemaInspection: 'failed', ...getDatabaseDiagnostic(error) }));
  process.exitCode = 1;
} finally { await pool?.end(); }
