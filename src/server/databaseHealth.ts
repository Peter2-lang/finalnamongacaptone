import type { PoolClient } from 'pg';
import { getRequiredDatabaseTables } from '../db/requirements.ts';
import { COLUMN_CATALOG_SQL, DatabaseTypeCompatibilityError, verifyDatabaseTypes } from '../db/catalog.ts';

export const SEQUENCE_READINESS_SQL = `SELECT c.relkind='S' AS present,
  CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE') OR has_sequence_privilege(c.oid,'UPDATE') ELSE false END AS usable
FROM (SELECT to_regclass('public.swine_tag_seq') AS oid) s LEFT JOIN pg_class c ON c.oid=s.oid`;

export class DatabaseSchemaProbeError extends Error {
  readonly code?: string;
  readonly table: string;
  readonly column?: string;
  readonly statement: string;
  constructor(error: unknown, table: string, columns: string[], statement: string) {
    super('Required database schema probe failed.', { cause: error });
    const original = error as { code?: string; column?: string; message?: string; position?: string };
    this.code = original?.code;
    this.table = table;
    // Return only an identifier from our own known contract, never raw PG text.
    const position = /^\d+$/.test(original?.position || '') ? Number(original.position) - 1 : -1;
    const fromPosition = columns.find(column => {
      const quoted = `"${column.replaceAll('"', '""')}"`;
      const start = statement.indexOf(quoted);
      return position >= start && position < start + quoted.length;
    });
    const fromMessage = original?.message?.match(/column (?:(?:"[^"\n]+"|[a-z_][a-z_0-9]*)\.)?"?([a-z_][a-z_0-9]*)"? does not exist/i)?.[1];
    const candidate = fromPosition || original?.column || fromMessage;
    this.column = candidate && columns.includes(candidate) ? candidate : undefined;
    this.statement = statement;
  }
}

export function getSchemaProbeFailure(error: unknown) {
  if (error instanceof DatabaseTypeCompatibilityError) return { table: error.table, column: error.column, statement: COLUMN_CATALOG_SQL, expectedType: error.expectedType, actualType: error.actualType };
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
  await verifyDatabaseTypes(client);
  const { rows } = await client.query(SEQUENCE_READINESS_SQL);
  if (!rows[0]?.present || !rows[0]?.usable) {
    const code = rows[0]?.present ? '42501' : 'SCHEMA_OBJECT_MISSING';
    throw new DatabaseSchemaProbeError(Object.assign(new Error('Required sequence is missing or inaccessible.'), { code }), 'swine_tag_seq', [], SEQUENCE_READINESS_SQL);
  }
}
