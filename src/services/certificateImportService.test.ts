import { strict as assert } from 'node:assert';
import test from 'node:test';
import { jsPDF } from 'jspdf';
import { detectCertificateFields, extractCertificate } from './certificateImportService.ts';

test('certificate field detection maps clearly labeled source values to editable placeholders', () => {
  const result = detectCertificateFields([
    'Certificate of Swine Sale',
    'Farmer Name: Maria Sample',
    'Barangay: Nava',
    'Number of Pigs: 7',
    'Buyer Address: ____',
    'Unlabeled legal wording stays unchanged.',
  ].join('\n'));

  assert.equal(result.text, [
    'Certificate of Swine Sale',
    'Farmer Name: {{farmer_name}}',
    'Barangay: {{barangay}}',
    'Number of Pigs: {{number_of_pigs}}',
    'Buyer Address: {{buyer_address}}',
    'Unlabeled legal wording stays unchanged.',
  ].join('\n'));
  assert.deepEqual(result.fields.map(field => field.key), [
    'farmer_name',
    'barangay',
    'number_of_pigs',
    'buyer_address',
  ]);
  assert.equal(result.fields[0].confidence, 'review', 'existing source values are flagged for review');
  assert.equal(result.fields[3].confidence, 'high', 'blank underline fields are high-confidence mappings');
  assert.equal(result.fields[0].required, true);
});

test('certificate field detection leaves unlabeled prose untouched', () => {
  const source = 'This certificate is issued to the registered livestock owner.';
  assert.deepEqual(detectCertificateFields(source), { text: source, fields: [] });
});

test('PDF import extracts editable text, headings, and page format without importing signatures', async () => {
  const pdf = new jsPDF();
  pdf.text('REPUBLIC OF THE PHILIPPINES', 20, 20);
  pdf.text('BARANGAY CERTIFICATION', 20, 35);
  pdf.text('Farmer Name: Example Name', 20, 55);
  pdf.text('Barangay: Nava', 20, 65);
  const file = new File([pdf.output('arraybuffer')], 'certificate.pdf', { type: 'application/pdf' });

  const result = await extractCertificate(file);
  assert.equal(result.title, 'BARANGAY CERTIFICATION');
  assert.equal(result.header.countryText, 'REPUBLIC OF THE PHILIPPINES');
  assert.equal(result.header.barangayText, undefined, 'the certificate heading is not misidentified as a barangay');
  assert.match(result.text, /Farmer Name: \{\{farmer_name\}\}/);
  assert.match(result.text, /Barangay: \{\{barangay\}\}/);
  assert.equal(result.pageSize, 'A4');
  assert.ok(result.warnings.some(warning => warning.includes('Signatures and official seals are not imported')));
});
