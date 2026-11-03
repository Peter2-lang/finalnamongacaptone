import { strict as assert } from 'node:assert';
import { CertificateTemplate } from '../types';
import {
  filterCertificateTemplates,
  filterCertificateTemplatesForUser,
} from './certificateTemplateFilters';

function createTemplate(overrides: Partial<CertificateTemplate> = {}): CertificateTemplate {
  const now = new Date(0).toISOString();
  return {
    id: 'template-id',
    name: 'Registry certification',
    barangay: 'Ambacon',
    documentType: 'Barangay Certification',
    documentTitle: 'Official certification',
    titleFont: 'serif_bold',
    language: 'english',
    pageSize: 'Folio',
    orientation: 'portrait',
    header: {
      countryText: 'Republic of the Philippines',
      provinceText: 'Southern Leyte',
      municipalityText: 'Hinunangan',
      barangayText: 'Barangay Ambacon',
    },
    logos: [],
    watermark: {
      enabled: false,
      type: 'municipality',
      opacity: 0.12,
      position: 'center',
      size: 'large',
    },
    bodyTemplate: '{{farmer_name}}',
    signatories: [],
    receipt: { showReceiptBox: false },
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const ambacon = createTemplate({ id: 'ambacon', barangayId: 'barangay-ambacon' });
const globalTemplate = createTemplate({ id: 'global', name: 'Global template', barangay: 'All', barangayId: undefined });
const tuburan = createTemplate({ id: 'tuburan', barangay: 'Tuburan', barangayId: 'barangay-tuburan' });
const legacyTemplate = createTemplate({
  id: 'legacy',
  name: 'Legacy template',
  barangay: '',
  documentType: '',
  language: '' as CertificateTemplate['language'],
  barangayId: undefined,
});
const templates = [ambacon, globalTemplate, tuburan, legacyTemplate];

const byName = filterCertificateTemplates(templates, {
  search: 'GLOBAL',
  barangay: '',
  documentType: '',
  language: '',
});
assert.deepEqual(byName.map(template => template.id), ['global'], 'search matches template names without case sensitivity');

const combinedFilters = filterCertificateTemplates(templates, {
  search: '',
  barangay: 'ambacon',
  documentType: 'barangay certification',
  language: 'ENGLISH',
});
assert.deepEqual(
  combinedFilters.map(template => template.id),
  ['ambacon', 'global', 'legacy'],
  'filters use saved values, include shared templates, and retain templates with missing metadata',
);

const clearedFilters = filterCertificateTemplates(templates, {
  search: '',
  barangay: '',
  documentType: '',
  language: '',
});
assert.equal(clearedFilters.length, templates.length, 'clearing filters restores the complete authorized list');

const focalTemplates = filterCertificateTemplatesForUser(templates, {
  isAdmin: false,
  barangayId: 'barangay-ambacon',
  assignedBarangay: 'Ambacon',
});
assert.deepEqual(
  focalTemplates.map(template => template.id),
  ['ambacon', 'global', 'legacy'],
  'focal users receive shared, assigned, and legacy unscoped templates but not another barangay',
);

const nameScopedFocalTemplates = filterCertificateTemplatesForUser([ambacon, tuburan], {
  isAdmin: false,
  barangayId: 'brgy-ambacon',
  assignedBarangay: 'Ambacon',
});
assert.deepEqual(
  nameScopedFocalTemplates.map(template => template.id),
  ['ambacon'],
  'assigned barangay name scopes templates when the profile and database use different barangay ID formats',
);

assert.equal(
  filterCertificateTemplatesForUser(templates, {
    isAdmin: true,
    barangayId: '',
    assignedBarangay: '',
  }).length,
  templates.length,
  'admins retain access to all templates',
);

console.log('All certificate template filtering and scope tests passed.');
