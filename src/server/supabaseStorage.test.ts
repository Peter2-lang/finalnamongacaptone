import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isCertificateTemplateSourcePath } from './supabaseStorage.ts';

test('private certificate source paths stay within administrator import storage', () => {
  assert.equal(isCertificateTemplateSourcePath('shared/certificate-imports/123e4567-e89b-12d3-a456-426614174000-source.pdf'), true);
  assert.equal(isCertificateTemplateSourcePath('barangays/nava/certificate-assets/logo.png'), false);
  assert.equal(isCertificateTemplateSourcePath('shared/certificate-imports/../source.pdf'), false);
  assert.equal(isCertificateTemplateSourcePath('shared/certificate-assets/source.pdf'), false);
});
