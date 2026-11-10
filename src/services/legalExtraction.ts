import { imageKey, readCheckpoint, writeCheckpoint } from './legalOcrCheckpoint';
import JSZip from 'jszip';

export interface SourcePage {
  pageNumber: number;
  text: string;
  imageUrl?: string;
  images?: string[];
  nativeText?: string;
  orderedText?: string;
  ocrApplied?: boolean;
  confidence?: number;
  warnings?: string[];
}
export type Progress = (step: string, percent: number) => void;
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});
const elements = (node: Element | Document, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
const attr = (node: Element, name: string) => Array.from(node.attributes).find(a => a.localName === name)?.value || '';
export async function detectFormat(file: File): Promise<string> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const s = String.fromCharCode(...b);
  if (s.startsWith('%PDF-')) return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    if (zip.file('word/document.xml')) return 'docx';
    if (zip.file('xl/workbook.xml')) return 'xlsx';
    throw new Error('Unsupported ZIP document package.');
  }
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 137 && s.slice(1, 4) === 'PNG') return 'png';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'webp';
  if (s.startsWith('II*\0') || s.startsWith('MM\0*')) return 'tiff';
  if (b[0] === 0xd0 && b[1] === 0xcf) throw new Error('Legacy DOC/OLE requires conversion to DOCX or PDF before import. No text was extracted.');
  if (/\.(txt|csv)$/i.test(file.name) && !b.includes(0)) return file.name.split('.').pop()!.toLowerCase();
  throw new Error('Unsupported or unrecognized file contents. Convert to DOCX, PDF, TIFF, PNG, JPEG, WebP or UTF-8 TXT.');
}

async function tiffImages(bytes: ArrayBuffer): Promise<string[]> {
  const UTIF = (await import('utif')).default;
  const images: string[] = [];
  for (const frame of UTIF.decode(bytes)) {
    const width = frame.t256?.[0]; const height = frame.t257?.[0];
    if (!width || !height || width * height > 25_000_000) throw new Error('TIFF page dimensions are invalid or exceed 25 million pixels. Resize it before OCR.');
    UTIF.decodeImage(bytes, frame);
    const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(frame)), frame.width, frame.height), 0, 0);
    images.push(canvas.toDataURL('image/png')); canvas.width = canvas.height = 0;
  }
  if (!images.length) throw new Error('TIFF contains no readable image frames.');
  return images;
}

/** Read package relationships and body in XML order; never enumerate media as pages. */
export async function readDocx(file: File): Promise<SourcePage[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  if (elements(xml, 'parsererror').length) throw new Error('Invalid Word document XML.');
  const relFile = zip.file('word/_rels/document.xml.rels');
  const rels = new Map<string, string>();
  if (relFile) {
    const relXml = new DOMParser().parseFromString(await relFile.async('string'), 'application/xml');
    for (const rel of elements(relXml, 'Relationship')) {
      if (attr(rel, 'TargetMode') === 'External') continue;
      const target = attr(rel, 'Target');
      const path = target.startsWith('/') ? target.slice(1) : new URL(target, 'https://package/word/').pathname.slice(1);
      rels.set(attr(rel, 'Id'), path);
    }
  }
  const size = elements(xml, 'pgSz')[0];
  const margins = elements(xml, 'pgMar')[0];
  const usableHeight = (Number(size && attr(size, 'h')) || 16838) - (Number(margins && attr(margins, 'top')) || 1440) - (Number(margins && attr(margins, 'bottom')) || 1440);
  const pages: SourcePage[] = [];
  let page: SourcePage = { pageNumber: 1, text: '', images: [], warnings: ['DOCX pagination follows explicit/rendered breaks; flowing Word layout may differ. Review page boundaries.', 'Tables are flattened with tab-separated cells; verify columns against the original.'] };
  const flush = (force = false) => { if (force || page.text.trim() || page.images!.length) { page.orderedText = page.text; page.nativeText = page.text.replace(/\uFFF0\d+\uFFF1/g, ''); pages.push(page); page = { pageNumber: pages.length + 1, text: '', images: [], warnings: [] }; } };
  const walk = async (node: Element): Promise<void> => {
    if (node.localName === 'AlternateContent') {
      const preferred = Array.from(node.children).find(child => child.localName === 'Choice') || Array.from(node.children)[0];
      if (preferred) await walk(preferred);
      return;
    }
    if (node.localName === 'drawing' || node.localName === 'pict') {
      const height = Number(attr(elements(node, 'extent')[0] || node, 'cy')) / 635;
      if (height > usableHeight * 0.6 && page.images!.length) {
        flush(); page.warnings!.push('Page boundary inferred from full-page image geometry. Verify against Word layout.');
      }
    }
    if (node.localName === 't') { page.text += node.textContent || ''; return; }
    if (node.localName === 'tab') { page.text += '\t'; return; }
    if (node.localName === 'lastRenderedPageBreak' || (node.localName === 'br' && attr(node, 'type') === 'page')) { flush(true); return; }
    if (node.localName === 'br') { page.text += '\n'; return; }
    if (node.localName === 'pageBreakBefore') { flush(); return; }
    if (node.localName === 'blip' || node.localName === 'imagedata') {
      const path = rels.get(attr(node, 'embed') || attr(node, 'id'));
      if (!path || !zip.file(path)) { page.warnings!.push('Missing or external embedded image; inspect original.'); return; }
      const bytes = await zip.file(path)!.async('uint8array');
      const ext = path.split('.').pop()?.toLowerCase();
      const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp' } as Record<string, string>)[ext || ''];
      if (!mime) throw new Error(`Embedded ${ext} image cannot be OCRed. Convert document to PDF; no image was silently skipped.`);
      const images = mime === 'image/tiff' ? await tiffImages(bytes.slice().buffer as ArrayBuffer) : [await dataUrl(new Blob([bytes as BlobPart], { type: mime }))];
      for (const image of images) {
        page.text += `\uFFF0${page.images!.length}\uFFF1`; page.images!.push(image);
      }
      if (images.length > 1) page.warnings!.push('All frames of an embedded multipage TIFF were retained at this image position; review document boundaries.');
      return;
    }
    for (const child of Array.from(node.children)) await walk(child);
    if (node.localName === 'p') page.text += '\n';
    if (node.localName === 'tc') page.text = page.text.replace(/\n+$/, '') + '\t';
    if (node.localName === 'tr') page.text = page.text.replace(/\t$/, '') + '\n';
  };
  const body = elements(xml, 'body')[0];
  if (!body) throw new Error('Word body is missing.');
  await walk(body); flush(true);
  const ancillaryParts = Object.keys(zip.files).filter(name => /^word\/(?:header|footer|footnotes|endnotes).*\.xml$/.test(name));
  if (ancillaryParts.length) pages[0].warnings!.push(`Additional Word content in ${ancillaryParts.join(', ')} requires original-file review; body extraction does not reproduce header/footer pagination.`);
  if (!pages.length) throw new Error('Document contains no readable body or supported images.');
  return pages;
}

async function interruptible<T>(operation: Promise<T>, signal: AbortSignal | undefined, timeoutMs: number, cancel: () => void): Promise<T> {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => { cancel(); reject(signal?.reason || new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { cancel(); reject(new Error('OCR timed out. Retry this page or use a clearer scan.')); }, timeoutMs);
  });
  try { return await Promise.race([operation, stopped]); }
  finally { clearTimeout(timer!); signal?.removeEventListener('abort', abort!); }
}

export async function ocrImage(image: string, signal?: AbortSignal): Promise<{ text: string; confidence: number }> {
  signal?.throwIfAborted();
  const { createWorker } = await import('tesseract.js');
  let abandoned = false;
  const starting = createWorker('eng', 1, { workerPath: '/legal-ocr/worker.min.js', corePath: '/legal-ocr/', langPath: '/legal-ocr/', workerBlobURL: false });
  void starting.then(worker => { if (abandoned) void worker.terminate(); }).catch(() => {});
  const worker = await interruptible(starting, signal, 90000, () => { abandoned = true; });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const bitmap = await createImageBitmap(await (await fetch(image)).blob());
    if (bitmap.width * bitmap.height > 25_000_000) { bitmap.close(); throw new Error('Scan exceeds 25 million pixels. Resize it before OCR.'); }
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.filter = 'grayscale(1) contrast(1.2)'; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    let result = await interruptible(worker.recognize(canvas, { rotateAuto: true }), signal, 180000, () => { void worker.terminate(); });
    if (result.data.confidence < 80 && result.data.text.trim()) {
      for (const angle of [180, 90, 270]) {
        signal?.throwIfAborted();
        const rotated = document.createElement('canvas');
        rotated.width = angle === 180 ? canvas.width : canvas.height;
        rotated.height = angle === 180 ? canvas.height : canvas.width;
        const context = rotated.getContext('2d')!;
        context.translate(rotated.width / 2, rotated.height / 2); context.rotate(angle * Math.PI / 180);
        context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        const candidate = await interruptible(worker.recognize(rotated, { rotateAuto: true }), signal, 180000, () => { void worker.terminate(); });
        rotated.width = rotated.height = 0;
        if (candidate.data.confidence > result.data.confidence) result = candidate;
        if (result.data.confidence >= 90) break;
      }
    }
    canvas.width = canvas.height = 0;
    signal?.throwIfAborted();
    return { text: result.data.text, confidence: result.data.confidence };
  } finally { await worker.terminate(); }
}

export async function extractPages(file: File, format: string, progress?: Progress, signal?: AbortSignal): Promise<SourcePage[]> {
  signal?.throwIfAborted();
  let pages: SourcePage[];
  if (format === 'docx') { progress?.('Extracting embedded images and native paragraphs', 0); pages = await readDocx(file); }
  else if (format === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    pages = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        signal?.throwIfAborted();
        const source = await pdf.getPage(n);
        const content = await source.getTextContent();
        const text = content.items.map((item: any) => item.str === undefined ? '' : item.str + (item.hasEOL ? '\n' : '\t')).join('');
        const baseViewport = source.getViewport({ scale: 1 });
        const viewport = source.getViewport({ scale: Math.min(2, 2600 / Math.max(baseViewport.width, baseViewport.height)) });
        const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
        await source.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const image = canvas.toDataURL('image/png');
        const ops = await source.getOperatorList();
        const hasImages = ops.fnArray.some(op => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(op));
        // OCR entire rendered page for mixed/scanned pages, avoiding duplicate text-layer append.
        pages.push({ pageNumber: n, text, nativeText: text, imageUrl: image, images: hasImages || text.trim().length < 30 ? [image] : [], warnings: ['Where OCR is needed, rendered PDF page OCR replaces the text layer to include scanned regions without duplicating content. Verify tables and signatures.'] });
        canvas.width = canvas.height = 0;
        progress?.(`Reading PDF page ${n}/${pdf.numPages}`, 0);
      }
    } finally { await pdf.destroy(); }
  } else if (format === 'tiff') {
    pages = (await tiffImages(await file.arrayBuffer())).map((image, i) => ({ pageNumber: i + 1, text: '', images: [image], imageUrl: image }));
  } else if (['jpg', 'png', 'webp'].includes(format)) {
    const image = await dataUrl(file); pages = [{ pageNumber: 1, text: '', imageUrl: image, images: [image] }];
  } else { pages = [{ pageNumber: 1, text: await file.text() }]; }
  for (let i = 0; i < pages.length; i++) {
    signal?.throwIfAborted(); const page = pages[i]; page.warnings ||= [];
    const results: string[] = [];
    for (const image of page.images || []) {
      progress?.(`Performing OCR on page ${i + 1}/${pages.length}`, Math.round(i / pages.length * 100));
      const key = await imageKey(`legal-ocr-v2:${image}`);
      let result;
      try { result = await readCheckpoint(key); } catch { page.warnings.push('Local checkpoint storage unavailable; retries will repeat OCR.'); }
      if (!result) {
        result = await ocrImage(image, signal);
        try { await writeCheckpoint(key, result); } catch { page.warnings.push('Unable to persist OCR checkpoint.'); }
      }
      page.ocrApplied = true;
      page.confidence = Math.min(page.confidence ?? 100, result.confidence);
      if (result.confidence < 70 || !result.text.trim()) page.warnings.push(`Low confidence (${result.confidence.toFixed(0)}%); unreadable words must be checked against the scan.`);
      results.push(result.text);
    }
    if (results.length) {
      const ocr = results.join('\n\n');
      if (page.orderedText !== undefined) {
        const recognizedLines = new Set(ocr.split('\n').map(line => line.trim()).filter(Boolean));
        page.text = page.orderedText.split('\n').filter(line => !line.trim() || !recognizedLines.has(line.trim())).join('\n')
          .replace(/\uFFF0(\d+)\uFFF1/g, (_, index) => `\n${results[Number(index)]}\n`);
      } else if (page.nativeText?.trim()) {
        const nativeLines = page.nativeText.split('\n').map(line => line.trim()).filter(Boolean);
        const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
        const used = new Set<number>();
        const similarity = (a: string, b: string) => {
          const left = normalize(a); const right = normalize(b);
          if (left === right) return 1;
          const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) || []);
          const x = words(a); const y = words(b);
          return [...x].filter(word => y.has(word)).length / Math.max(x.size, y.size, 1);
        };
        page.text = ocr.split('\n').map(line => {
          const index = nativeLines.findIndex(native => similarity(native, line) > 0.75);
          if (index < 0) return line;
          if (used.has(index)) return '';
          used.add(index); return nativeLines[index];
        }).join('\n');
        const unmatched = nativeLines.filter((_, i) => !used.has(i));
        if (unmatched.length) {
          page.text += `\n\n${unmatched.join('\n')}`;
          page.warnings.push('Some native text did not align with OCR. Retained at page end; check order and possible duplication.');
        }
      } else {
        page.text = ocr.trim();
      }
      page.imageUrl ||= page.images?.[0];
      page.warnings.push('OCR is unverified. Signatures, stamps, columns and handwritten text remain available in the original images.');
    }
    const headings = [...page.text.matchAll(/^(?:PROVINCIAL\s+|MUNICIPAL\s+)?(ORDINANCE|RESOLUTION)\s+NO\.?\s*([\d]+(?:[-–][\d]+)?)/gim)].map(match => `${match[1].toUpperCase()}-${match[2]}`);
    if (new Set(headings).size > 1) page.warnings.push('Multiple legal headings occur on the same page. Review references; if these are separate documents, place the text cursor at the boundary and split.');
    if (!page.text.trim()) page.warnings.push('No readable text detected on this page. Manual transcription required.');
    progress?.(`Extracted page ${i + 1}/${pages.length}`, Math.round((i + 1) / pages.length * 100));
  }
  return pages;
}

/** Suggest only page-level boundaries. References in body paragraphs are not headings. */
export function splitLegalPages(pages: SourcePage[]): SourcePage[][] {
  const groups: SourcePage[][] = []; let identity = '';
  for (const page of pages) {
    const heading = page.text.slice(0, 1400).match(/^(?:PROVINCIAL\s+|MUNICIPAL\s+)?(ORDINANCE|RESOLUTION)\s+NO\.?\s*([\d]+(?:[-–][\d]+)?)/im);
    const next = heading ? `${heading[1].toUpperCase()}-${heading[2]}` : '';
    if (!groups.length || (next && identity && next !== identity)) groups.push([]);
    if (next) identity = next;
    groups[groups.length - 1].push(page);
  }
  return groups;
}

export interface FileInspection { format: string; pageCount?: number; status: string; ocrRequired: boolean; error?: string }
export async function inspectLegalFile(file: File): Promise<FileInspection> {
  try {
    if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('Choose a non-empty file up to 25 MB.');
    const format = await detectFormat(file);
    if (format === 'docx') {
      const pages = await readDocx(file);
      const native = pages.some(p => p.nativeText?.trim());
      const images = pages.some(p => p.images?.length);
      return { format, pageCount: pages.length, status: native ? (images ? 'Native text and embedded images' : 'Native text') : 'Scanned images', ocrRequired: images };
    }
    if (format === 'pdf') {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
      try {
        let ocrRequired = false; let native = false;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i); const content = await page.getTextContent();
          native ||= content.items.some(item => 'str' in item && !!item.str.trim());
          const ops = await page.getOperatorList();
          ocrRequired ||= !content.items.length || ops.fnArray.some(op => [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].includes(op));
          page.cleanup();
        }
        return { format, pageCount: pdf.numPages, status: native ? (ocrRequired ? 'Native text and scanned images' : 'Native text') : 'Scanned images', ocrRequired };
      } finally { await pdf.destroy(); }
    }
    if (format === 'tiff') {
      const UTIF = (await import('utif')).default;
      return { format, pageCount: UTIF.decode(await file.arrayBuffer()).length, status: 'Scanned images', ocrRequired: true };
    }
    const image = ['jpg', 'png', 'webp'].includes(format);
    return { format, pageCount: image || format === 'txt' ? 1 : undefined, status: image ? 'Scanned image' : 'Native text / spreadsheet', ocrRequired: image };
  } catch (error) { return { format: 'Unrecognized', status: 'Cannot process', ocrRequired: false, error: error instanceof Error ? error.message : 'Inspection failed' }; }
}

/** Render references for the saved-source inspector without rerunning OCR. */
export async function originalPageImages(file: File, pageNumber: number): Promise<string[]> {
  const format = await detectFormat(file);
  if (format === 'docx') return (await readDocx(file)).find(page => page.pageNumber === pageNumber)?.images || [];
  if (format === 'tiff') {
    const UTIF = (await import('utif')).default; const bytes = await file.arrayBuffer();
    const frame = UTIF.decode(bytes)[pageNumber - 1];
    if (!frame) return [];
    if ((frame.t256?.[0] || 0) * (frame.t257?.[0] || 0) > 25_000_000) throw new Error('TIFF page is too large to preview. Download the original.');
    UTIF.decodeImage(bytes, frame);
    const canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(frame)), frame.width, frame.height), 0, 0);
    return [canvas.toDataURL('image/png')];
  }
  return [];
}
