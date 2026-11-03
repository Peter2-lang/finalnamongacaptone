/** Explicit INSERT/ON CONFLICT dependencies. These are checks, never authority to alter data. */
export const REQUIRED_CONFLICT_KEYS = [
  ['users', 'id'], ['swine_records', 'id'],
  ['issued_certificates', 'id'], ['messages', 'id'], ['media_files', 'id'],
  ['system_settings', 'setting_key'], ['registry_schema', 'id'], ['legal_documents', 'id'],
  ['certificate_templates', 'code'],
] as const;

// Raw INSERTs omit these identifiers; the database must supply them.
export const REQUIRED_GENERATED_IDS = [
  ['barangays', 'id'], ['certificate_templates', 'id'], ['farmers', 'id'], ['system_settings', 'id'],
] as const;

export interface CatalogIndex {
  table_name: string; index_name: string; columns: string[];
  is_unique: boolean; is_valid: boolean; is_ready: boolean; is_immediate: boolean;
  predicate: string | null; expression: string | null;
}

export const INDEX_CATALOG_SQL = `SELECT t.relname AS table_name, i.relname AS index_name,
  x.indisunique AS is_unique, x.indisvalid AS is_valid, x.indisready AS is_ready,
  x.indimmediate AS is_immediate, pg_get_expr(x.indpred,x.indrelid) AS predicate,
  pg_get_expr(x.indexprs,x.indrelid) AS expression,
  ARRAY(SELECT a.attname::text FROM unnest(x.indkey) WITH ORDINALITY k(attnum,ord)
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE k.ord<=x.indnkeyatts ORDER BY k.ord) AS columns,
  pg_get_indexdef(i.oid) AS definition
FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
WHERE t.relnamespace='public'::regnamespace ORDER BY t.relname,i.relname`;

export function findMissingConflictKeys(indexes: CatalogIndex[]) {
  return REQUIRED_CONFLICT_KEYS.filter(([table, column]) => !indexes.some(index =>
    index.table_name === table && index.is_unique && index.is_valid && index.is_ready && index.is_immediate &&
    index.predicate === null && index.expression === null && index.columns.length === 1 && index.columns[0] === column
  )).map(([table, column]) => ({ table, column, reason: 'no_usable_unconditional_unique_index_for_on_conflict' }));
}
