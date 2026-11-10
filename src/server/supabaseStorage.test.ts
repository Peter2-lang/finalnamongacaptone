import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isCertificateTemplateSourcePath, verifyDirectLegalDocument } from './supabaseStorage.ts';

test('private certificate source paths stay within administrator import storage', () => {
  assert.equal(isCertificateTemplateSourcePath('shared/certificate-imports/123e4567-e89b-12d3-a456-426614174000-source.pdf'), true);
  assert.equal(isCertificateTemplateSourcePath('barangays/nava/certificate-assets/logo.png'), false);
  assert.equal(isCertificateTemplateSourcePath('shared/certificate-imports/../source.pdf'), false);
  assert.equal(isCertificateTemplateSourcePath('shared/certificate-assets/source.pdf'), false);
});


test('legal source registration validates TIFF/WebP magic bytes and document scope', async () => {
  let bytes = Buffer.from('49492a0000000000', 'hex');
  const storage = { storage: { from: () => ({
    download: async () => ({ data: new Blob([bytes]), error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: 'https://private-source.invalid' }, error: null }),
  }) } };
  const source = await verifyDirectLegalDocument(storage as any, 'legal-documents/doc1/source.tiff', 'source.tiff', 'image/tiff', 'doc1');
  assert.equal(source.fileSize, bytes.length);
  bytes = Buffer.from('RIFF0000WEBP');
  await verifyDirectLegalDocument(storage as any, 'legal-documents/doc1/source.webp', 'source.webp', 'image/webp', 'doc1');
  await assert.rejects(() => verifyDirectLegalDocument(storage as any, 'legal-documents/doc2/source.webp', 'source.webp', 'image/webp', 'doc1'), /scope/);
  bytes = Buffer.from('not an image');
  await assert.rejects(() => verifyDirectLegalDocument(storage as any, 'legal-documents/doc1/source.webp', 'source.webp', 'image/webp', 'doc1'), /contents/);
});
