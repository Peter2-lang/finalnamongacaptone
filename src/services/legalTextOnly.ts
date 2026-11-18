/** Shared by extraction, review and the API. Never infer or rewrite legal wording. */
export interface ExcludedRegion { x: number; y: number; width: number; height: number }
export interface TextCleanup { text: string; warnings: string[]; removedLines: string[] }
const binaryPackage = /(?:PK\x03\x04|\[Content_Types\]\.xml|word\/_rels\/document\.xml\.rels|\x00)/;
const embeddedImage = /(?:data:image\/|<\s*(?:img|svg|canvas|image)\b|!\[[^\]]*\]\(\s*(?:data:|https?:))/i;
export function validateLegalText(text: string): string[] {
  const errors: string[] = [];
  if (binaryPackage.test(text)) errors.push('ZIP/binary package content is not legal text. Re-extract the original document.');
  if (embeddedImage.test(text)) errors.push('Image markup is not permitted in searchable legal text. Keep images in the original source only.');
  if (/[\uFFFD\uFFF0\uFFF1\x01-\x08\x0B\x0E-\x1F]/.test(text)) errors.push('Unreadable symbols or extraction markers require correction against the source.');
  return errors;
}
export function cleanPrintedLegalText(input: string): TextCleanup {
  const errors = validateLegalText(input);
  if (errors.some(error => /ZIP|Image markup/.test(error))) throw new Error(errors.join(' '));
  const removedLines: string[] = [];
  const warnings: string[] = [];
  const lines = input.replace(/\r\n?/g, '\n').split('\n').filter(line => {
    const value = line.trim();
    // Only unmistakable standalone artifacts. Names, positions, dates, currency,
    // numbered provisions and any line containing words are never stripped as noise.
    const artifact = /^(?:scanned (?:with|by) camscanner|camscanner|scanned with adobe scan)$/i.test(value) ||
      /^(?:camera timestamp|scanner timestamp)\s*:\s*\d{4}[-/]\d{2}[-/]\d{2}(?:[ T].*)?$/i.test(value) ||
      /^\[(?:handwritten signature|signature image|government seal|logo|watermark|decorative graphic)\]$/i.test(value) ||
      (!!value && !/[\p{L}\p{N}]/u.test(value) && /^[\s~_^|\\/<>*#=\-–—.·•○●◊◆◇©®™\uFFFD]+$/u.test(value));
    if (artifact) removedLines.push(line);
    return !artifact;
  });
  if (removedLines.length) warnings.push(`${removedLines.length} standalone graphic/scanner artifact line(s) excluded. Compare with the original before confirming.`);
  if (lines.some(line => /\uFFFD/.test(line))) warnings.push('Unreadable characters remain. Correct them from the source; no replacement words were invented.');
  return { text: lines.join('\n'), warnings, removedLines };
}


export function printedImportIssues(document: {
  fullText?: string; title?: string; officialNumber?: string;
  articles?: { sections: { content: string; sectionTitle?: string }[] }[];
  keyArticles?: { text: string }[];
  importProvenance?: { textPolicy?: string; textOnlyReviewed?: boolean; pages: { text: string }[] };
}): string[] {
  if (document.importProvenance?.textPolicy !== 'printed-text-v1') return [];
  const issues: string[] = [];
  if (!document.importProvenance.textOnlyReviewed) issues.push('Printed-text-only review is required.');
  if (!Array.isArray(document.importProvenance.pages) || document.importProvenance.pages.some(page => !page || typeof page.text !== 'string')) return ['Reviewed source pages are required.'];
  if (!Array.isArray(document.articles) || document.articles.some(article => !article || !Array.isArray(article.sections) || article.sections.some(section => !section || typeof section.content !== 'string' || (section.sectionTitle !== undefined && typeof section.sectionTitle !== 'string')))) return ['Valid source sections are required.'];
  if (document.keyArticles && (!Array.isArray(document.keyArticles) || document.keyArticles.some(article => !article || typeof article.text !== 'string'))) return ['Valid source provisions are required.'];
  if ([document.fullText, document.title, document.officialNumber].some(value => value !== undefined && typeof value !== 'string')) return ['Legal text fields must be strings.'];
  const text = document.fullText || '';
  if (text !== document.importProvenance.pages.map(page => page.text).join('\n\n')) issues.push('Saved full text must match the reviewed page text.');
  const fields = [text, document.title || '', document.officialNumber || '', ...document.importProvenance.pages.map(page => page.text),
    ...(document.articles || []).flatMap(article => article.sections.flatMap(section => [section.content, section.sectionTitle || ''])),
    ...(document.keyArticles || []).map(article => article.text)];
  for (const field of fields) {
    issues.push(...validateLegalText(field));
    try { if (cleanPrintedLegalText(field).removedLines.length) issues.push('Standalone scanner/graphic noise must be removed before saving.'); }
    catch { /* validation already contains the reason */ }
  }
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const source = normalize(text);
  if ((document.articles || []).some(article => article.sections.some(section => section.content && !source.includes(normalize(section.content))))) issues.push('Section wording must be present in the reviewed full text. Rebuild sections from corrected text.');
  if ((document.keyArticles || []).some(article => article.text && !source.includes(normalize(article.text)))) issues.push('Searchable provisions must match the reviewed full text.');
  return [...new Set(issues)];
}
