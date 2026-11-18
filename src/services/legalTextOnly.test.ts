import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPrintedLegalText, printedImportIssues, validateLegalText } from './legalTextOnly';
import { isLegalDocument } from '../db/legalDocuments';

test('printed names, positions, nearby provisions and dates remain verbatim', () => {
  const text = 'APPROVED:\nHON. JUAN DELA CRUZ\nMunicipal Mayor\nSECTION 12. Keep every legal provision near the signature.\n(a) Pay ₱500.00.\nWHEREAS, records are required;\nRESOLVED, to approve.\nAPPROVED: November 10, 2026';
  assert.equal(cleanPrintedLegalText(text).text, text);
  assert.deepEqual(validateLegalText(text), []);
});
test('only unmistakable standalone artifacts are removed without guessing words', () => {
  const result = cleanPrintedLegalText('APPROVED:\n~~~___///\nHON. JUAN DELA CRUZ\n[Handwritten signature]\nMunicipal Mayor\nScanned with CamScanner\nCamera timestamp: 2026-11-10 12:00\nAPPROVED: 2026-11-10');
  assert.equal(result.text, 'APPROVED:\nHON. JUAN DELA CRUZ\nMunicipal Mayor\nAPPROVED: 2026-11-10');
  assert.equal(result.removedLines.length, 4); assert.equal(result.warnings.length, 1);
  assert.equal(cleanPrintedLegalText('Recorded stamp duties apply.\nSeal the shipment.\nSignature of the applicant is required.').removedLines.length, 0);
});
test('binary content, embedded image markup and unreadable symbols cannot be confirmed', () => {
  for (const text of ['PK\x03\x04 [Content_Types].xml', '<img src="signature.png">', 'data:image/png;base64,AA']) {
    assert.ok(validateLegalText(text).length); assert.throws(() => cleanPrintedLegalText(text));
  }
  assert.ok(validateLegalText('WHEREAS \uFFFD is unreadable').length);
});
const document = () => ({
  id: 'legal-import-test', title: 'A RESOLUTION', officialNumber: '921', type: 'resolution', status: 'draft',
  fullText: 'WHEREAS, preserve these words.\nAPPROVED:\nHON. JUAN DELA CRUZ\nMunicipal Mayor', articles: [], keyArticles: [],
  importProvenance: { textPolicy: 'printed-text-v1', textOnlyReviewed: true, pages: [{ text: 'WHEREAS, preserve these words.\nAPPROVED:\nHON. JUAN DELA CRUZ\nMunicipal Mayor' }] },
});
test('server validates printed-text review, page/full-text consistency and source-only sections', () => {
  const doc = document(); assert.deepEqual(printedImportIssues(doc), []); assert.equal(isLegalDocument(doc), true);
  doc.importProvenance.textOnlyReviewed = false; assert.equal(isLegalDocument(doc), false);
  doc.importProvenance.textOnlyReviewed = true; doc.fullText += '\n<img src="signature.png">'; assert.equal(isLegalDocument(doc), false);
  const fabricated = { ...document(), articles: [{ sections: [{ content: 'Invented quarantine provision.' }] }] };
  assert.equal(isLegalDocument(fabricated), false);
  const malformed = { ...document(), importProvenance: { textPolicy: 'printed-text-v1', pages: null } };
  assert.equal(isLegalDocument(malformed), false);
});
