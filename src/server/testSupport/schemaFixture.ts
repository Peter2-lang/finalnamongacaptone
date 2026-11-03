import { getRequiredDatabaseColumns } from '../../db/requirements.ts';

export function successfulSchemaRows(sql: string) {
  if (sql.includes('pg_catalog.pg_attribute')) return getRequiredDatabaseColumns().map(item => ({
    table_name: item.table, column_name: item.column, data_type: item.sqlType,
    not_null: false, column_default: null, primary_key: item.column === 'id',
  }));
  if (sql.includes("to_regclass('public.swine_tag_seq')")) return [{ present: true, usable: true }];
  return [];
}
