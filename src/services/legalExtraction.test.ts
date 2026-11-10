import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { detectFormat, splitLegalPages } from './legalExtraction';
import { LegalDocumentParserService as Parser } from './legalDocumentParserService';

test('detects package content rather than trusting filename or MIME', async () => {
  const zip = new JSZip(); zip.file('word/document.xml', '<document/>');
  const file = new File([await zip.generateAsync({ type: 'uint8array' })], 'misleading.png', { type: 'image/png' });
  assert.equal(await detectFormat(file), 'docx');
  await assert.rejects(() => detectFormat(new File(['unrecognized'], 'ordinance.docx')), /Unsupported/);
  await assert.rejects(() => detectFormat(new File([new Uint8Array([0xd0, 0xcf])], 'old.doc')), /conversion/);
});
test('does not invent metadata, dates, status, signatories or sections from a filename', () => {
  const detection = Parser.analyzeTextContent('WHEREAS the scan is incomplete.\nRESOLVED to refer it for review.', 'municipal-2025-59.docx');
  assert.equal(detection.officialNumber, ''); assert.equal(detection.title, ''); assert.equal(detection.seriesYear, '');
  assert.equal(detection.dateEnacted, undefined); assert.equal(detection.status, 'draft');
  assert.deepEqual(detection.articles, []); assert.deepEqual(detection.penalties, []);
  const doc = Parser.convertDetectionToDocument(detection);
  assert.equal(doc.signatory, ''); assert.equal(doc.effectiveDate, '');
  assert.equal(Parser.analyzeTextContent('APPROVED: February 31, 2026', '').dateEnacted, undefined);
  assert.equal(Parser.analyzeTextContent('APPROVED: February 28, 2026', '').dateEnacted, '2026-02-28');
});
test('preserves numbered text, WHEREAS, RESOLVED, table rows and certification outside sections', async () => {
  const text = 'RESOLUTION NO. 376 SERIES OF 2026\nA RESOLUTION CONCERNING REGISTRATION\n\nWHEREAS, the census is needed;\nRESOLVED, to record all livestock.\nOwner\tHeads\nAlice\t10\nCERTIFIED CORRECT:\nSecretary';
  const item = await Parser.parseFile(new File([text], 'resulotion.txt'));
  assert.equal(item.rawText, text); assert.equal(item.detection?.status, 'draft');
  assert.equal(item.detection?.officialNumber, '376');
  assert.deepEqual(item.detection?.articles, []);
  assert.equal(Parser.convertDetectionToDocument(item.detection!, item).fullText, text);
});
test('splits new legal headings, never sections or repeated headings', () => {
  const pages = [
    { pageNumber: 1, text: 'PROVINCIAL ORDINANCE NO. 2023-144\nAN ORDINANCE ABOUT ASF' },
    { pageNumber: 2, text: 'ARTICLE II\nSECTION 3. Quarantine\nSee Resolution No. 376.' },
    { pageNumber: 3, text: 'RESOLUTION NO. 376\nA RESOLUTION CONCERNING REGISTRATION' },
    { pageNumber: 4, text: 'RESOLUTION NO. 376\nRESOLVED, approve registration.' },
    { pageNumber: 5, text: 'MUNICIPAL ORDINANCE NO. 2025-59\nAN ORDINANCE REGULATING LIVESTOCK' },
  ];
  assert.deepEqual(splitLegalPages(pages).map(group => group.map(p => p.pageNumber)), [[1, 2], [3, 4], [5]]);
});
test('section same-line provisions are retained without inventing an article', () => {
  const articles = Parser.extractArticlesAndSections('SECTION 9. Keep the exact wording.\n(a) Original provision.\nSECTION 10. RESOLVED to register.');
  assert.equal(articles[0].articleNumber, '');
  assert.equal(articles[0].sections[0].content, 'Keep the exact wording.\n(a) Original provision.');
  assert.equal(articles[0].sections[1].content, 'RESOLVED to register.');
});
test('blank files produce warnings, never fabricated text', async () => {
  const item = await Parser.parseFile(new File([''], 'document.txt'));
  assert.equal(item.rawText, ''); assert.match(item.warnings!.join('\n'), /No readable text/);
  assert.deepEqual(item.detection?.articles, []);
});
test('cancelled extraction cannot become a ready document', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => Parser.parseFile(new File(['body'], 'a.txt'), undefined, controller.signal), /abort/i);
});
