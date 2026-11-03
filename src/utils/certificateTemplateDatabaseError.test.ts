import { strict as assert } from 'node:assert';
import { formatCertificateTemplateDatabaseError } from './certificateTemplateDatabaseError';

const missingColumn = formatCertificateTemplateDatabaseError(
  Object.assign(new Error('column ct.template_data does not exist'), { code: '42703' }),
);
assert.equal(missingColumn.code, '42703');
assert.match(missingColumn.message, /ct\.template_data/);
assert.match(missingColumn.message, /intended Supabase project/);
assert.doesNotMatch(missingColumn.message, /outdated|apply.*migration/i);

const missingRelation = formatCertificateTemplateDatabaseError(
  Object.assign(new Error('relation does not exist'), { code: '42P01' }),
);
assert.equal(missingRelation.code, '42P01');

console.log('Certificate template database diagnostics tests passed.');