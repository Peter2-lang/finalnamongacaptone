import type { RegistryFormField } from '../types';
import { assertSafeImportKey, assertSafeImportValue, IMPORT_LIMITS } from '../utils/swineImportData';

const coreKeys = new Set(['id','record_id','farmer_id','farmer_name','barangay','barangay_id','pig_id_tag','ear_tag_no','computed_pig_id','birth_date','age_months','age_days','swine_type','farm_scale','asf_zone','latitude','longitude','actual_weight_kg','weight_kg','ready_to_sell','status','custom_fields','customFields']);
const customTypes = new Set(['text','number','date','checkbox','yes_no','dropdown','textarea']);
export function validateImportFieldDefinitions(input: unknown): RegistryFormField[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > IMPORT_LIMITS.columns) throw new Error('Invalid custom field definitions.');
  const keys = new Set<string>();
  return input.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Custom fields must be objects.');
    const {fieldKey, label, type} = value;
    assertSafeImportKey(String(fieldKey || ''));
    if (!/^[a-z][a-z0-9_]{0,99}$/.test(fieldKey) || keys.has(fieldKey) || coreKeys.has(fieldKey)) throw new Error('Custom field keys must be safe and unique.');
    if (typeof label !== 'string' || !label.trim() || label.length > 160 || !customTypes.has(type)) throw new Error('Invalid custom field label or type.');
    if (value.options !== undefined && (!Array.isArray(value.options) || value.options.length > 100 || value.options.some((option: unknown) => typeof option !== 'string' || option.length > 200))) throw new Error('Invalid dropdown options.');
    keys.add(fieldKey);
    return {id: `fld_import_${fieldKey}`, fieldKey, label: label.trim(), type, required: Boolean(value.required), visible: true, isCustom: true, options: value.options, searchable: value.searchable !== false, filterable: value.filterable !== false, sortable: value.sortable !== false, exportable: value.exportable !== false, printable: value.printable !== false};
  });
}
export function validateImportRecordShape(record: unknown) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Each import row must be a record object.');
  assertSafeImportValue(record);
  const row = record as Record<string, any>;
  if (typeof row.farmerName !== 'string' || !row.farmerName.trim()) throw new Error('Farmer Name is required.');
  if (typeof row.barangay !== 'string' || !row.barangay.trim()) throw new Error('Barangay is required.');
  if (row.farmerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.farmerId)) throw new Error('Farmer reference must be a UUID.');
  if (row.customFields !== undefined && (!row.customFields || typeof row.customFields !== 'object' || Array.isArray(row.customFields) || Object.keys(row.customFields).length > IMPORT_LIMITS.columns)) throw new Error('Invalid custom field values.');
}
