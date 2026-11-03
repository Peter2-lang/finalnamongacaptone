import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import * as schema from '../db/schema.ts';

/** Read-only probes validate every ORM table and column without scanning records. */
export async function verifyDatabaseSchema(client: Pick<PoolClient, 'query'>): Promise<void> {
  for (const table of Object.values(schema)) {
    const columns = Object.values(getTableColumns(table)).map(column => `"${column.name.replaceAll('"', '""')}"`);
    const name = getTableName(table).replaceAll('"', '""');
    await client.query(`SELECT ${columns.join(', ')} FROM public."${name}" LIMIT 0`);
  }
}
