import { detectFormat, extractPages, splitLegalPages } from './legalExtraction';
import * as XLSX from 'xlsx';
import {
  ASFRegulatoryDocument,
  LegalArticle,
  LegalArticleSection,
  LegalDocumentType,
  LegalDocumentCategory,
  LegalDocumentStatus,
} from '../types';
import {
  LegalImportDetectionResult,
  LegalImportFileItem,
  LegalExcelSheetInfo,
  LegalExcelColumnMapping,
} from '../types/legalImport';
import { storageService } from './storageService';

export class LegalDocumentParserService {
  /**
   * Format file size to human-readable string
   */
  static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Main entry point to parse a File or raw text into structured LegalImportDetectionResult
   */
  static async parseFile(
    file: File,
    onProgress?: (step: string, percent: number) => void,
    signal?: AbortSignal
  ): Promise<LegalImportFileItem> {
    onProgress?.('Reading document', 0);
    const item: LegalImportFileItem = {
      id: crypto.randomUUID(), name: file.name, size: file.size,
      sizeFormatted: this.formatFileSize(file.size), type: file.type,
      extension: '', rawText: '', status: 'processing', originalFile: file,
    };
    try {
      item.extension = await detectFormat(file);
      const originalExtension = file.name.split('.').pop()?.toLowerCase();
      if (originalExtension !== item.extension && !(item.extension === 'jpg' && originalExtension === 'jpeg') && !(item.extension === 'tiff' && originalExtension === 'tif')) {
        item.originalFile = new File([file], file.name.replace(/\.[^.]*$/, '') + '.' + item.extension, { type: file.type });
        item.warnings = ['Filename extension differed from detected contents. Source attachment extension was corrected; original bytes are unchanged.'];
      }
      if (['xlsx', 'csv'].includes(item.extension)) {
        const result = await this.parseSpreadsheet(file);
        item.pages = result.pages;
      } else {
        item.pages = await extractPages(file, item.extension, onProgress, signal);
      }
      item.pageCount = item.pages.length;
      item.rawText = item.pages.map(p => p.text).join('\n\n');
      item.ocrApplied = item.pages.some(p => p.ocrApplied);
      item.warnings = [...item.warnings || [], ...item.pages.flatMap(p => (p.warnings || []).map(w => `Page ${p.pageNumber}: ${w}`))];
      item.warnings.push('Review suggested document boundaries, metadata and every page before confirming.');
      onProgress?.('Detecting legal documents; identifying articles and sections', 100);
      item.detection = this.analyzeTextContent(item.rawText, '', item.pages);
      item.status = 'needs_review';
    } catch (error) {
      if (signal?.aborted) throw error;
      item.status = 'error';
      item.errorMessage = error instanceof Error ? error.message : 'Extraction failed';
    }
    return item;
  }

  static splitExtractedItem(item: LegalImportFileItem): LegalImportFileItem[] {
    if (!item.pages?.length || item.status === 'error') return [item];
    return splitLegalPages(item.pages).map(pages => this.itemForPages(item, pages));
  }

  static itemForPages(item: LegalImportFileItem, pages: NonNullable<LegalImportFileItem['pages']>): LegalImportFileItem {
    const rawText = pages.map(p => p.text).join('\n\n');
    return { ...item, id: crypto.randomUUID(), pages, rawText, pageCount: pages.length,
      confirmed: false, detection: this.analyzeTextContent(rawText, '', pages) };
  }

  /**
   * Parse Spreadsheets (XLSX, XLS, CSV)
   */
  static async parseSpreadsheet(
    file: File
  ): Promise<{
    text: string;
    pages: { pageNumber: number; text: string }[];
    sheetData?: { articles: LegalArticle[]; sheets: LegalExcelSheetInfo[] };
  }> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    let combinedText = '';
    const pages: { pageNumber: number; text: string }[] = [];
    const sheetsInfo: LegalExcelSheetInfo[] = [];

    const articlesMap: Map<string, LegalArticle> = new Map();
    let globalSectionCount = 0;

    workbook.SheetNames.forEach((sheetName, idx) => {
      const worksheet = workbook.Sheets[sheetName];
      const json: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const text = json.map(row => (Array.isArray(row) ? row.join(' | ') : String(row))).join('\n');
      
      pages.push({ pageNumber: idx + 1, text: `--- SHEET: ${sheetName} ---\n` + text });
      combinedText += `\n\n--- SHEET: ${sheetName} ---\n\n` + text;

      // Inspect sheet columns & rows for intelligent mapping
      if (json.length > 0 && Array.isArray(json[0])) {
        const headers = json[0].map(h => String(h).trim());
        const sheetInfo = this.analyzeExcelColumns(sheetName, headers, json.length - 1);
        sheetsInfo.push(sheetInfo);

        // Attempt structured row extraction if columns match
        const records: any[] = XLSX.utils.sheet_to_json(worksheet);
        records.forEach((row, rIdx) => {
          const artVal = this.getMappedValue(row, ['article', 'article_no', 'article_number', 'article number', 'chapter']);
          const secVal = this.getMappedValue(row, ['section', 'section_no', 'section_number', 'section number', 'sec', 'no']);
          const secTitle = this.getMappedValue(row, ['section_title', 'section title', 'title', 'heading', 'name']);
          const contentVal = this.getMappedValue(row, ['content', 'text', 'provision', 'body', 'description', 'details']);

          if (secVal || contentVal) {
            globalSectionCount++;
            const artKey = artVal ? String(artVal).toUpperCase() : 'GENERAL PROVISIONS';
            const artTitle = artKey.startsWith('ARTICLE') ? artKey : `ARTICLE ${artKey}`;
            
            if (!articlesMap.has(artTitle)) {
              articlesMap.set(artTitle, {
                id: 'art-' + (articlesMap.size + 1),
                articleNumber: artTitle,
                articleTitle: artTitle,
                sections: [],
              });
            }

            const currentArticle = articlesMap.get(artTitle)!;
            const secNum = secVal ? String(secVal).replace(/^section\s*/i, '') : String(globalSectionCount);
            currentArticle.sections.push({
              id: `sec-${Date.now()}-${rIdx}`,
              sectionNumber: secNum.includes('.') ? secNum : `Section ${secNum}`,
              sectionTitle: secTitle ? String(secTitle) : `Section ${secNum}`,
              content: contentVal ? String(contentVal) : '',
              scannedPageRef: idx + 1,
            });
          }
        });
      }
    });

    const articles = Array.from(articlesMap.values());
    return {
      text: combinedText,
      pages,
      sheetData: {
        articles,
        sheets: sheetsInfo,
      },
    };
  }

  private static getMappedValue(row: any, candidates: string[]): any {
    const keys = Object.keys(row);
    for (const cand of candidates) {
      const matched = keys.find(k => k.toLowerCase().replace(/[^a-z0-9]/g, '') === cand.replace(/[^a-z0-9]/g, ''));
      if (matched && row[matched] !== undefined) {
        return row[matched];
      }
    }
    return undefined;
  }

  /**
   * Helper to map Excel columns automatically
   */
  static analyzeExcelColumns(sheetName: string, headers: string[], rowCount: number): LegalExcelSheetInfo {
    const mapping: Partial<LegalExcelColumnMapping> = {};
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    headers.forEach(h => {
      const n = norm(h);
      if (n.includes('type') || n.includes('doctype')) mapping.docTypeCol = h;
      else if (n.includes('number') || n.includes('docnum') || n.includes('ordinanceno') || n.includes('resolutionno')) mapping.docNumberCol = h;
      else if (n.includes('year') || n.includes('series')) mapping.yearCol = h;
      else if (n.includes('title') && !n.includes('section')) mapping.titleCol = h;
      else if (n.includes('jurisdiction') || n.includes('lgu') || n.includes('municipality')) mapping.jurisdictionCol = h;
      else if (n.includes('category')) mapping.categoryCol = h;
      else if (n.includes('date') || n.includes('enacted') || n.includes('approved')) mapping.dateCol = h;
      else if (n.includes('article') || n.includes('chapter')) mapping.articleCol = h;
      else if (n.includes('section') && !n.includes('title') && !n.includes('content')) mapping.sectionCol = h;
      else if (n.includes('sectiontitle') || (n.includes('section') && n.includes('title'))) mapping.sectionTitleCol = h;
      else if (n.includes('content') || n.includes('text') || n.includes('provision') || n.includes('body')) mapping.contentCol = h;
    });

    let inferredType: 'ordinance' | 'resolution' | 'sections' | 'mixed' | 'unknown' = 'unknown';
    const sName = sheetName.toLowerCase();
    if (sName.includes('ordinance')) inferredType = 'ordinance';
    else if (sName.includes('resolution')) inferredType = 'resolution';
    else if (sName.includes('section')) inferredType = 'sections';
    else if (mapping.sectionCol || mapping.contentCol) inferredType = 'sections';
    else inferredType = 'mixed';

    return {
      sheetName,
      rowCount,
      columns: headers,
      mapping,
      selected: true,
      inferredType,
    };
  }

  /**
   * Parse Word DOCX
   */
  static async parseDocx(file: File) {
    const pages = await extractPages(file, 'docx');
    return { text: pages.map(p => p.text).join('\n\n'), pages };
  }

  static async parsePdf(file: File, onProgress?: (step: string, percent: number) => void) {
    const pages = await extractPages(file, 'pdf', onProgress);
    return { text: pages.map(p => p.text).join('\n\n'), pages };
  }

  static async parseImageWithOCR(file: File, onProgress?: (step: string, percent: number) => void) {
    const pages = await extractPages(file, await detectFormat(file), onProgress);
    return { text: pages.map(p => p.text).join('\n\n'), pages, dataUrl: pages[0]?.imageUrl || '' };
  }

  /**
   * Comprehensive Legal Text Analysis & Metadata Extraction
   */
  static analyzeTextContent(
    rawText: string,
    fileName: string,
    pages?: { pageNumber: number; text: string }[]
  ): LegalImportDetectionResult {
    const text = rawText || '';
    const cleanText = text.replace(/\r\n/g, '\n');

    // 1. Identify Document Type
    let docType: LegalDocumentType = 'other';
    let docTypeName = 'Unclassified legal document';
    let category: LegalDocumentCategory = 'other';

    if (/REPUBLIC\s+ACT/i.test(cleanText) || /R\.A\.\s*NO/i.test(cleanText) || /RA\s+[0-9]+/i.test(cleanText)) {
      docType = 'republic_act';
      docTypeName = 'Republic Act';
      category = 'national_reference';
    } else if (/PROCLAMATION/i.test(cleanText) || /PROC\.\s*NO/i.test(cleanText)) {
      docType = 'proclamation';
      docTypeName = 'Presidential Proclamation';
      category = 'national_reference';
    } else if (/DEPARTMENT\s+ORDER/i.test(cleanText) || /D\.O\.\s*NO/i.test(cleanText)) {
      docType = 'department_order';
      docTypeName = 'Department Order';
      category = 'national_reference';
    } else if (/PROVINCIAL\s+ORDINANCE/i.test(cleanText) || /SANGGUNIANG\s+PANLALAWIGAN/i.test(cleanText)) {
      docType = 'provincial_ordinance';
      docTypeName = 'Provincial Ordinance';
      category = 'ordinance';
    } else if (/MUNICIPAL\s+ORDINANCE/i.test(cleanText) || /ORDINANCE\s+NO/i.test(cleanText)) {
      docType = 'municipal_ordinance';
      docTypeName = 'Municipal Ordinance';
      category = 'ordinance';
    } else if (/RESOLUTION\s+NO/i.test(cleanText) || /RESOLUTION/i.test(cleanText)) {
      docType = 'resolution';
      docTypeName = 'Resolution';
      category = 'resolution';
    } else if (/ADMINISTRATIVE\s+ORDER/i.test(cleanText) || /A\.O\.\s*NO/i.test(cleanText)) {
      docType = 'administrative_order';
      docTypeName = 'Administrative Order';
      category = 'national_reference';
    } else if (/EXECUTIVE\s+ORDER/i.test(cleanText) || /E\.O\.\s*NO/i.test(cleanText)) {
      docType = 'municipal_eo';
      docTypeName = 'Executive Order';
      category = 'ordinance';
    } else if (/MEMORANDUM/i.test(cleanText)) {
      docType = 'memorandum';
      docTypeName = 'Memorandum Circular';
      category = 'national_reference';
    }

    const primaryHeading = cleanText.match(/^(PROVINCIAL\s+ORDINANCE|MUNICIPAL\s+ORDINANCE|ORDINANCE|RESOLUTION)\s+NO\.?/im);
    if (primaryHeading) {
      const heading = primaryHeading[1].toUpperCase();
      docType = heading === 'RESOLUTION' ? 'resolution' : heading.startsWith('PROVINCIAL') ? 'provincial_ordinance' : 'municipal_ordinance';
      docTypeName = heading === 'RESOLUTION' ? 'Resolution' : heading.startsWith('PROVINCIAL') ? 'Provincial Ordinance' : 'Municipal Ordinance';
      category = heading === 'RESOLUTION' ? 'resolution' : 'ordinance';
    }

    // 2. Identify Document Number & Series Year
    let officialNumber = '';
    let seriesYear = '';

    const numMatch = cleanText.match(/(?:ORDINANCE|RESOLUTION|EXECUTIVE\s+ORDER|ADMINISTRATIVE\s+ORDER|ORDER|NO\.)\s*(?:NO\.?)?\s*([0-9]{4}-[0-9]+|[0-9]+-[0-9]{4}|[0-9]+|[0-9]{2,4}-[0-9]{1,4})/i) ||
      cleanText.match(/NO\.\s*([0-9A-Z\-_]+)/i);

    if (numMatch && numMatch[1]) {
      officialNumber = numMatch[1].trim();
      // Extract year from number if e.g. 2025-59 or Series of 2026
      const yrMatch = officialNumber.match(/20[0-9]{2}/);
      if (yrMatch) {
        seriesYear = yrMatch[0];
      }
    }

    seriesYear ||= cleanText.match(/SERIES\s+OF\s+(20[0-9]{2})/i)?.[1] || '';

    // 3. Identify Jurisdiction
    let jurisdiction = '';
    let jurisdictionLevel: 'Municipal' | 'Provincial' | 'National' | 'Regional' = 'Municipal';
    let issuingAuthority = '';
    const authorityLine = cleanText.split('\n').find(line => /SANGGUNIANG|OFFICE OF/i.test(line));
    if (authorityLine) issuingAuthority = authorityLine.trim();

    const jurisdictionLine = cleanText.split('\n').find(line => /^(?:Province|Municipality|City)\s+of\s+/i.test(line.trim()));
    jurisdiction = jurisdictionLine?.trim() || '';
    if (/PROVINCIAL|SANGGUNIANG\s+PANLALAWIGAN/i.test(cleanText.slice(0, 1400))) jurisdictionLevel = 'Provincial';
    else if (/DEPARTMENT\s+OF|REPUBLIC\s+ACT/i.test(cleanText.slice(0, 1400))) jurisdictionLevel = 'National';

    // 4. Identify Title
    let title = '';
    const titleMatch = cleanText.match(/^(?:AN\s+ORDINANCE|A\s+RESOLUTION|RESOLUTION(?!\s+NO\.?\s)|AN\s+ACT|AN\s+ORDER)\s+[^\n]+(?:\n(?!WHEREAS|SECTION|ARTICLE|Author|Sponsor|RESOLVED|NOW,)[^\n]+)*/im);
    title = titleMatch?.[0]?.trim() || '';

    // 5. Identify Author & Signatories
    let author: string | undefined;
    const authorMatch = cleanText.match(/^(?:Author|Authored by|Sponsor|Introduced by)[ \t]*:?[ \t]*([^\n]+)/im);
    if (authorMatch && authorMatch[1]) {
      author = authorMatch[1].trim();
    }

    // 6. Parse Articles and Sections hierarchically
    const articles = this.extractArticlesAndSections(cleanText, pages);

    // 7. Extract Penalties
    const penalties = [];

    // 8. Extract Locational Rules & Setbacks
    const locationalRules = [];

    // 9. Extract Referenced Laws
    const referencedLaws = this.extractReferencedLaws(cleanText);

    // 10. Generate Tags
    const tags = this.generateLegalTags(cleanText, docTypeName, jurisdiction);

    // 11. Generate Classification Path
    const classificationPath = [
      'Legal Documents',
      docTypeName + 's',
      jurisdictionLevel,
      jurisdictionLevel === 'Municipal' ? 'Hinunangan' : jurisdictionLevel === 'Provincial' ? 'Southern Leyte' : 'National',
      seriesYear,
      `${docTypeName} No. ${officialNumber}`,
    ];

    const totalSectionsCount = articles.reduce((acc, a) => acc + a.sections.length, 0);

    return {
      docType,
      docTypeName,
      officialNumber,
      seriesYear,
      jurisdiction,
      jurisdictionLevel,
      issuingAuthority,
      author,
      title,
      category,
      status: 'draft',
      dateEnacted: (() => {
        const match = cleanText.match(/(?:APPROVED|ENACTED|ADOPTED)[ \t]*(?:ON)?[ \t:,-]*(\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i);
        if (!match) return undefined;
        const raw = match[1];
        const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const named = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const year = Number(iso?.[1] || named?.[3]);
        const month = iso ? Number(iso[2]) - 1 : months.indexOf(named?.[1].toLowerCase() || '');
        const day = Number(iso?.[3] || named?.[2]);
        const date = new Date(Date.UTC(year, month, day));
        return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : undefined;
      })(),
      tags,
      legalBasis: [],
      referencedLaws,
      classificationPath,
      articles,
      totalSectionsCount,
      penalties,
      locationalRules,
      isDuplicate: false,
      duplicateAction: 'new_document',
    };
  }

  /**
   * Structure parser for Articles, Sections, Subsections
   */
  static extractArticlesAndSections(
    text: string,
    pages?: { pageNumber: number; text: string }[]
  ): LegalArticle[] {
    const articles: LegalArticle[] = [];
    const articleRegex = /(?:ARTICLE|CHAPTER)\s+([IVXLCDM0-9]+)\s*[-–—.]?\s*([^\n\r]*)/gi;
    const sectionRegex = /(?:SECTION|SEC\.)\s*([0-9]+|[0-9]+[A-Za-z]?)\s*[-–—.]?\s*([^\n\r]*)/gi;

    const lines = text.split('\n');
    let currentArticle: LegalArticle | null = null;
    let currentSection: LegalArticleSection | null = null;
    let currentSectionContentLines: string[] = [];

    const flushSection = () => {
      if (currentSection && currentArticle) {
        currentSection.content = currentSectionContentLines.join('\n').trim();
        currentArticle.sections.push(currentSection);
        currentSection = null;
        currentSectionContentLines = [];
      }
    };

    const flushArticle = () => {
      flushSection();
      if (currentArticle) {
        articles.push(currentArticle);
        currentArticle = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (currentSection) currentSectionContentLines.push('');
        continue;
      }

      // Check if line is an Article Header
      const artMatch = line.match(/^(?:ARTICLE|CHAPTER)\s+([IVXLCDM0-9]+)\s*[-–—.]?\s*(.*)$/i);
      if (artMatch) {
        flushArticle();
        const artNum = `ARTICLE ${artMatch[1].toUpperCase()}`;
        const artTitle = artMatch[2]?.trim() || lines[i + 1]?.trim() || artNum;
        currentArticle = {
          id: 'art-' + (articles.length + 1),
          articleNumber: artNum,
          articleTitle: artTitle,
          sections: [],
        };
        continue;
      }

      // Check if line is a Section Header
      const secMatch = line.match(/^(?:SECTION|SEC\.)\s+([0-9]+[A-Za-z]?)\s*[-–—.]?\s*(.*)$/i);
      if (secMatch) {
        flushSection();
        if (!currentArticle) {
          currentArticle = {
            id: 'art-1',
            articleNumber: '',
            articleTitle: 'Sections without an article heading',
            sections: [],
          };
        }

        const secNumber = `Section ${secMatch[1]}`;
        const secTitle = secMatch[2]?.trim() || `Section ${secMatch[1]}`;
        
        // Find which page this text belongs to
        let pageRef = 1;
        if (pages && pages.length > 0) {
          const matchedPage = pages.find(p => p.text.includes(line) || p.text.includes(secNumber));
          if (matchedPage) pageRef = matchedPage.pageNumber;
        }

        currentSection = {
          id: `sec-${Date.now()}-${i}`,
          sectionNumber: secNumber,
          sectionTitle: secTitle,
          content: '',
          scannedPageRef: pageRef,
        };
        currentSectionContentLines = secMatch[2] ? [secMatch[2].trim()] : [];
        continue;
      }

      // If inside a section, accumulate text (including subsections a., b., 1., 2.)
      if (currentSection) {
        currentSectionContentLines.push(line);
      }
    }

    flushArticle();

    return articles;
  }

  private static extractReferencedLaws(text: string) {
    const matches = Array.from(text.matchAll(/(?:Republic Act|RA|Presidential Decree|PD|Ordinance|Resolution|Administrative Order)\s+(?:No\.?\s*)?[A-Z]?[-\d]+/gi));
    return [...new Set(matches.map(match => match[0]))].map(title => ({ title, existsInSystem: false }));
  }

  /**
   * Generate searchable tags
   */
  private static generateLegalTags(text: string, docTypeName: string, jurisdiction: string): string[] {
    const tags = new Set<string>();
    tags.add(docTypeName);
    if (jurisdiction) tags.add(jurisdiction);

    const keywords = [
      'ASF', 'African Swine Fever', 'Piggery', 'Poultry', 'Livestock', 'Biosecurity',
      'Municipal Permit', 'Backyard Piggery', 'Commercial Piggery', 'Locational Standards',
      'Environmental Compliance', 'Animal Health', 'Setbacks', 'Penalties', 'Task Force',
      'RSBSA', 'Ear Tagging', 'Vaccination', 'Quarantine'
    ];

    keywords.forEach(kw => {
      if (new RegExp(kw, 'i').test(text)) {
        tags.add(kw);
      }
    });

    return Array.from(tags);
  }

  /**
   * Check if a document already exists in the system
   */
  static checkDuplicate(detection: LegalImportDetectionResult) {
    const all = storageService.getAsfRegulations();
    const cleanNum = detection.officialNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanYr = detection.seriesYear.trim();

    const matched = all.find(doc => {
      const docNum = doc.officialNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
      const docYr = (doc.seriesYear || '').trim();
      return (
        (docNum === cleanNum && (docYr === cleanYr || !docYr || !cleanYr)) ||
        (doc.title.toLowerCase().includes(detection.title.toLowerCase().slice(0, 30)) && docNum === cleanNum)
      );
    });

    if (matched) {
      detection.isDuplicate = true;
      detection.duplicateDocId = matched.id;
      detection.duplicateDocTitle = matched.title;
      detection.duplicateAction = 'new_version';
    }
  }

  /**
   * Convert Detection Result into official ASFRegulatoryDocument
   */
  static convertDetectionToDocument(
    detection: LegalImportDetectionResult,
    fileItem?: LegalImportFileItem,
    importedBy = 'Admin'
  ): ASFRegulatoryDocument {
    const id =
      detection.duplicateDocId &&
      (detection.duplicateAction === 'new_version' || detection.duplicateAction === 'overwrite')
        ? detection.duplicateDocId
        : 'doc-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);

    const nowStr = new Date().toISOString();

    const doc: ASFRegulatoryDocument = {
      id,
      type: detection.docType,
      category: detection.category as LegalDocumentCategory,
      title: detection.title,
      officialNumber: detection.officialNumber,
      seriesYear: detection.seriesYear,
      jurisdiction: detection.jurisdiction,
      issuingAuthority: detection.issuingAuthority,
      author: detection.author,
      signatory: detection.signatory || '',
      signatoryTitle: detection.signatoryTitle || '',
      dateEnacted: detection.dateEnacted,
      effectiveDate: detection.effectiveDate || '',
      status: detection.status,
      shortSummary: detection.title.length > 150 ? detection.title.slice(0, 147) + '...' : detection.title,
      fullText: fileItem?.rawText || '',
      legalBasis: detection.legalBasis,
      tags: detection.tags,
      articles: detection.articles,
      keyArticles: detection.articles.flatMap(a =>
        a.sections.map(s => ({
          number: s.sectionNumber,
          heading: s.sectionTitle,
          text: s.content,
          mandateCategory: (s.mandateCategory === 'penal' ? 'prohibitive' : s.mandateCategory || 'mandatory') as 'mandatory' | 'prohibitive' | 'advisory',
        }))
      ),
      setbackRules: (detection.locationalRules || []).map(r => ({
        target: r.item,
        minimumDistance: r.distanceMeters,
        statutoryBasis: `${detection.docTypeName} No. ${detection.officialNumber}`,
        rationale: r.description,
      })),
      penalties: detection.penalties,
      sourceDocuments: [],
      importProvenance: fileItem ? {
        batchId: fileItem.batchId || fileItem.id,
        sourceFileName: fileItem.name,
        pages: (fileItem.pages || []).map(p => ({ pageNumber: p.pageNumber, text: p.text, confidence: p.confidence, ocrApplied: p.ocrApplied, warnings: p.warnings })),
        warnings: fileItem.warnings || [], uploadedAt: nowStr,
        method: 'native XML / PDF.js / Tesseract.js', reviewedBy: importedBy,
      } : undefined,
      versionHistory: [
        {
          version: 1,
          updatedAt: nowStr,
          updatedBy: importedBy,
          changeSummary: `Smart Imported from ${fileItem?.name || 'File'} with ${detection.totalSectionsCount} sections.`,
        }
      ],
      auditLogs: [
        {
          id: 'log-' + Date.now(),
          action: 'created',
          timestamp: nowStr,
          performedBy: importedBy,
          details: `Smart Import: ${detection.docTypeName} No. ${detection.officialNumber} (${detection.totalSectionsCount} sections detected)`,
        }
      ],
      isArchived: false,
    };

    return doc;
  }
}
