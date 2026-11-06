import type { CertificateDynamicSignatory, CertificateHeaderConfig } from '../types.ts';

export interface CertificateFieldSuggestion {
  label: string;
  key: string;
  confidence: 'high' | 'review';
  required: boolean;
  defaultValue?: string;
}

export interface ExtractedCertificate {
  text: string;
  title: string;
  header: Partial<CertificateHeaderConfig>;
  signatories: CertificateDynamicSignatory[];
  warnings: string[];
  fields: CertificateFieldSuggestion[];
  pageSize: 'A4' | 'Letter' | 'Folio';
  orientation: 'portrait' | 'landscape';
  layoutHints: {
    headings: string[];
    hasTables: boolean;
    hasImages: boolean;
    hasSignatureArea: boolean;
  };
}

export const CERTIFICATE_FIELD_OPTIONS = [
  { key: 'farmer_name', label: 'Farmer / owner name' },
  { key: 'farmer_address', label: 'Farmer address' },
  { key: 'barangay', label: 'Barangay' },
  { key: 'number_of_pigs', label: 'Selected swine count' },
  { key: 'swine_identification', label: 'Swine identification' },
  { key: 'buyer_name', label: 'Buyer name' },
  { key: 'buyer_address', label: 'Buyer address' },
  { key: 'transport_origin', label: 'Transport origin' },
  { key: 'destination', label: 'Transport destination' },
  { key: 'price_per_kilo', label: 'Price per kilogram' },
  { key: 'date_issued', label: 'Issue date' },
  { key: 'certificate_number', label: 'Certificate number' },
  { key: 'or_number', label: 'Official receipt number' },
  { key: 'amount_paid', label: 'Receipt amount' },
  { key: 'purpose', label: 'Purpose' },
  { key: 'punong_barangay', label: 'Punong Barangay' },
] as const;

const FIELD_LABELS: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: 'farmer_name', label: 'Farmer / owner name', pattern: /^(?:farmer(?:\s*\/\s*owner)?(?:\s+name)?|owner(?:\s+name)?|name\s+of\s+(?:farmer|owner)|raiser(?:\s+name)?)$/i },
  { key: 'farmer_address', label: 'Farmer address', pattern: /^(?:farmer|owner|raiser)?\s*address$/i },
  { key: 'barangay', label: 'Barangay', pattern: /^barangay(?:\s+of\s+residence)?$/i },
  { key: 'number_of_pigs', label: 'Number of pigs', pattern: /^(?:number\s+of\s+)?(?:pigs|swine|heads?)(?:\s+of\s+(?:pigs|swine))?$/i },
  { key: 'swine_identification', label: 'Swine identification', pattern: /^(?:swine|pig|ear)\s*(?:id|identification|tag|tag\s+number)$/i },
  { key: 'buyer_name', label: 'Buyer name', pattern: /^buyer(?:\s+name)?(?:\s*\/\s*trading entity)?$/i },
  { key: 'buyer_address', label: 'Buyer address', pattern: /^buyer(?:'s)?\s+address$/i },
  { key: 'transport_origin', label: 'Transport origin', pattern: /^(?:transport\s+)?origin$/i },
  { key: 'destination', label: 'Destination', pattern: /^(?:transport\s+)?destination$/i },
  { key: 'price_per_kilo', label: 'Price per kilogram', pattern: /^(?:(?:selling|sale)\s+)?price\s+per\s+(?:kg|kilo(?:gram)?)$/i },
  { key: 'date_issued', label: 'Issue date', pattern: /^(?:(?:certificate|date\s+of)\s+)?(?:date|issued|issue|issuance|of\s+issuance|issue\s+date)$/i },
  { key: 'certificate_number', label: 'Certificate number', pattern: /^(?:certificate|control)\s*(?:no\.?|number)$/i },
  { key: 'or_number', label: 'Official receipt number', pattern: /^(?:official\s+)?(?:receipt|o\.?\s*r\.?)\s*(?:no\.?|number)$/i },
  { key: 'amount_paid', label: 'Receipt amount', pattern: /^(?:amount\s+paid|receipt\s+amount)$/i },
  { key: 'purpose', label: 'Purpose', pattern: /^purpose(?:\s+of\s+certification)?$/i },
  { key: 'punong_barangay', label: 'Punong Barangay', pattern: /^(?:hon\.?\s*)?punong\s+barangay$/i },
];

export function detectCertificateFields(text: string): {
  text: string;
  fields: CertificateFieldSuggestion[];
} {
  const fields: CertificateFieldSuggestion[] = [];
  const transformed = text.split(/\r?\n/).map(line => {
    const match = line.match(/^(\s*)([^:：]{2,64})(\s*[:：]\s*)(.*)$/);
    if (!match) return line;
    const definition = FIELD_LABELS.find(field => field.pattern.test(match[2].trim()));
    if (!definition) return line;
    fields.push({
      key: definition.key,
      label: definition.label,
      confidence: match[4].trim().replace(/[_\-\[\](){}.\s]/g, '') ? 'review' : 'high',
      required: ['farmer_name', 'barangay', 'number_of_pigs', 'date_issued'].includes(definition.key),
    });
    return `${match[1]}${match[2]}${match[3]}{{${definition.key}}}`;
  }).join('\n');

  const uniqueFields = fields.filter((field, index) => fields.findIndex(candidate => candidate.key === field.key) === index);
  return { text: transformed, fields: uniqueFields };
}

function inferPageSize(widthPt: number, heightPt: number): {
  pageSize: ExtractedCertificate['pageSize'];
  orientation: ExtractedCertificate['orientation'];
} {
  const widthMm = widthPt * 25.4 / 72;
  const heightMm = heightPt * 25.4 / 72;
  const landscape = widthMm > heightMm;
  const shortSide = Math.min(widthMm, heightMm);
  const candidates = [
    { pageSize: 'A4' as const, short: 210, long: 297 },
    { pageSize: 'Letter' as const, short: 215.9, long: 279.4 },
    { pageSize: 'Folio' as const, short: 215.9, long: 330.2 },
  ];
  const longSide = Math.max(widthMm, heightMm);
  const closest = candidates.reduce((best, candidate) =>
    Math.abs(candidate.short - shortSide) + Math.abs(candidate.long - longSide) <
    Math.abs(best.short - shortSide) + Math.abs(best.long - longSide) ? candidate : best);
  return { pageSize: closest.pageSize, orientation: landscape ? 'landscape' : 'portrait' };
}

function titleFromText(text: string, fileName: string): string {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 2);
  const titleLine = lines.find(line => /\b(certificate|certification|clearance|permit)\b/i.test(line));
  return (titleLine || lines[0] || fileName.replace(/\.[^.]+$/, '')).slice(0, 120);
}

function extractHeader(text: string, title: string): { body: string; header: Partial<CertificateHeaderConfig> } {
  const lines = text.split(/\r?\n/);
  const header: Partial<CertificateHeaderConfig> = {};
  const excluded = new Set<number>();
  lines.forEach((line, index) => {
    const value = line.trim();
    if (value.localeCompare(title, undefined, { sensitivity: 'accent' }) === 0) {
      excluded.add(index);
      return;
    }
    if (/^republic of the philippines$/i.test(value)) {
      header.countryText = value;
      excluded.add(index);
    } else if (/^province of southern leyte$/i.test(value)) {
      header.provinceText = value;
      excluded.add(index);
    } else if (/^(?:municipality|municipal government) of hinunangan$/i.test(value)) {
      header.municipalityText = value;
      excluded.add(index);
    } else if (/^barangay\s+.+$/i.test(value)) {
      header.barangayText = value;
      excluded.add(index);
    } else if (/office of the punong barangay/i.test(value)) {
      header.officeTitle = value;
      excluded.add(index);
    }
  });
  return { body: lines.filter((_, index) => !excluded.has(index)).join('\n').trim(), header };
}

function removeDetectedSignatureBlock(text: string): { body: string; signatories: CertificateDynamicSignatory[] } {
  const lines = text.split(/\r?\n/);
  const cutoff = Math.floor(lines.length * 0.55);
  const markerIndex = lines.findIndex((line, index) =>
    index >= cutoff && /\b(?:signature|punong barangay|barangay biosecurity officer|certified by|approved by|conforme)\b/i.test(line),
  );
  if (markerIndex < 0) return { body: text, signatories: [] };
  const footer = lines.slice(markerIndex).join('\n');
  const signatories: CertificateDynamicSignatory[] = [];
  const positions = [
    { pattern: /punong barangay/i, position: 'Punong Barangay' },
    { pattern: /barangay biosecurity officer|\bbbo\b/i, position: 'Barangay Biosecurity Officer' },
    { pattern: /farmer\s*\/?\s*owner|conforme/i, position: 'Farmer / Owner' },
  ];
  positions.forEach(({ pattern, position }, index) => {
    if (!pattern.test(footer)) return;
    signatories.push({
      id: `imported-signatory-${index + 1}`,
      name: '',
      position,
      showSignatureImage: false,
      showSignatureLine: true,
      order: signatories.length + 1,
      alignment: 'center',
    });
  });
  return { body: lines.slice(0, markerIndex).join('\n').trim(), signatories };
}

async function recognizeImage(image: Blob | HTMLCanvasElement, progress?: (value: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: event => {
      if (event.status === 'recognizing text' && typeof event.progress === 'number') progress?.(event.progress);
    },
  });
  try {
    const result = await worker.recognize(image);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

async function extractPdf(file: File, progress?: (value: number) => void): Promise<{
  text: string;
  pageSize: ExtractedCertificate['pageSize'];
  orientation: ExtractedCertificate['orientation'];
  warnings: string[];
  hasImages: boolean;
}> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdfDocument = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const warnings: string[] = [];
  const pageTexts: string[] = [];
  let pageSize: ExtractedCertificate['pageSize'] = 'A4';
  let orientation: ExtractedCertificate['orientation'] = 'portrait';
  let hasImages = false;

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
      const operations = await page.getOperatorList();
      hasImages ||= operations.fnArray.some(operation =>
        [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]
          .includes(operation),
      );
      if (pageNumber === 1) {
        const dimensions = inferPageSize(page.view[2] - page.view[0], page.view[3] - page.view[1]);
        pageSize = dimensions.pageSize;
        orientation = dimensions.orientation;
      }
      const content = await page.getTextContent();
      const rows = new Map<number, Array<{ x: number; text: string }>>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const row = Math.round(item.transform[5] / 2);
        const items = rows.get(row) || [];
        items.push({ x: item.transform[4], text: item.str });
        rows.set(row, items);
      }
      let text = [...rows.entries()]
        .sort(([left], [right]) => right - left)
        .map(([, items]) => items.sort((left, right) => left.x - right.x).map(item => item.text).join(' ').trim())
        .filter(Boolean)
        .join('\n');
      if (text.length < 24) {
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to prepare a PDF page for OCR.');
        await page.render({ canvasContext: context, viewport }).promise;
        text = await recognizeImage(canvas, progress);
        canvas.width = 0;
        canvas.height = 0;
        if (text.trim()) warnings.push(`Page ${pageNumber} was scanned; text was extracted with OCR and needs review.`);
        else warnings.push(`Page ${pageNumber} contains no readable text. Complete it manually.`);
      }
      pageTexts.push(text);
    }
  } finally {
    await pdfDocument.destroy();
  }
  return { text: pageTexts.join('\n\n'), pageSize, orientation, warnings, hasImages };
}

export async function extractCertificate(
  file: File,
  progress?: (value: number) => void,
): Promise<ExtractedCertificate> {
  if (!file.size || file.size > 5 * 1024 * 1024) {
    throw new Error('Choose a non-empty certificate no larger than 5 MB.');
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  let text = '';
  let pageSize: ExtractedCertificate['pageSize'] = 'A4';
  let orientation: ExtractedCertificate['orientation'] = 'portrait';
  const warnings = [
    'Layout, fonts, logos, and spacing are estimates. Review the generated template before saving.',
    'Source logos and seal images are not copied into the printable template. Add only approved assets separately.',
    'Signatures and official seals are not imported. Add authorized signatory details separately.',
  ];
  let hasImages = false;
  let hasTables = false;

  if (extension === 'pdf' && file.type === 'application/pdf') {
    const result = await extractPdf(file, progress);
    text = result.text;
    pageSize = result.pageSize;
    orientation = result.orientation;
    warnings.push(...result.warnings);
    hasImages = result.hasImages;
    if (!text.trim()) warnings.push('No readable PDF text was detected. Review and enter the wording manually.');
  } else if (extension === 'docx' && file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = (await import('mammoth')).default;
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const html = await mammoth.convertToHtml({ arrayBuffer });
    text = result.value;
    hasTables = /<table\b/i.test(html.value);
    hasImages = /<img\b/i.test(html.value);
    if (text.trim().length < 24 && hasImages && typeof DOMParser !== 'undefined') {
      const parsed = new DOMParser().parseFromString(html.value, 'text/html');
      const imageTexts: string[] = [];
      for (const image of Array.from(parsed.querySelectorAll('img'))) {
        const source = image.getAttribute('src') || '';
        if (!source.startsWith('data:image/')) continue;
        const response = await fetch(source);
        imageTexts.push(await recognizeImage(await response.blob(), progress));
      }
      if (imageTexts.some(value => value.trim())) {
        text = [text, ...imageTexts].filter(Boolean).join('\n\n');
        warnings.push('Text was recovered from embedded DOCX images using OCR. Check the result carefully.');
      }
    }
    if (result.messages.length) warnings.push('Some DOCX formatting could not be preserved. Review the extracted text and layout.');
    if (!text.trim()) warnings.push('No readable DOCX text was detected. Review and enter the wording manually.');
  } else if (['jpg', 'jpeg', 'png'].includes(extension || '') &&
      (file.type === 'image/jpeg' || file.type === 'image/png')) {
    text = await recognizeImage(file, progress);
    hasImages = true;
    warnings.push('Image text was extracted with OCR. Check names, numbers, alignment, and blank fields carefully.');
    if (!text.trim()) warnings.push('OCR found no readable text. Enter the certificate wording manually.');
  } else {
    throw new Error('Unsupported or mismatched file type. Use a PDF, DOCX, JPG/JPEG, or PNG certificate.');
  }

  const normalized = text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const title = titleFromText(normalized, file.name);
  const extractedHeader = extractHeader(normalized, title);
  const extractedSignatures = removeDetectedSignatureBlock(extractedHeader.body || normalized);
  if (extractedSignatures.signatories.length) {
    warnings.push('Detected signature-block text was omitted. Configure authorized printed signatory names manually; no signature image was imported.');
  }
  const detected = detectCertificateFields(extractedSignatures.body || extractedHeader.body || normalized);
  const headings = normalized.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 2 && line.length <= 100 && (line === line.toLocaleUpperCase() || /\b(certificate|certification|clearance|permit)\b/i.test(line)))
    .slice(0, 12);
  hasTables ||= normalized.split(/\r?\n/).some(line =>
    (line.match(/\t/g) || []).length >= 2 || (line.match(/\s{3,}/g) || []).length >= 2);
  if (normalized.length < 40) warnings.push('Little text was detected; manual review is required before this template is used.');
  return {
    text: detected.text,
    title,
    header: extractedHeader.header,
    signatories: extractedSignatures.signatories,
    warnings: [...new Set(warnings)],
    fields: detected.fields,
    pageSize,
    orientation,
    layoutHints: {
      headings,
      hasTables,
      hasImages,
      hasSignatureArea: /\b(signature|punong barangay|authorized by|certified by|approved by)\b/i.test(normalized),
    },
  };
}
