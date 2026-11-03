import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import type { CertificateTemplate } from '../types';

process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';

const [{ pool }, { getCertificateTemplates, saveCertificateTemplate }] = await Promise.all([
  import('./index'),
  import('./certificateTemplates'),
]);

const now = '2026-01-01T00:00:00.000Z';
const legacyRow = {
  code: 'legacy-format',
  name: 'Legacy Barangay Record',
  template_body: 'Original saved text for {{farmer_name}}',
  template_data: {},
  css_styles: {},
  is_active: true,
  created_at: now,
  updated_at: now,
  barangay_id: 'barangay-ambacon',
  barangay_name: 'Ambacon',
  legacy_signatories: [{
    id: 'legacy-signatory',
    name: 'Authorized Officer',
    position: 'Punong Barangay',
    signatureImageUrl: null,
    order: 1,
  }],
};

const fullTemplate: CertificateTemplate = {
  id: 'new-template-id',
  name: 'New certification',
  barangay: 'All',
  documentType: 'Barangay Certification',
  documentTitle: 'Municipal certification',
  titleFont: 'serif_bold',
  language: 'english',
  pageSize: 'Folio',
  orientation: 'portrait',
  header: {
    countryText: 'Republic of the Philippines',
    provinceText: 'Province of Southern Leyte',
    municipalityText: 'Municipality of Hinunangan',
    barangayText: 'All Barangays',
  },
  logos: [],
  watermark: {
    enabled: false,
    type: 'municipality',
    opacity: 0.12,
    position: 'center',
    size: 'large',
  },
  bodyTemplate: 'Saved certificate for {{farmer_name}}',
  signatories: [],
  receipt: { showReceiptBox: false },
  isActive: true,
  createdAt: now,
  updatedAt: now,
};

let rows = [legacyRow];
let templateQueryError: NodeJS.ErrnoException | null = null;
const queries: string[] = [];
const client = {
  async query(text: string, values: unknown[] = []) {
    queries.push(text);
    if (text.includes('FROM public.certificate_templates ct')) {
      if (templateQueryError) throw templateQueryError;
      return { rows };
    }
    if (text.includes('SELECT id FROM public.barangays')) {
      return { rows: [{ id: 'barangay-ambacon' }] };
    }
    if (text.includes('SELECT barangay_id, updated_at FROM public.certificate_templates')) {
      return {
        rows: rows.filter(row => row.code === values[0]).map(row => ({
          barangay_id: row.barangay_id,
          updated_at: row.updated_at,
        })),
      };
    }
    if (text.includes('INSERT INTO public.certificate_templates')) {
      const [barangayId, code, name, body, templateData, isActive] = values as [
        string | null,
        string,
        string,
        string,
        string,
        boolean,
      ];
      const data = JSON.parse(templateData);
      rows = rows.filter(row => row.code !== code);
      rows.push({
        ...legacyRow,
        code,
        name,
        template_body: body,
        template_data: data,
        is_active: isActive,
        barangay_id: barangayId,
        barangay_name: barangayId ? 'Ambacon' : null,
        legacy_signatories: [],
      });
      return { rows: [] };
    }
    return { rows: [] };
  },
  release() {},
};

Object.defineProperty(pool, 'connect', {
  configurable: true,
  value: async () => client as unknown as PoolClient,
});

const loadedLegacy = await getCertificateTemplates();
assert.equal(loadedLegacy.length, 1, 'loads records whose historic template_data is empty');
assert.equal(loadedLegacy[0].id, legacyRow.code, 'keeps the persistent template code');
assert.equal(loadedLegacy[0].bodyTemplate, legacyRow.template_body, 'uses the saved certificate body');
assert.equal(loadedLegacy[0].barangay, legacyRow.barangay_name, 'uses the linked barangay name');
assert.equal(loadedLegacy[0].signatories[0].name, 'Authorized Officer', 'loads legacy relational signatories');
assert.equal(loadedLegacy[0].documentTitle, legacyRow.name, 'provides a usable title for legacy rows');

const savedTemplate = await saveCertificateTemplate(fullTemplate, {
  role: 'admin',
  assignedBarangay: '',
  isAdmin: true,
});
assert.equal(savedTemplate.id, fullTemplate.id, 'returns the database-confirmed template');
assert.equal(savedTemplate.bodyTemplate, fullTemplate.bodyTemplate, 'returns the persisted layout body');
const updatedTemplate = await saveCertificateTemplate({ ...fullTemplate, name: 'Updated certification' }, {
  role: 'admin',
  assignedBarangay: '',
  isAdmin: true,
});
assert.equal(updatedTemplate.id, fullTemplate.id, 'updates retain the persistent template code');
assert.equal(updatedTemplate.name, 'Updated certification', 'updates return the persisted template values');
rows = rows.map(row => row.code === fullTemplate.id
  ? { ...row, updated_at: '2026-01-02T00:00:00.000Z' }
  : row);
await assert.rejects(
  saveCertificateTemplate({ ...fullTemplate, name: 'Stale overwrite attempt' }, {
    role: 'admin',
    assignedBarangay: '',
    isAdmin: true,
  }),
  /changed in another session/,
  'rejects stale template updates instead of overwriting newer database changes',
);
rows = rows.map(row => row.code === fullTemplate.id ? { ...row, updated_at: now } : row);
const refreshedTemplates = await getCertificateTemplates();
assert.equal(
  refreshedTemplates.find(template => template.id === fullTemplate.id)?.name,
  'Updated certification',
  'saved templates remain available from the database after a fresh load',
);
assert.equal(
  queries.some(query => query.includes('UPDATE public.certificate_templates SET is_active')),
  false,
  'saving one template does not deactivate templates omitted from a client payload',
);

const focalTemplate = { ...fullTemplate, id: 'focal-template', barangay: 'Ambacon' };
const savedFocalTemplate = await saveCertificateTemplate(focalTemplate, {
  role: 'focal',
  assignedBarangay: 'Ambacon',
  isAdmin: false,
});
assert.equal(savedFocalTemplate.id, focalTemplate.id, 'allows an assigned focal person to save a barangay template');
await assert.rejects(
  saveCertificateTemplate({ ...focalTemplate, id: 'outside-template', barangay: 'Bugho' }, {
    role: 'focal',
    assignedBarangay: 'Ambacon',
    isAdmin: false,
  }),
  /assigned barangay/,
  'rejects a focal person creating a template for another barangay',
);
await assert.rejects(
  saveCertificateTemplate({
    ...focalTemplate,
    id: 'outside-logo-template',
    logos: [{
      id: 'restricted-logo',
      type: 'custom',
      position: 'left',
      customUrl: 'https://example.invalid/restricted.png',
      storagePath: 'barangays/bugho/certificate-assets/logo.png',
      widthPx: 70,
      heightPx: 70,
      order: 1,
      visible: true,
    }],
  }, {
    role: 'focal',
    assignedBarangay: 'Ambacon',
    isAdmin: false,
  }),
  /assigned barangay/,
  'rejects a focal person attaching another barangay private image to a template',
);
await assert.rejects(
  saveCertificateTemplate({ ...fullTemplate, id: 'new-template-id', barangay: 'Ambacon' }, {
    role: 'focal',
    assignedBarangay: 'Ambacon',
    isAdmin: false,
  }),
  /shared template or a template belonging to another barangay/,
  'rejects a focal person editing a shared template',
);
rows = [];
assert.deepEqual(await getCertificateTemplates(), [], 'returns a genuine empty list when the query succeeds with no rows');

const schemaDefinition = [
  readFileSync(new URL('../../supabase/migrations/001_create_full_registry_schema.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../supabase/migrations/008_certificate_templates_runtime_schema.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../supabase/migrations/010_repair_certificate_template_runtime_column.sql', import.meta.url), 'utf8'),
  readFileSync(new URL('../../supabase/migrations/011_certificate_template_assets_and_schema_repair.sql', import.meta.url), 'utf8'),
].join('\n');
for (const column of ['code', 'name', 'template_body', 'css_styles', 'template_data', 'is_active', 'is_archived', 'created_at', 'updated_at']) {
  assert.match(schemaDefinition, new RegExp(`\\b${column}\\b`), `migrations define queried template column ${column}`);
}
const repairMigration = readFileSync(
  new URL('../../supabase/migrations/011_certificate_template_assets_and_schema_repair.sql', import.meta.url),
  'utf8',
);
assert.match(repairMigration, /ADD COLUMN IF NOT EXISTS template_data JSONB NOT NULL DEFAULT '\{\}'::jsonb/i);
assert.match(repairMigration, /ON public\.certificate_templates FOR INSERT TO authenticated/i);
assert.match(repairMigration, /current_app_role\(\) = 'focal'/i);
assert.match(repairMigration, /INSERT INTO storage\.buckets[\s\S]*?VALUES \('certificates', 'certificates', FALSE\)/i);
assert.match(repairMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.certificate_templates/i);
assert.doesNotMatch(repairMigration, /DROP TABLE|TRUNCATE|DELETE FROM public\.certificate_templates/i);

templateQueryError = Object.assign(new Error('column ct.template_data does not exist'), { code: '42703' });
await assert.rejects(
  getCertificateTemplates(),
  error => (error as NodeJS.ErrnoException).code === '42703' && /ct\.template_data/.test((error as Error).message),
  'propagates the exact missing-column error instead of returning an empty list',
);

console.log('All certificate template database workflow tests passed.');
