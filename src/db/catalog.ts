import type { PoolClient } from 'pg';
import { getRequiredDatabaseColumns } from './requirements.ts';

export const COLUMN_CATALOG_SQL = `SELECT c.relname AS table_name, a.attname AS column_name,
  pg_catalog.format_type(a.atttypid,a.atttypmod) AS data_type,
  a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS column_default,
  EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey)) AS primary_key
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum`;

export interface CatalogColumn { table_name: string; column_name: string; data_type: string; not_null: boolean; column_default: string | null; primary_key: boolean }

export function normalizePostgresType(type: string): string {
  const value = type.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return ({ int4: 'integer', int8: 'bigint', int2: 'smallint', bool: 'boolean', varchar: 'character varying', decimal: 'numeric', float8: 'double precision', 'timestamp without time zone': 'timestamp', 'timestamp with time zone': 'timestamptz' } as Record<string,string>)[value] || value;
}

export function comparePostgresTypes(expected: string, actual: string): 'compatible' | 'review' | 'incompatible' {
  const left = normalizePostgresType(expected), right = normalizePostgresType(actual);
  if (left === right || ([left,right].every(type => ['text','character varying'].includes(type)))) return 'compatible';
  // Drizzle reads both timestamp forms; interpreting existing wall-clock data
  // requires a timezone decision and must never trigger an automatic conversion.
  if ([left,right].every(type => ['timestamp','timestamptz'].includes(type))) return 'review';
  return 'incompatible';
}

export function compareDatabaseCatalog(actual: CatalogColumn[]) {
  const byName = new Map(actual.map(column => [`${column.table_name}.${column.column_name}`, column]));
  return getRequiredDatabaseColumns().map(required => {
    const found = byName.get(`${required.table}.${required.column}`);
    return { ...required, status: found ? comparePostgresTypes(required.sqlType, found.data_type) : 'missing', actualType: found?.data_type, notNull: found?.not_null, primaryKey: found?.primary_key, hasDefault: found ? found.column_default !== null : undefined };
  });
}

/** Extra legacy mandatory columns can reject INSERT even after aliases are added. */
export function findUnmodeledRequiredColumns(actual: CatalogColumn[]) {
  const contract = getRequiredDatabaseColumns();
  const tables = new Set(contract.map(item => item.table));
  const columns = new Set(contract.map(item => `${item.table}.${item.column}`));
  return actual.filter(column => tables.has(column.table_name) && !columns.has(`${column.table_name}.${column.column_name}`) && column.not_null && column.column_default === null)
    .map(column => ({ table: column.table_name, column: column.column_name, actualType: column.data_type, reason: 'mandatory_column_not_written_by_current_contract' }));
}

export class DatabaseTypeCompatibilityError extends Error {
  readonly code = 'SCHEMA_TYPE_MISMATCH';
  constructor(readonly table: string, readonly column: string, readonly expectedType: string, readonly actualType: string) {
    super('Database type does not match the application contract; inspect identifiers and relationships before changing either side.');
  }
}

export async function verifyDatabaseTypes(client: Pick<PoolClient,'query'>): Promise<void> {
  const { rows } = await client.query<CatalogColumn>(COLUMN_CATALOG_SQL);
  const mismatch = compareDatabaseCatalog(rows).find(item => item.status === 'incompatible' || item.status === 'missing');
  if (mismatch) throw new DatabaseTypeCompatibilityError(mismatch.table, mismatch.column, mismatch.sqlType, mismatch.actualType || 'missing_from_catalog');
}
