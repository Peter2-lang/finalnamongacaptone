import type { PoolClient } from 'pg';
import { getRequiredDatabaseTables } from '../db/requirements.ts';

export class DatabaseSchemaProbeError extends Error {
  readonly code?: string;
  readonly table: string;
  readonly column?: string;
  readonly statement: string;
  constructor(error: unknown, table: string, columns: string[], statement: string) {
    super('Required database schema probe failed.', { cause: error });
    const original = error as { code?: string; column?: string; message?: string };
    this.code = original?.code;
    this.table = table;
    // Return only an identifier from our own known contract, never raw PG text.
    const candidate = original?.column || original?.message?.match(/column "([^"]+)" does not exist/)?.[1]?.split('.').pop();
    this.column = candidate && columns.includes(candidate) ? candidate : undefined;
    this.statement = statement;
  }
}

export function getSchemaProbeFailure(error: unknown) {
  if (!(error instanceof DatabaseSchemaProbeError)) return undefined;
  return { table: error.table, column: error.column, statement: error.statement };
}

/** Read-only probes validate ORM and raw-query columns without scanning records. */
export async function verifyDatabaseSchema(client: Pick<PoolClient, 'query'>): Promise<void> {
  for (const [table, columns] of getRequiredDatabaseTables()) {
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const statement = `SELECT ${columns.map(quote).join(', ')} FROM public.${quote(table)} LIMIT 0`;
    try { await client.query(statement); } catch (error) { throw new DatabaseSchemaProbeError(error, table, columns, statement); }
  }
}
