import { getTableColumns, getTableName } from 'drizzle-orm';
import * as schema from './schema.ts';

export interface RequiredColumn { table: string; column: string; sqlType: string; source: string }

/** ORM contract plus columns used by raw SQL, kept independent of database access. */
export function getRequiredDatabaseColumns(): RequiredColumn[] {
  const required = new Map<string, RequiredColumn>();
  const add = (table: string, column: string, sqlType: string, source: string) => {
    if (!required.has(`${table}.${column}`)) required.set(`${table}.${column}`, { table, column, sqlType, source });
  };
  for (const table of Object.values(schema)) {
    for (const column of Object.values(getTableColumns(table))) add(getTableName(table), column.name, column.getSQLType(), 'src/db/schema.ts');
  }
  const rawTables: Record<string, Record<string, string>> = {
    barangays: { municipality: 'text', latitude: 'double precision', longitude: 'double precision', is_active: 'boolean', metadata: 'jsonb', updated_at: 'timestamp with time zone' },
    certificate_templates: { id: 'uuid', barangay_id: 'uuid', code: 'text', name: 'text', template_body: 'text', template_data: 'jsonb', css_styles: 'jsonb', is_active: 'boolean', is_archived: 'boolean', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
    certificate_signatories: { template_id: 'uuid', signatory_id: 'uuid', display_order: 'integer' },
    signatories: { id: 'uuid', full_name: 'text', position_title: 'text', signature_image_url: 'text', is_active: 'boolean' },
    legal_documents: { id: 'text', document: 'jsonb', updated_at: 'timestamp with time zone' },
    legal_document_audit_logs: { id: 'uuid', document_id: 'text', document_title: 'text', action: 'text', actor_id: 'text', actor_name: 'text', actor_role: 'text', details: 'text', created_at: 'timestamp with time zone' },
  };
  for (const [table, columns] of Object.entries(rawTables)) {
    for (const [column, sqlType] of Object.entries(columns)) add(table, column, sqlType, table.startsWith('certificate') || table === 'signatories' ? 'src/db/certificateTemplates.ts' : table.startsWith('legal_') ? 'src/db/legalDocuments.ts; src/server/app.ts' : 'src/server/app.ts');
  }
  return Array.from(required.values()).sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

export function getRequiredDatabaseTables() {
  const tables = new Map<string, string[]>();
  for (const item of getRequiredDatabaseColumns()) tables.set(item.table, [...(tables.get(item.table) || []), item.column]);
  return tables;
}
