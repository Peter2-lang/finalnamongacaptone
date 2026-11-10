import { test, expect } from '@playwright/test';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { fixture } from './support/sessionFixture';

function wordXml(body: string) {
  return `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`;
}
async function word(body: string) {
  const zip = new JSZip(); zip.file('word/document.xml', wordXml(body));
  return zip.generateAsync({ type: 'nodebuffer' });
}
test('editable DOCX multi-document preview preserves text, sections and manual page boundaries', async ({ page }) => {
  await fixture(page, 'admin'); await page.goto('/asf-ordinance');
  await page.getByRole('button', { name: /Import Legal Document/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Smart Legal Document Import System' });
  const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const buffer = await word(p('PROVINCIAL ORDINANCE NO. 2023-144') + p('AN ORDINANCE CONCERNING BANTAY ASF') + p('WHEREAS, preserve these words exactly.') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + p('RESOLUTION NO. 376 SERIES OF 2026') + p('A RESOLUTION CONCERNING LIVESTOCK REGISTRATION') + p('RESOLVED, preserve this clause.') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + p('MUNICIPAL ORDINANCE NO. 2025-59') + p('AN ORDINANCE REGULATING LIVESTOCK') + p('SECTION 1. Actual provision, not a generated mandate.') + p('CERTIFIED CORRECT: Secretary'));
  await dialog.locator('input[type=file]').setInputFiles({ name: 'resulotion-generated.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer });
  await expect(dialog.getByText(/Native text.*Ready to Process/)).toBeVisible();
  await dialog.getByRole('button', { name: /Process & Recognize/ }).click();
  await expect(dialog.getByText('Suggested document: pages 1–1. Review all boundaries.')).toBeVisible();
  await expect(dialog.getByLabel('Extracted text — page 1')).toContainText('WHEREAS');
  await expect(dialog.getByRole('button', { name: '2025-59', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '2025-59', exact: true }).click();
  await expect(dialog.getByLabel('Extracted text — page 3')).toHaveValue(/CERTIFIED CORRECT/);
  await expect(dialog.getByText(/Detected Articles \(1\)/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Confirm & Save/ })).toBeDisabled();
  await expect(dialog.locator('select').filter({ has: page.locator('option[value="draft"]') })).toHaveValue('draft');
});

test('DOCX relationships preserve embedded image order and explicit page breaks', async ({ page }) => {
  await fixture(page, 'admin'); await page.goto('/asf-ordinance');
  const zip = new JSZip();
  zip.file('word/document.xml', wordXml('<w:p><w:r><w:t>Before scan</w:t><w:drawing><a:blip r:embed="second"/></w:drawing><w:t>After scan</w:t><w:br w:type="page"/><w:drawing><a:blip r:embed="first"/></w:drawing></w:r></w:p>'));
  zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="first" Target="media/one.png"/><Relationship Id="second" Target="media/two.png"/></Relationships>');
  zip.file('word/media/one.png', new Uint8Array([1, 2, 3])); zip.file('word/media/two.png', new Uint8Array([4, 5, 6]));
  const result = await page.evaluate(async b64 => {
    const { readDocx } = await import(/* @vite-ignore */ String('/src/services/legalExtraction.ts'));
    return readDocx(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'scans.docx'));
  }, (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64'));
  expect(result).toHaveLength(2); expect(result[0].images![0]).toContain('BAUG'); expect(result[1].images![0]).toContain('AQID');
  expect(result[0].orderedText).toMatch(/Before scan.*\uFFF00\uFFF1.*After scan/);
});

test('native multipage PDF extracts actual text without OCR and keeps page count', async ({ page }) => {
  await fixture(page, 'admin'); await page.goto('/asf-ordinance');
  const pdf = new jsPDF(); pdf.text('RESOLUTION NO. 376 - WHEREAS the original words are retained.', 15, 30);
  pdf.addPage(); pdf.text('RESOLVED: Record the census. CERTIFIED CORRECT.', 15, 30);
  const result = await page.evaluate(async bytes => {
    const { extractPages } = await import(/* @vite-ignore */ String('/src/services/legalExtraction.ts'));
    return extractPages(new File([new Uint8Array(bytes)], 'native.pdf'), 'pdf');
  }, Array.from(new Uint8Array(pdf.output('arraybuffer'))));
  expect(result).toHaveLength(2); expect(result[0].text).toContain('WHEREAS'); expect(result[1].text).toContain('CERTIFIED CORRECT');
  expect(result.some(p => p.ocrApplied)).toBe(false);
});

test('real OCR reads pixels rather than misleading filenames and checkpoints retries', async ({ page }) => {
  test.setTimeout(180000);
  await fixture(page, 'admin'); await page.goto('/asf-ordinance');
  const result = await page.evaluate(async () => {
    const { extractPages } = await import(/* @vite-ignore */ String('/src/services/legalExtraction.ts'));
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 600;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1600, 600);
    ctx.fillStyle = 'black'; ctx.font = '44px Arial'; ctx.fillText('RESOLUTION NO. 921', 70, 100); ctx.fillText('WHEREAS livestock records are required;', 70, 200); ctx.fillText('RESOLVED to preserve these exact words.', 70, 300);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!)));
    const file = new File([blob], 'municipal-2025-59-piggery.png', { type: 'image/png' });
    const first = await extractPages(file, 'png');
    const second = await extractPages(file, 'png');
    return { first, second };
  });
  expect(result.first[0].text).toMatch(/921/); expect(result.first[0].text).toMatch(/WHEREAS/);
  expect(result.first[0].text).not.toContain('2025-59'); expect(result.second[0].text).toBe(result.first[0].text);
});

test('scanned DOCX, mixed DOCX, scanned PDF, JPEG, WebP and TIFF use real OCR', async ({ page }) => {
  test.setTimeout(240000);
  await fixture(page, 'admin'); await page.goto('/asf-ordinance');
  const scan = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1300; canvas.height = 500;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1300, 500);
    ctx.fillStyle = 'black'; ctx.font = '42px Arial'; ctx.fillText('ORDINANCE NO. 2023-144', 50, 90); ctx.fillText('WHEREAS, keep livestock records.', 50, 170); ctx.fillText('CERTIFIED CORRECT: Secretary', 50, 250);
    return canvas.toDataURL('image/png');
  });
  const zip = new JSZip(); zip.file('word/document.xml', wordXml('<w:p><w:r><w:drawing><a:blip r:embed="scan"/></w:drawing></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>Native statement before second scan.</w:t><w:drawing><a:blip r:embed="scan"/></w:drawing><w:t>Native statement after scan.</w:t></w:r></w:p>'));
  zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="scan" Target="media/page.png"/></Relationships>'); zip.file('word/media/page.png', Buffer.from(scan.split(',')[1], 'base64'));
  const pdf = new jsPDF(); pdf.addImage(scan, 'PNG', 10, 20, 190, 73); pdf.addPage(); pdf.addImage(scan, 'PNG', 10, 20, 190, 73);
  const result = await page.evaluate(async ({ docx, pdf, scan }) => {
    const { extractPages } = await import(/* @vite-ignore */ String('/src/services/legalExtraction.ts'));
    const bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const word = await extractPages(new File([bytes(docx)], 'scanned.docx'), 'docx');
    const scannedPdf = await extractPages(new File([bytes(pdf)], 'scan.pdf'), 'pdf');
    const image = await createImageBitmap(await (await fetch(scan)).blob());
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d')!.drawImage(image, 0, 0);
    const formats: Record<string, string> = {};
    for (const format of ['jpeg', 'webp']) {
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), `image/${format}`));
      formats[format] = (await extractPages(new File([blob], `source.${format}`), format === 'jpeg' ? 'jpg' : format))[0].text;
    }
    const { multipageTiff } = await import(/* @vite-ignore */ String('/tests/browser/support/tiffFixture.ts'));
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const tiff = multipageTiff(new Uint8Array(pixels.data.buffer), canvas.width, canvas.height);
    const tiffPages = await extractPages(new File([tiff], 'source.tiff'), 'tiff');
    return { word, scannedPdf, formats, tiffPages };
  }, { docx: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64'), pdf: Buffer.from(pdf.output('arraybuffer')).toString('base64'), scan });
  expect(result.word).toHaveLength(2); expect(result.word[0].text).toContain('2023-144');
  expect(result.word[1].text.indexOf('before second')).toBeLessThan(result.word[1].text.indexOf('WHEREAS'));
  expect(result.word[1].text.indexOf('after scan')).toBeGreaterThan(result.word[1].text.indexOf('CERTIFIED'));
  expect(result.scannedPdf).toHaveLength(2); expect(result.scannedPdf.every(p => p.ocrApplied && p.text.includes('2023-144'))).toBe(true);
  expect(result.formats.jpeg).toContain('2023-144'); expect(result.formats.webp).toContain('2023-144'); expect(result.tiffPages).toHaveLength(2); expect(result.tiffPages.every(p => p.text.includes('2023-144'))).toBe(true);
});

test('review drafts survive refresh and confirmed imports persist separate records and originals', async ({ page }) => {
  const saved: Record<string, any>[] = [];
  await fixture(page, 'admin');
  await page.route('**/api/legal-documents', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: saved } });
    const doc = route.request().postDataJSON(); saved.push(doc); return route.fulfill({ json: { success: true, data: doc } });
  });
  await page.route('**/api/storage/upload-url', route => {
    const body = route.request().postDataJSON();
    return route.fulfill({ json: { bucket: 'documents', filePath: `legal-documents/${body.documentId}/source.txt`, token: 'fixture-token' } });
  });
  await page.route('https://auditfixture.supabase.co/storage/v1/object/upload/sign/**', route => route.fulfill({ json: { Key: 'fixture-upload' } }));
  await page.route('**/api/legal-documents/*/attachments', route => {
    const body = route.request().postDataJSON(); const id = new URL(route.request().url()).pathname.split('/')[3];
    const doc = saved.find(d => d.id === id)!;
    const attachment = { id: `source-${id}`, name: body.fileName, originalFileName: body.fileName, fileType: body.mimeType, storagePath: body.filePath, uploadedAt: new Date().toISOString(), isCurrent: true };
    doc.sourceDocuments = [attachment];
    return route.fulfill({ json: { success: true, data: { document: doc, attachment } } });
  });
  await page.goto('/asf-ordinance'); await page.getByRole('button', { name: /Import Legal Document/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Smart Legal Document Import System' });
  await dialog.locator('input[type=file]').setInputFiles({ name: 'source.txt', mimeType: 'text/plain', buffer: Buffer.from('RESOLUTION NO. 921\nA RESOLUTION CONCERNING LIVESTOCK RECORDS\n\nWHEREAS, preserve the exact text;\nRESOLVED, record livestock.\nCERTIFIED CORRECT: Secretary') });
  await expect(dialog.getByText(/Native text.*Ready to Process/)).toBeVisible();
  await dialog.getByRole('button', { name: /Process & Recognize/ }).click();
  await expect(dialog.getByLabel('Extracted text — page 1')).toHaveValue(/WHEREAS/);
  await page.reload(); await page.getByRole('button', { name: /Import Legal Document/ }).click();
  await expect(dialog.getByLabel('Extracted text — page 1')).toHaveValue(/CERTIFIED CORRECT/);
  await dialog.getByLabel("Confirm this document's text, metadata and page range").check();
  await dialog.getByLabel(/I reviewed every document/).check();
  await dialog.getByRole('button', { name: /Confirm & Save/ }).click(); await expect(dialog).toHaveCount(0);
  expect(saved).toHaveLength(1); expect(saved[0].fullText).toContain('WHEREAS, preserve the exact text;');
  expect(saved[0].sourceDocuments[0].storagePath).toContain('legal-documents/'); expect(saved[0].status).toBe('draft');
  expect(saved[0].importProvenance.pages).toHaveLength(1);
  await page.reload(); await expect(page.getByText('A RESOLUTION CONCERNING LIVESTOCK RECORDS', { exact: true }).first()).toBeVisible();
});

test('unreadable scans warn, rotated scans recover, corrupt images fail and retry succeeds', async ({ page }) => {
  test.setTimeout(180000);
  await fixture(page, 'admin'); await page.goto('/asf-ordinance');
  const result = await page.evaluate(async () => {
    const { extractPages, ocrImage } = await import(/* @vite-ignore */ String('/src/services/legalExtraction.ts'));
    const { LegalDocumentParserService } = await import(/* @vite-ignore */ String('/src/services/legalDocumentParserService.ts'));
    const canvas = document.createElement('canvas'); canvas.width = 1300; canvas.height = 500;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1300, 500);
    const blank = await extractPages(new File([await (await fetch(canvas.toDataURL())).blob()], 'blurred.png'), 'png');
    ctx.translate(650, 250); ctx.rotate(Math.PI); ctx.fillStyle = 'black'; ctx.font = '46px Arial'; ctx.fillText('RESOLUTION NO. 842', -550, 0); ctx.fillText('WHEREAS records are required.', -550, 80);
    const rotated = await extractPages(new File([await (await fetch(canvas.toDataURL())).blob()], 'rotated.png'), 'png');
    const corrupt = new File([new Uint8Array([137, 80, 78, 71, 0, 0])], 'corrupt.png');
    const failed = await LegalDocumentParserService.parseFile(corrupt);
    const retry = await LegalDocumentParserService.parseFile(new File([await (await fetch(canvas.toDataURL())).blob()], 'retry.png'));
    const controller = new AbortController();
    const pending = ocrImage(canvas.toDataURL(), controller.signal);
    controller.abort(); let cancelled = false;
    try { await pending; } catch { cancelled = true; }
    return { blank, rotated, failed, retry, cancelled };
  });
  expect(result.blank[0].text.trim()).toBe(''); expect(result.blank[0].warnings.join(' ')).toMatch(/No readable text|Low confidence/);
  expect(result.rotated[0].text).toContain('842'); expect(result.failed.status).toBe('error'); expect(result.retry.rawText).toContain('842'); expect(result.cancelled).toBe(true);
});

test('generated 25-page scanned DOCX yields three separate legal records and preserves a native table', async ({ page }) => {
  test.setTimeout(180000);
  await fixture(page, 'admin'); await page.goto('/asf-ordinance');
  const scans = await page.evaluate(() => ['PROVINCIAL ORDINANCE NO. 2023-144', 'RESOLUTION NO. 376 SERIES OF 2026', 'MUNICIPAL ORDINANCE NO. 2025-59'].map(heading => {
    const canvas = document.createElement('canvas'); canvas.width = 1700; canvas.height = 500;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black'; ctx.font = '46px Arial'; ctx.fillText(heading, 40, 100); ctx.fillText('SYNTHETIC OCR REGRESSION FIXTURE', 40, 200); ctx.fillText('WHEREAS this is test data. CERTIFIED CORRECT.', 40, 300);
    return canvas.toDataURL('image/png');
  }));
  const zip = new JSZip();
  let body = '';
  for (let n = 0; n < 25; n++) {
    if (n) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    body += `<w:p><w:r><w:drawing><a:blip r:embed="scan${n < 8 ? 0 : n < 16 ? 1 : 2}"/></w:drawing></w:r></w:p>`;
  }
  body += '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Heads</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Alice</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  zip.file('word/document.xml', wordXml(body));
  zip.file('word/_rels/document.xml.rels', `<Relationships>${scans.map((_, i) => `<Relationship Id="scan${i}" Target="media/scan${i}.png"/>`).join('')}</Relationships>`);
  scans.forEach((scan, i) => zip.file(`word/media/scan${i}.png`, Buffer.from(scan.split(',')[1], 'base64')));
  const result = await page.evaluate(async b64 => {
    const { LegalDocumentParserService: parser } = await import(/* @vite-ignore */ String('/src/services/legalDocumentParserService.ts'));
    const item = await parser.parseFile(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'generated-25-page-scans.docx'));
    return { item, documents: parser.splitExtractedItem(item) };
  }, (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64'));
  expect(result.item.pageCount).toBe(25); expect(result.documents).toHaveLength(3);
  expect(result.documents.map(d => d.pages.map(p => p.pageNumber))).toEqual([
    Array.from({ length: 8 }, (_, i) => i + 1), Array.from({ length: 8 }, (_, i) => i + 9), Array.from({ length: 9 }, (_, i) => i + 17),
  ]);
  expect(result.documents.map(d => d.detection.officialNumber)).toEqual(['2023-144', '376', '2025-59']);
  expect(result.documents.every(d => d.detection.articles.length === 0)).toBe(true);
  expect(result.documents[2].rawText).toContain('Owner\tHeads\nAlice\t10');
});
