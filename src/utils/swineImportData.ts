import type { RegistryFieldType } from '../types';

export const IMPORT_LIMITS = { bytes: 10 * 1024 * 1024, rows: 10000, columns: 150, cellChars: 20000, batch: 25 };
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function assertSafeImportKey(key: string) {
  if (!key.trim() || key.length > 120 || forbidden.has(key.toLowerCase()) || /[\x00-\x1f]/.test(key)) {
    throw new Error(`Unsupported import field name: ${JSON.stringify(key)}.`);
  }
}
export function assertSafeImportValue(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error('Imported values are nested too deeply.');
  if (typeof value === 'string' && value.length > IMPORT_LIMITS.cellChars) throw new Error('An imported value exceeds 20,000 characters.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Imported numbers must be finite.');
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) { assertSafeImportKey(key); assertSafeImportValue(item, depth + 1); }
  }
}
/** Both JSON and spreadsheet readers pass through the same dataset contract. */
export function normalizeImportDataset(input: unknown): { rows: Record<string, any>[]; headers: string[] } {
  const container = input as {records?: unknown; data?: unknown};
  const data = Array.isArray(input) ? input : container?.records ?? container?.data;
  if (!Array.isArray(data) || !data.length) throw new Error('Provide a nonempty array of records, or an object with a records/data array.');
  if (data.length > IMPORT_LIMITS.rows) throw new Error(`A file supports up to ${IMPORT_LIMITS.rows.toLocaleString()} records. Split larger files before importing.`);
  const headers = new Set<string>();
  const rows = data.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Row ${index + 1} must be a record object.`);
    assertSafeImportValue(row);
    const flat = Object.create(null) as Record<string, any>;
    for (const [key, value] of Object.entries(row)) {
      if (key === 'customFields' || key === 'custom_fields') {
        if (value === null) continue;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Row ${index + 1}: ${key} must be an object.`);
        for (const [customKey, customValue] of Object.entries(value)) {
          if (Object.hasOwn(row, customKey) || Object.hasOwn(flat, customKey)) throw new Error(`Row ${index + 1}: conflicting field ${customKey}.`);
          flat[customKey] = customValue;
        }
      } else flat[key] = value;
    }
    Object.keys(flat).forEach(key => headers.add(key));
    return flat;
  });
  if (!headers.size || headers.size > IMPORT_LIMITS.columns) throw new Error(`Import supports 1–${IMPORT_LIMITS.columns} unique columns.`);
  return {rows, headers: [...headers]};
}
export function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function coerceImportValue(value: any, type: RegistryFieldType): any {
  if (value === undefined || value === null || value === '') return value;
  if (type === 'number') {
    if (typeof value === 'boolean' || typeof value === 'object' || !Number.isFinite(Number(String(value).replace(/,/g, '')))) throw new Error('must be a valid number');
    return Number(String(value).replace(/,/g, ''));
  }
  if (type === 'checkbox' || type === 'yes_no') {
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['true','yes','1','y','oo'].includes(text)) return true;
    if (['false','no','0','n','dili','hindi'].includes(text)) return false;
    throw new Error('must be true/false or yes/no');
  }
  if (type === 'date') {
    const text = value instanceof Date ? value.toISOString().slice(0,10) : String(value).trim();
    if (!validIsoDate(text)) throw new Error('must be a valid YYYY-MM-DD date');
    return text;
  }
  // Preserve source values for text/mixed JSON fields, including false and zero.
  return value;
}
export function stableImportFingerprint(row: Record<string, unknown>): string {
  const stable = (value: any): any => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
  return JSON.stringify(stable(row));
}
