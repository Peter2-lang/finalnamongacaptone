import { LocalizedFeedback } from '../../i18n/LocalizedFeedback';
import { InterfaceText, translateInterfaceText } from '../../i18n/interfaceText';
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  Plus,
  Trash2,
  Image,
  Upload,
  Sparkles,
  Check,
  X,
  Sliders,
  Eye,
  SlidersHorizontal,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Layers,
  Printer,
  Download,
  Copy,
  PenTool,
  Building2,
  FileCheck,
  Save,
  RotateCcw,
  Search,
  Filter,
} from 'lucide-react';
import {
  CertificateDynamicSignatory,
  CertificateLogoItem,
  CertificateLogoPosition,
  CertificateLogoType,
  CertificateTemplate,
  CertificateTemplateField,
  CertificateWatermarkConfig,
} from '../../types';
import { printDocument } from '../../utils/printUtils';
import { downloadElementAsPdf } from '../../utils/pdfUtils';
import { HINUNANGAN_BARANGAYS } from '../../data/barangays';
import { DOCUMENT_TYPE_OPTIONS } from '../../data/certificateTemplates';
import { AVAILABLE_PLACEHOLDERS } from '../../utils/templateReplacer';
import { replaceTemplatePlaceholders } from '../../utils/templateReplacer';
import { DynamicCertificateView } from './DynamicCertificateView';
import { mediaApi, moduleDataApi } from '../../services/api';
import { filterCertificateTemplates } from '../../utils/certificateTemplateFilters';
import { useCertificateTemplateSync } from '../../hooks/useCertificateTemplateSync';
import { CERTIFICATE_FIELD_OPTIONS, extractCertificate } from '../../services/certificateImportService';
import type { CertificateFieldSuggestion } from '../../services/certificateImportService';

interface CertificateTemplateEditorProps {
  initialTemplate?: CertificateTemplate;
  onSave: (savedTemplate: CertificateTemplate) => Promise<CertificateTemplate>;
  onClose?: () => void;
  isModal?: boolean;
  userRole?: string;
  assignedBarangay?: string;
}

const createTemplateId = () =>
  `tpl-custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createBlankTemplate = (barangay = 'All'): CertificateTemplate => {
  const now = new Date().toISOString();
  return {
    id: createTemplateId(),
    name: 'New certificate template',
    barangay,
    documentType: 'Barangay Certification',
    documentTitle: 'BARANGAY CERTIFICATION',
    titleFont: 'serif_bold',
    bodyFontFamily: 'serif',
    bodyFontSizePt: 12,
    pageMarginMm: 14,
    paragraphSpacingPx: 16,
    language: 'english',
    pageSize: 'A4',
    orientation: 'portrait',
    header: {
      countryText: 'Republic of the Philippines',
      provinceText: 'PROVINCE OF SOUTHERN LEYTE',
      municipalityText: 'Municipality of Hinunangan',
      barangayText: barangay === 'All' ? '' : `BARANGAY ${barangay.toUpperCase()}`,
      borderStyle: 'single',
    },
    logos: [],
    watermark: {
      enabled: false,
      type: 'municipality',
      opacity: 0.12,
      position: 'center',
      size: 'large',
    },
    bodyTemplate: '',
    signatories: [],
    receipt: { showReceiptBox: false, formatStyle: 'standard' },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
};

const IMPORT_TEMPLATE_SIZE_LIMIT = 5 * 1024 * 1024;

type ImportedTemplateKind = 'json' | 'html' | 'docx' | 'pdf' | 'image' | 'unknown';

interface ImportedTemplateMetadata {
  kind: ImportedTemplateKind;
  title: string;
  description: string;
  documentType: string;
  barangay: string;
  bodyTemplate: string;
  warnings: string[];
  isReferenceOnly: boolean;
  fields: CertificateFieldSuggestion[];
  pageSize: CertificateTemplate['pageSize'];
  orientation: CertificateTemplate['orientation'];
  header?: Partial<CertificateTemplate['header']>;
  layoutHints?: {
    headings: string[];
    hasTables: boolean;
    hasImages: boolean;
    hasSignatureArea: boolean;
  };
  signatories: CertificateTemplate['signatories'];
}

const formatImportSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

const sanitizeImportedHtml = (rawHtml: string) => {
  const html = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\son\w+=['"][^'"]*['"]/gi, '')
    .replace(/javascript:/gi, '');

  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,svg,link,meta').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
        return;
      }
      if ((attr.name === 'href' || attr.name === 'src') && /javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc;
};

const parseImportedTemplateFile = async (
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ImportedTemplateMetadata> => {
  if (file.size > IMPORT_TEMPLATE_SIZE_LIMIT) {
    throw new Error(`The selected file exceeds the 5 MB size limit. Please choose a smaller template import.`);
  }

  const fileName = file.name || 'Imported template';
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.json')) {
    const parsed = JSON.parse(await file.text());
    const source = parsed.template ?? parsed;
    const bodyTemplate = typeof source.bodyTemplate === 'string'
      ? source.bodyTemplate
      : typeof source.template_body === 'string'
        ? source.template_body
        : typeof source.content === 'string'
          ? source.content
          : 'Imported template body';

    if (!bodyTemplate || !bodyTemplate.trim()) {
      throw new Error('The selected JSON file does not contain an editable template body.');
    }

    const title = typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : typeof source.documentTitle === 'string' && source.documentTitle.trim()
        ? source.documentTitle.trim()
        : fileName.replace(/\.[^.]+$/, '');

    return {
      kind: 'json',
      title,
      description: typeof source.description === 'string' ? source.description : 'Imported from JSON export.',
      documentType: typeof source.documentType === 'string' && source.documentType.trim() ? source.documentType : 'Barangay Certification',
      barangay: typeof source.barangay === 'string' && source.barangay.trim() ? source.barangay : 'All',
      bodyTemplate,
      warnings: [],
      isReferenceOnly: false,
      fields: [],
      pageSize: 'A4',
      orientation: 'portrait',
      signatories: [],
    };
  }

  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
    const rawHtml = await file.text();
    const doc = sanitizeImportedHtml(rawHtml);
    const heading = doc.querySelector('h1,h2,h3,h4')?.textContent?.trim() || fileName.replace(/\.[^.]+$/, '');
    const bodyText = doc.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!bodyText) {
      throw new Error('The selected HTML file did not contain usable template text.');
    }

    return {
      kind: 'html',
      title: heading,
      description: 'Imported HTML document converted to a draft certificate template.',
      documentType: 'Barangay Certification',
      barangay: 'All',
      bodyTemplate: bodyText,
      warnings: ['Scripts, event handlers, and unsafe URLs were removed for safety.'],
      isReferenceOnly: false,
      fields: [],
      pageSize: 'A4',
      orientation: 'portrait',
      signatories: [],
    };
  }

  if (lowerName.endsWith('.docx') || lowerName.endsWith('.pdf') || /\.(jpe?g|png)$/i.test(lowerName)) {
    const extracted = await extractCertificate(file, onProgress);
    return {
      kind: lowerName.endsWith('.pdf') ? 'pdf' : lowerName.endsWith('.docx') ? 'docx' : 'image',
      title: extracted.title,
      description: `Editable template imported from ${fileName}. Original source retained privately for administrator review.`,
      documentType: 'Barangay Certification',
      barangay: 'All',
      bodyTemplate: extracted.text,
      warnings: extracted.warnings,
      isReferenceOnly: false,
      fields: extracted.fields,
      pageSize: extracted.pageSize,
      orientation: extracted.orientation,
      header: extracted.header,
      layoutHints: extracted.layoutHints,
      signatories: extracted.signatories,
    };
  }

  throw new Error('Unsupported or mismatched import format. Use a valid PDF, DOCX, JPG/JPEG, PNG, JSON, or HTML template.');
};

export const CertificateTemplateEditor: React.FC<CertificateTemplateEditorProps> = ({
  initialTemplate,
  onSave,
  onClose,
  isModal = false,
  userRole,
  assignedBarangay = '',
}) => {
  // Load saved templates from the shared database for search and selection.
  const [availableTemplates, setAvailableTemplates] = useState<CertificateTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const templateLoadSequence = useRef(0);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);

  // Selected template state
  const isFocalPerson = userRole === 'focal';
  const canImportTemplates = userRole === 'admin' || userRole === 'super_admin';
  const defaultTpl = initialTemplate || createBlankTemplate(isFocalPerson ? assignedBarangay : 'All');
  const [template, setTemplate] = useState<CertificateTemplate>(() => JSON.parse(JSON.stringify(defaultTpl)));
  const [activeSection, setActiveSection] = useState<
    'info' | 'header_logos' | 'body' | 'signatories' | 'watermark' | 'receipt'
  >('header_logos');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [importedTemplate, setImportedTemplate] = useState<ImportedTemplateMetadata | null>(null);
  const [importedFile, setImportedFile] = useState<File | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importedTemplateName, setImportedTemplateName] = useState('');
  const [importedTemplateId, setImportedTemplateId] = useState('');
  const [importedTemplateDescription, setImportedTemplateDescription] = useState('');
  const [importedDocumentType, setImportedDocumentType] = useState('Barangay Certification');
  const [importedBarangay, setImportedBarangay] = useState('All');
  const [importedBody, setImportedBody] = useState('');
  const [importedFields, setImportedFields] = useState<CertificateFieldSuggestion[]>([]);
  const [pendingSourceFile, setPendingSourceFile] = useState<File | null>(null);
  const [uploadedImportSource, setUploadedImportSource] = useState<NonNullable<CertificateTemplate['sourceDocument']> | null>(null);
  const [importProgress, setImportProgress] = useState(0);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [isDraggingImport, setIsDraggingImport] = useState(false);
  const importSaveLock = useRef(false);
  const [customFieldLabel, setCustomFieldLabel] = useState('');
  const [templateCustomFieldLabel, setTemplateCustomFieldLabel] = useState('');

  const loadTemplates = useCallback(async () => {
    const sequence = ++templateLoadSequence.current;
    setIsLoadingTemplates(true);
    try {
      const loaded = await moduleDataApi.get<CertificateTemplate[]>('certificate_templates');
      if (sequence !== templateLoadSequence.current) return;
      setAvailableTemplates(loaded);
      setTemplate(current => {
        const saved = loaded.find(item => item.id === current.id);
        if (!saved) return current;
        const logos = (current.logos || []).map(logo => {
          const refreshed = (saved.logos || []).find(item => item.id === logo.id && item.storagePath === logo.storagePath);
          return refreshed?.storagePath ? { ...logo, customUrl: refreshed.customUrl } : logo;
        });
        const signatories = (current.signatories || []).map(signatory => {
          const refreshed = (saved.signatories || []).find(item =>
            item.id === signatory.id && item.signatureStoragePath === signatory.signatureStoragePath
          );
          return refreshed?.signatureStoragePath
            ? { ...signatory, signatureImageUrl: refreshed.signatureImageUrl }
            : signatory;
        });
        const watermark = current.watermark?.storagePath === saved.watermark?.storagePath && saved.watermark?.storagePath
          ? { ...current.watermark, customUrl: saved.watermark.customUrl }
          : current.watermark;
        return { ...current, logos, signatories, watermark };
      });
      setTemplateLoadError(null);
    } catch (error) {
      if (sequence === templateLoadSequence.current) {
        setTemplateLoadError(error instanceof Error ? error.message : 'Unable to load report templates from database.');
      }
    } finally {
      if (sequence === templateLoadSequence.current) setIsLoadingTemplates(false);
    }
  }, []);

  const templateSyncStatus = useCertificateTemplateSync(loadTemplates);

  // Search & Filters for Template Switcher
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarangayFilter, setSelectedBarangayFilter] = useState('all');
  const [selectedDocTypeFilter, setSelectedDocTypeFilter] = useState('all');
  const [selectedLanguageFilter, setSelectedLanguageFilter] = useState('all');

  // New Logo Form State
  const [isAddLogoModalOpen, setIsAddLogoModalOpen] = useState(false);
  const [newLogoType, setNewLogoType] = useState<CertificateLogoType>('barangay');
  const [newLogoPosition, setNewLogoPosition] = useState<CertificateLogoPosition>('left');
  const [newLogoBarangay, setNewLogoBarangay] = useState<string>(
    template.barangay === 'All' ? '' : template.barangay
  );
  const [newLogoSize, setNewLogoSize] = useState<number>(70);
  const [newLogoCustomUrl, setNewLogoCustomUrl] = useState<string>('');
  const [newLogoStoragePath, setNewLogoStoragePath] = useState<string | undefined>(undefined);

  const printRef = useRef<HTMLDivElement>(null);
  const importedSourcePreviewUrl = useMemo(
    () => importedFile ? URL.createObjectURL(importedFile) : null,
    [importedFile],
  );
  useEffect(() => () => {
    if (importedSourcePreviewUrl) URL.revokeObjectURL(importedSourcePreviewUrl);
  }, [importedSourcePreviewUrl]);
  useEffect(() => {
    if (!isImportDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isImportDialogOpen]);

  // Placeholder-only context prevents example data from being mistaken for an issued document.
  const sampleDataContext = {
    resident_name: '—',
    farmer_name: '—',
    barangay: template.barangay === 'All' ? '—' : template.barangay,
    municipality: 'Hinunangan',
    province: 'Southern Leyte',
    number_of_pigs: '—',
    heads: '—',
    buyer_name: '—',
    buyer_address: '—',
    destination: '—',
    purpose: '—',
    date_issued: '—',
    or_number: '—',
    price_per_kilo: '—',
    amount_paid: '—',
    animal_type: '—',
    association_name: '—',
    farmer_age_civil_status: '—',
    swine_age: '—',
    female_count: '—',
    male_count: '—',
    color_description: '—',
    issued_at: template.barangay === 'All' ? '—' : `Barangay ${template.barangay}, Hinunangan, Southern Leyte`,
  };

  // Filtered list of templates
  const filteredTemplates = useMemo(() => {
    return filterCertificateTemplates(availableTemplates, {
      search: searchQuery,
      barangay: selectedBarangayFilter === 'all' ? '' : selectedBarangayFilter,
      documentType: selectedDocTypeFilter === 'all' ? '' : selectedDocTypeFilter,
      language: selectedLanguageFilter === 'all' ? '' : selectedLanguageFilter,
    });
  }, [availableTemplates, searchQuery, selectedBarangayFilter, selectedDocTypeFilter, selectedLanguageFilter]);

  // Load a preset or chosen template
  const handleSelectTemplate = (targetTemplate: CertificateTemplate) => {
    setTemplate(JSON.parse(JSON.stringify(targetTemplate)));
    setSaveNotice(`Switched to template: "${targetTemplate.name}"`);
    setTimeout(() => setSaveNotice(null), 2500);
  };

  // Create a brand new template
  const handleCreateNewTemplate = () => {
    const createBarangay = isFocalPerson ? assignedBarangay : template.barangay || 'All';
    const newTpl: CertificateTemplate = {
      id: createTemplateId(),
      name: `Custom Certificate Format (${createBarangay || 'General'})`,
      barangay: createBarangay,
      documentType: 'Barangay Certification',
      documentTitle: 'BARANGAY CERTIFICATION',
      titleFont: 'serif_bold',
      bodyFontFamily: 'serif',
      bodyFontSizePt: 12,
      pageMarginMm: 14,
      paragraphSpacingPx: 16,
      language: 'english',
      pageSize: 'A4',
      orientation: 'portrait',
      header: {
        countryText: 'Republic of the Philippines',
        provinceText: 'PROVINCE OF SOUTHERN LEYTE',
        municipalityText: 'Municipality of Hinunangan',
        barangayText: `BARANGAY ${(createBarangay === 'All' ? '—' : createBarangay).toUpperCase()}`,
        officeTitle: 'OFFICE OF THE PUNONG BARANGAY',
        contactEmail: '',
        borderStyle: 'single',
      },
      logos: [
        {
          id: `logo-1-${Date.now()}`,
          type: 'barangay',
          position: 'left',
          barangayName: createBarangay === 'All' ? '' : createBarangay,
          widthPx: 70,
          heightPx: 70,
          order: 1,
          visible: true,
        },
        {
          id: `logo-2-${Date.now()}`,
          type: 'municipality',
          position: 'right',
          widthPx: 70,
          heightPx: 70,
          order: 2,
          visible: true,
        },
      ],
      watermark: {
        enabled: true,
        type: 'municipality',
        opacity: 0.12,
        position: 'center',
        size: 'large',
      },
      bodyTemplate: `TO WHOM IT MAY CONCERN:

THIS IS TO CERTIFY that {{resident_name}} is a bonafide resident of Barangay {{barangay}}, Hinunangan, Southern Leyte.

THIS CERTIFIES FURTHER that {{resident_name}} is the legal owner of {{number_of_pigs}} head(s) of swine sold to {{buyer_name}} of {{destination}}.

THIS CERTIFICATION is being issued upon request of the above-named party for legal transit and official documentation.

Issued this {{date_issued}} at Barangay {{barangay}}, Hinunangan, Southern Leyte, Philippines.`,
      signatories: [
        {
          id: `sig-1-${Date.now()}`,
          name: '',
          position: 'PUNONG BARANGAY',
          prefix: '',
          showSignatureImage: false,
          showSignatureLine: true,
          lineWidth: '220px',
          lineAlignment: 'center',
          order: 1,
          alignment: 'center',
        },
        {
          id: `sig-2-${Date.now()}`,
          name: '',
          position: 'BARANGAY BIOSECURITY OFFICER',
          prefix: '',
          showSignatureImage: false,
          showSignatureLine: true,
          lineWidth: '220px',
          lineAlignment: 'center',
          order: 2,
          alignment: 'center',
        },
      ],
      receipt: {
        showReceiptBox: true,
        formatStyle: 'nava',
        orNumber: '',
        amountPaid: '',
      },
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setTemplate(newTpl);
    setSaveNotice('New template draft opened. Save Template to store it in the database.');
  };

  const openImportTemplateDialog = () => {
    setImportError(null);
    setImportedTemplate(null);
    setImportedFile(null);
    setImportedTemplateId('');
    setImportedTemplateName('');
    setImportedTemplateDescription('');
    setImportedDocumentType(template.documentType || 'Barangay Certification');
    setImportedBarangay(template.barangay || 'All');
    setImportedBody('');
    setImportedFields([]);
    setPendingSourceFile(null);
    setUploadedImportSource(null);
    setImportProgress(0);
    setCustomFieldLabel('');
    setIsImportDialogOpen(true);
  };

  const processImportTemplateFile = async (file: File) => {
    setImportedTemplate(null);
    setImportedFile(null);
    setImportedBody('');
    setImportedFields([]);
    setPendingSourceFile(null);
    setUploadedImportSource(null);
    setImportError(null);
    if (!file) return;

    setIsImportingFile(true);
    try {
      setImportProgress(0);
      const parsed = await parseImportedTemplateFile(file, setImportProgress);
      setImportedFile(file);
      setImportedTemplateId(createTemplateId());
      setImportedTemplate(parsed);
      setImportedBody(parsed.bodyTemplate);
      setImportedFields(parsed.fields);
      setPendingSourceFile(/\.(pdf|docx|jpe?g|png)$/i.test(file.name) ? file : null);
      setImportError(null);
      setImportedTemplateName(parsed.title || file.name.replace(/\.[^.]+$/, ''));
      setImportedTemplateDescription(parsed.description || 'Imported certificate template');
      setImportedDocumentType(parsed.documentType || 'Barangay Certification');
      setImportedBarangay(parsed.barangay || 'All');
    } catch (error) {
      setImportedTemplate(null);
      setImportedFile(null);
      setImportedBody('');
      setImportedFields([]);
      setPendingSourceFile(null);
      setImportError(error instanceof Error ? error.message : 'Unable to import template.');
    } finally {
      setIsImportingFile(false);
    }
  };

  const handleImportTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processImportTemplateFile(file);
    e.target.value = '';
  };

  const addImportedCustomField = () => {
    const label = customFieldLabel.trim();
    if (!label) return;
    const baseKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom_field';
    let key = baseKey;
    let suffix = 2;
    while (importedFields.some(field => field.key === key)) key = `${baseKey}_${suffix++}`;
    setImportedFields(previous => [...previous, { key, label, confidence: 'review', required: false }]);
    setImportedBody(previous => `${previous}${previous.endsWith('\n') || !previous ? '' : '\n'}{{${key}}}`);
    setCustomFieldLabel('');
  };

  const buildImportedCertificateTemplate = (
    sourceDocument = uploadedImportSource || undefined,
    requireEditableBody = true,
  ): CertificateTemplate => {
    if (!importedTemplate || !importedFile) {
      throw new Error('Upload and review a certificate file before saving.');
    }
    if (!importedTemplateName.trim()) {
      throw new Error('Enter a template name before saving.');
    }
    if (!DOCUMENT_TYPE_OPTIONS.some(option => option === importedDocumentType)) {
      throw new Error('Select a valid certificate document type.');
    }
    if (importedBarangay !== 'All' && !HINUNANGAN_BARANGAYS.some(barangay => barangay.name === importedBarangay)) {
      throw new Error('Select a valid barangay scope.');
    }
    if (requireEditableBody && !importedBody.trim()) {
      throw new Error('No editable wording was detected. Enter the certificate wording before saving this template.');
    }
    const templateFields: CertificateTemplateField[] = importedFields.map(field => ({
      key: field.key,
      label: field.label,
      required: field.required,
      defaultValue: field.defaultValue,
    }));
    const now = new Date().toISOString();
    return {
      ...createBlankTemplate(isFocalPerson ? assignedBarangay : importedBarangay),
      id: importedTemplateId || createTemplateId(),
      name: importedTemplateName.trim(),
      description: importedTemplateDescription.trim() || importedTemplate.description,
      documentType: importedDocumentType,
      barangay: importedBarangay,
      documentTitle: importedTemplate.title,
      bodyTemplate: importedBody,
      templateFields,
      pageSize: importedTemplate.pageSize,
      orientation: importedTemplate.orientation,
      header: { ...createBlankTemplate(importedBarangay).header, ...importedTemplate.header },
      logos: [],
      signatories: importedTemplate.signatories,
      watermark: { enabled: false, type: 'municipality', opacity: 0.12, position: 'center', size: 'large' },
      receipt: { showReceiptBox: false, formatStyle: 'standard' },
      reviewStatus: 'draft',
      isActive: false,
      sourceDocument,
      templateVersions: [],
      createdAt: now,
      updatedAt: now,
    };
  };

  const applyImportedTemplate = () => {
    try {
      const nextTemplate = buildImportedCertificateTemplate(undefined, false);
      setImportedTemplateId(nextTemplate.id);
      setTemplate(nextTemplate);
      setSaveNotice(`Imported template "${nextTemplate.name}" loaded as a draft. Save it from the editor when ready.`);
      setIsImportDialogOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to prepare the imported template.');
    }
  };

  const handleImportBack = () => {
    if (importedTemplate) {
      applyImportedTemplate();
      return;
    }
    setIsImportDialogOpen(false);
  };

  const handleSaveImportedTemplate = async () => {
    if (importSaveLock.current) return;
    importSaveLock.current = true;
    setImportError(null);
    setIsSaving(true);
    try {
      const validation = buildImportedCertificateTemplate();
      let sourceDocument = uploadedImportSource || undefined;
      if (pendingSourceFile && !sourceDocument) {
        const uploaded = await mediaApi.uploadCertificateTemplateSource(pendingSourceFile);
        sourceDocument = {
          fileName: pendingSourceFile.name,
          mimeType: pendingSourceFile.type,
          storagePath: uploaded.filePath,
          fileSize: uploaded.fileSize,
          uploadedAt: new Date().toISOString(),
        };
        setUploadedImportSource(sourceDocument);
        setPendingSourceFile(null);
      }

      const nextTemplate = {
        ...validation,
        sourceDocument,
      };
      setImportedTemplateId(nextTemplate.id);
      setTemplate(nextTemplate);
      const persisted = await onSave(nextTemplate);
      setAvailableTemplates(previous => [persisted, ...previous.filter(item => item.id !== persisted.id)]);
      setTemplate(JSON.parse(JSON.stringify(persisted)));
      setIsImportDialogOpen(false);
      setSaveNotice(`Template "${persisted.name}" saved successfully.`);
      setTimeout(() => setSaveNotice(null), 3000);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to save the imported template.');
    } finally {
      setIsSaving(false);
      importSaveLock.current = false;
    }
  };

  const requestCloseImportDialog = () => {
    if ((importedFile || importedTemplateName.trim() || importedBody.trim()) &&
        !window.confirm('Discard this unsaved certificate import?')) {
      return;
    }
    setIsImportDialogOpen(false);
  };

  // ==========================================
  // 1. LOGOS HANDLERS
  // ==========================================
  const handleOpenAddLogo = () => {
    setNewLogoType('barangay');
    setNewLogoPosition('left');
    setNewLogoBarangay(template.barangay === 'All' ? 'NAVA' : template.barangay);
    setNewLogoSize(70);
    setNewLogoCustomUrl('');
    setNewLogoStoragePath(undefined);
    setIsAddLogoModalOpen(true);
  };

  const handleSaveNewLogo = () => {
    const newLogo: CertificateLogoItem = {
      id: `logo-${Date.now()}`,
      type: newLogoType,
      position: newLogoPosition,
      barangayName: newLogoType === 'barangay' ? newLogoBarangay : undefined,
      customUrl: newLogoType === 'custom' ? newLogoCustomUrl : undefined,
      storagePath: newLogoType === 'custom' ? newLogoStoragePath : undefined,
      widthPx: newLogoSize,
      heightPx: newLogoSize,
      order: (template.logos?.length || 0) + 1,
      visible: true,
    };

    setTemplate(prev => ({
      ...prev,
      logos: [...(prev.logos || []), newLogo],
    }));
    setIsAddLogoModalOpen(false);
  };

  const handleUpdateLogo = (id: string, updates: Partial<CertificateLogoItem>) => {
    setTemplate(prev => ({
      ...prev,
      logos: (prev.logos || []).map(l => (l.id === id ? { ...l, ...updates } : l)),
    }));
  };

  const handleRemoveLogo = (id: string) => {
    setTemplate(prev => ({
      ...prev,
      logos: (prev.logos || []).filter(l => l.id !== id),
    }));
  };

  const handleMoveLogo = (index: number, direction: 'up' | 'down') => {
    const list = [...(template.logos || [])];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;
    list.forEach((item, idx) => {
      item.order = idx + 1;
    });
    setTemplate(prev => ({ ...prev, logos: list }));
  };

  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, logoId?: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingAsset(true);
      const asset = await mediaApi.uploadCertificateAsset(file);
      const url = asset.fileUrl;
      if (logoId) {
        handleUpdateLogo(logoId, { type: 'custom', customUrl: url, storagePath: asset.filePath });
      } else {
        setNewLogoCustomUrl(url);
        setNewLogoStoragePath(asset.filePath);
        setNewLogoType('custom');
      }
      setSaveNotice(null);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : 'Unable to upload certificate logo.');
    } finally {
      setIsUploadingAsset(false);
    }
  };

  // ==========================================
  // 2. SIGNATORIES HANDLERS
  // ==========================================
  const handleAddSignatory = () => {
    const newCount = (template.signatories?.length || 0) + 1;
    const newSignatory: CertificateDynamicSignatory = {
      id: `sig-${Date.now()}`,
      name: 'HON. OFFICIAL NAME',
      position: 'OFFICIAL POSITION / DESIGNATION',
      prefix: '',
      showSignatureImage: false,
      showSignatureLine: true,
      lineWidth: '220px',
      lineAlignment: 'center',
      signatureWidth: '130px',
      signaturePosition: 'above_line',
      order: newCount,
      alignment: 'center',
    };
    setTemplate(prev => ({
      ...prev,
      signatories: [...(prev.signatories || []), newSignatory],
    }));
  };

  const handleUpdateSignatory = (id: string, updates: Partial<CertificateDynamicSignatory>) => {
    setTemplate(prev => ({
      ...prev,
      signatories: (prev.signatories || []).map(s => (s.id === id ? { ...s, ...updates } : s)),
    }));
  };

  const handleRemoveSignatory = (id: string) => {
    setTemplate(prev => ({
      ...prev,
      signatories: (prev.signatories || []).filter(s => s.id !== id),
    }));
  };

  const handleMoveSignatory = (index: number, direction: 'up' | 'down') => {
    const list = [...(template.signatories || [])];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const temp = list[index];
    list[index] = list[targetIndex];
    list[targetIndex] = temp;
    list.forEach((item, idx) => {
      item.order = idx + 1;
    });
    setTemplate(prev => ({ ...prev, signatories: list }));
  };

  // ==========================================
  // 3. WATERMARK HANDLER
  // ==========================================
  const handleWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsUploadingAsset(true);
      const asset = await mediaApi.uploadCertificateAsset(file);
      setTemplate(prev => ({
        ...prev,
        watermark: {
          ...prev.watermark,
          type: 'custom',
          customUrl: asset.fileUrl,
          storagePath: asset.filePath,
          enabled: true,
        },
      }));
      setSaveNotice(null);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : 'Unable to upload certificate watermark.');
    } finally {
      setIsUploadingAsset(false);
    }
  };

  // Insert placeholder into body textarea
  const handleInsertPlaceholder = (placeholderKey: string) => {
    setTemplate(prev => ({
      ...prev,
      bodyTemplate: `${prev.bodyTemplate} ${placeholderKey}`,
    }));
  };

  const addTemplateCustomField = () => {
    const label = templateCustomFieldLabel.trim();
    if (!label) return;
    const baseKey = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom_field';
    const fields = template.templateFields || [];
    let key = baseKey;
    let suffix = 2;
    while (fields.some(field => field.key === key)) key = `${baseKey}_${suffix++}`;
    setTemplate({
      ...template,
      templateFields: [...fields, { key, label, required: false }],
      bodyTemplate: `${template.bodyTemplate}${template.bodyTemplate.endsWith('\n') || !template.bodyTemplate ? '' : '\n'}{{${key}}}`,
    });
    setTemplateCustomFieldLabel('');
  };

  // Save template
  const handleSave = async () => {
    if (isSaving) return;
    if (!template.name.trim()) {
      setSaveNotice('Enter a template name before saving.');
      return;
    }
    if (!template.documentType.trim()) {
      setSaveNotice('Select a certificate type before saving.');
      return;
    }
    if (!template.bodyTemplate.trim()) {
      setSaveNotice('Enter a certificate body before saving.');
      return;
    }
    setIsSaving(true);
    let updated = { ...template };
    try {
      if (pendingSourceFile && !updated.sourceDocument?.storagePath) {
        const source = await mediaApi.uploadCertificateTemplateSource(pendingSourceFile);
        updated = {
          ...updated,
          sourceDocument: {
            fileName: pendingSourceFile.name,
            mimeType: pendingSourceFile.type,
            storagePath: source.filePath,
            fileSize: source.fileSize,
            uploadedAt: new Date().toISOString(),
          },
        };
        setTemplate(updated);
      }
      const confirmedTemplate = await onSave(updated);
      templateLoadSequence.current++;
      setTemplate(JSON.parse(JSON.stringify(confirmedTemplate)));
      setAvailableTemplates(previous => [confirmedTemplate, ...previous.filter(item => item.id !== confirmedTemplate.id)]);
      setPendingSourceFile(null);
      setSaveNotice('Template saved successfully.');
      setTimeout(() => setSaveNotice(null), 3000);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : 'Unable to save template to the database.');
    } finally {
      setIsSaving(false);
    }
  };

  // Print document
  const handlePrint = () => {
    try {
      printDocument('certificate-template-preview');
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : 'Unable to open the browser print dialog.');
    }
  };

  const handleDownloadPdf = async () => {
    if (!printRef.current || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const safeName = template.name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'certificate-template';
      const format = template.pageSize === 'Folio'
        ? [215.9, 330.2] as [number, number]
        : template.pageSize === 'Letter' ? 'letter' : 'a4';
      await downloadElementAsPdf(printRef.current, `${safeName}.pdf`, {
        format,
        orientation: template.orientation,
        marginMm: 0,
      });
      setSaveNotice(`${template.pageSize} PDF downloaded.`);
      setTimeout(() => setSaveNotice(null), 3000);
    } catch (error) {
      setSaveNotice(error instanceof Error ? error.message : 'Unable to download the A4 PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDuplicateTemplate = () => {
    const now = new Date().toISOString();
    const duplicate: CertificateTemplate = {
      ...JSON.parse(JSON.stringify(template)) as CertificateTemplate,
      id: createTemplateId(),
      name: `${template.name.trim() || 'Certificate template'} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };
    setTemplate(duplicate);
    setSaveNotice('Duplicate draft created. Save Template to persist it.');
  };

  return (
    <div className="bg-white text-slate-900 rounded-2xl shadow-xl border border-stone-200 overflow-hidden">
      {/* Toast Notification */}
      {saveNotice && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-emerald-500/50 animate-in fade-in slide-in-from-top-2 duration-200">
          <Check className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{saveNotice}</span>
        </div>
      )}

      {/* Header Bar */}
      <div className="bg-slate-900 text-white px-6 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-white">Certificate Template & Layout Customizer</h2>
            <p className="text-xs text-slate-400">
              Configure dynamic seals, horizontal signature lines, body paragraphs, and watermark per Barangay
            </p>
          </div>
        </div>

        {/* Action buttons (Clean standard buttons) */}
        <div className="flex items-center gap-2">
          <span role="status" className="hidden text-[10px] text-slate-300 sm:inline">
            {templateSyncStatus === 'live'
              ? 'Live sync active'
              : templateSyncStatus === 'reconnecting'
                ? 'Reconnecting · auto-refetch active'
                : 'Auto-refetch active'}
          </span>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isUploadingAsset}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition cursor-pointer disabled:cursor-wait disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            <span>{isUploadingAsset ? 'Uploading source…' : isSaving ? translateInterfaceText("Saving…") : template.reviewStatus === 'draft' ? 'Save Draft' : 'Save Template'}</span>
          </button>

          <button
            type="button"
            onClick={handleDuplicateTemplate}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
          >
            <Copy className="w-4 h-4" />
            <span>Duplicate Template</span>
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadPdf()}
            disabled={isExportingPdf}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            <span>{isExportingPdf ? 'Preparing PDF…' : 'Download A4 PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
          >
            <Printer className="w-4 h-4 text-amber-400" />
            <span>Print Preview</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition cursor-pointer"
              title="Close Editor"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* FORMAT TEMPLATES SEARCH & FILTER BAR */}
      <div className="bg-slate-800 text-slate-200 px-6 py-3 border-b border-slate-700 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search templates by name, barangay, type, language..."
              className="w-full pl-9 pr-8 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-semibold text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Barangay Filter */}
            <select
              value={selectedBarangayFilter}
              onChange={e => setSelectedBarangayFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">{translateInterfaceText("All Barangays")}</option>
              {HINUNANGAN_BARANGAYS.map(b => (
                <option key={b.code} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>

            {/* Document Type Filter */}
            <select
              value={selectedDocTypeFilter}
              onChange={e => setSelectedDocTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">All Document Types</option>
              {DOCUMENT_TYPE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>

            {/* Language Filter */}
            <select
              value={selectedLanguageFilter}
              onChange={e => setSelectedLanguageFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              <option value="all">All Languages</option>
              <option value="english">English</option>
              <option value="bisaya">Bisaya Dialect</option>
              <option value="filipino">Filipino</option>
            </select>

            {(searchQuery || selectedBarangayFilter !== 'all' || selectedDocTypeFilter !== 'all' || selectedLanguageFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedBarangayFilter('all');
                  setSelectedDocTypeFilter('all');
                  setSelectedLanguageFilter('all');
                }}
                className="px-3 py-2 text-xs font-bold text-slate-200 hover:text-white"
              >
                Clear filters
              </button>
            )}

            {canImportTemplates && (
              <button
                type="button"
                onClick={openImportTemplateDialog}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import Certificate</span>
              </button>
            )}

            {/* Create New Template Button */}
            <button
              type="button"
              onClick={handleCreateNewTemplate}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ New Template</span>
            </button>
          </div>
        </div>

        {/* Template Quick Selection Chips */}
        {isLoadingTemplates && (
          <p role="status" className="pt-1 text-xs text-slate-300">Loading saved templates…</p>
        )}
        {!isLoadingTemplates && templateLoadError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 pt-1 text-xs text-rose-200">
            <span>Saved templates could not be loaded: {<LocalizedFeedback value={templateLoadError} />}</span>
            <button
              type="button"
              onClick={() => void loadTemplates()}
              className="min-h-10 rounded-lg border border-rose-300/60 px-3 font-bold hover:bg-rose-900/40"
            ><InterfaceText source="Retry" /></button>
          </div>
        )}
        {!isLoadingTemplates && !templateLoadError && availableTemplates.length === 0 && (
          <p role="status" className="pt-1 text-xs text-amber-200">
            No saved templates are available yet. Save this draft to create the first template.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 overflow-x-auto">
          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider shrink-0 mr-1">
            TEMPLATES ({filteredTemplates.length}):
          </span>
          {filteredTemplates.map(tpl => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => handleSelectTemplate(tpl)}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition cursor-pointer border shrink-0 ${
                template.id === tpl.id
                  ? 'bg-blue-600 text-white border-blue-500 shadow-xs'
                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
              }`}
            >
              <span>{tpl.name}</span>
            </button>
          ))}
          {availableTemplates.length > 0 && filteredTemplates.length === 0 && (
            <span className="text-xs text-slate-400 italic">No templates matching &ldquo;{searchQuery}&rdquo;</span>
          )}
        </div>
      </div>

      {/* Main 2-Column Workspace (Left: Sections, Right: Live Certificate Preview) */}
      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 bg-slate-100/70">
        {/* ========================================================================= */}
        {/* LEFT COLUMN: CUSTOMIZE TEMPLATE SECTIONS */}
        {/* ========================================================================= */}
        <div className="lg:col-span-6 space-y-4">
          {/* Section Navigation Tabs */}
          <div className="bg-white p-1.5 rounded-xl border border-stone-200 shadow-2xs flex flex-wrap gap-1">
            {[
              { id: 'info', label: '1. Document Info', icon: FileText },
              { id: 'header_logos', label: '2. Header & Logos', icon: Image },
              { id: 'body', label: '3. Certificate Body', icon: PenTool },
              { id: 'signatories', label: '4. Official Signatories', icon: FileCheck },
              { id: 'watermark', label: '5. Watermark', icon: Layers },
              { id: 'receipt', label: '6. Receipt & Notes', icon: Sliders },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSection(tab.id as any)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-stone-700 hover:bg-stone-100 hover:text-stone-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* CARD 1: DOCUMENT INFO */}
          {activeSection === 'info' && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-xs p-5 space-y-4 animate-in fade-in duration-150">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="text-sm font-black text-slate-900">1. Document Information</h3>
                <p className="text-xs text-stone-500">Configure template identity, barangay scope, and typography</p>
              </div>

              {template.reviewStatus === 'draft' && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                  Imported template draft — verify wording, field mappings, signatories, and layout before enabling it for issuance.
                </div>
              )}
              {!isFocalPerson && (
                <label className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs font-bold text-slate-800">
                  <input
                    type="checkbox"
                    checked={template.isActive && template.reviewStatus !== 'draft'}
                    onChange={event => setTemplate({
                      ...template,
                      isActive: event.target.checked,
                      reviewStatus: event.target.checked ? 'approved' : 'draft',
                    })}
                  />
                  Approved for certificate issuance
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Template Name</label>
                  <input
                    type="text"
                    value={template.name}
                    onChange={e => setTemplate({ ...template, name: e.target.value })}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1"><InterfaceText source="Barangay Scope" /></label>
                  <select
                    value={template.barangay}
                    disabled={isFocalPerson}
                    onChange={e => setTemplate({ ...template, barangay: e.target.value })}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {!isFocalPerson && <option value="All">All Barangays (Universal)</option>}
                    {isFocalPerson
                      ? <option value={assignedBarangay}>{assignedBarangay}</option>
                      : HINUNANGAN_BARANGAYS.map(b => (
                        <option key={b.code} value={b.name}>{b.name}</option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Document Type</label>
                  <select
                    value={template.documentType}
                    onChange={e => setTemplate({ ...template, documentType: e.target.value })}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {DOCUMENT_TYPE_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Language / Dialect</label>
                  <select
                    value={template.language}
                    onChange={e => setTemplate({ ...template, language: e.target.value as any })}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="english">English</option>
                    <option value="bisaya">Cebuano / Bisaya Dialect</option>
                    <option value="filipino">Filipino (Tagalog)</option>
                    <option value="custom">Custom Dialect</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Document Heading Title</label>
                  <input
                    type="text"
                    value={template.documentTitle}
                    onChange={e => setTemplate({ ...template, documentTitle: e.target.value })}
                    placeholder="e.g. BARANGAY CERTIFICATION"
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Title Font Style</label>
                  <select
                    value={template.titleFont}
                    onChange={e => setTemplate({ ...template, titleFont: e.target.value as any })}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="gothic">Gothic / Blackletter Calligraphy (Nava Style)</option>
                    <option value="serif_underline">Serif Bold with Underline (Nueva Esperanza)</option>
                    <option value="serif_bold">Serif Bold with Border Box (Tuburan Style)</option>
                    <option value="sans_bold">Modern Sans-Serif Bold</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Body Font Family</label>
                  <select
                    value={template.bodyFontFamily || 'serif'}
                    onChange={e =>
                      setTemplate({
                        ...template,
                        bodyFontFamily: e.target.value as CertificateTemplate['bodyFontFamily'],
                      })
                    }
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="serif">Serif</option>
                    <option value="sans-serif">Sans-serif</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Arial">Arial</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">
                    Body Font Size ({template.bodyFontSizePt || 12} pt)
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="16"
                    step="1"
                    value={template.bodyFontSizePt || 12}
                    onChange={e => setTemplate({ ...template, bodyFontSizePt: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">
                    Page Margins ({template.pageMarginMm ?? 14} mm)
                  </label>
                  <input
                    type="range"
                    min="8"
                    max="25"
                    step="1"
                    value={template.pageMarginMm ?? 14}
                    onChange={e => setTemplate({ ...template, pageMarginMm: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">
                    Paragraph Spacing ({template.paragraphSpacingPx ?? 16} px)
                  </label>
                  <input
                    type="range"
                    min="4"
                    max="28"
                    step="2"
                    value={template.paragraphSpacingPx ?? 16}
                    onChange={e => setTemplate({ ...template, paragraphSpacingPx: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Page Paper Size</label>
                  <select
                    value={template.pageSize}
                    onChange={e => setTemplate({ ...template, pageSize: e.target.value as any })}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Folio">Folio / Long Bond (8.5 x 13 in)</option>
                    <option value="A4">A4 (8.27 x 11.69 in)</option>
                    <option value="Letter">Letter / Short (8.5 x 11 in)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Header Divider Line</label>
                  <select
                    value={template.header.borderStyle || 'single'}
                    onChange={e =>
                      setTemplate({
                        ...template,
                        header: { ...template.header, borderStyle: e.target.value as any },
                      })
                    }
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="single">Standard Single Line</option>
                    <option value="double">Double Border Line</option>
                    <option value="green_line">Green Accent Line (Tuburan)</option>
                    <option value="none">No Line</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* CARD 2: HEADER & LOGOS */}
          {activeSection === 'header_logos' && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-xs p-5 space-y-5 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">2. Header & Logos</h3>
                  <p className="text-xs text-stone-500">
                    Add, remove, change, and assign official logos to LEFT, CENTER, or RIGHT positions
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleOpenAddLogo}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ Add Logo</span>
                </button>
              </div>

              {/* Header Text Settings */}
              <div className="bg-slate-50 p-4 rounded-xl border border-stone-200 space-y-3">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                  OFFICIAL HEADER DETAILS:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-0.5">Barangay Name in Header</label>
                    <input
                      type="text"
                      value={template.header.barangayText}
                      onChange={e =>
                        setTemplate({
                          ...template,
                          header: { ...template.header, barangayText: e.target.value },
                        })
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-0.5">Office Title / Subheading</label>
                    <input
                      type="text"
                      value={template.header.officeTitle || ''}
                      onChange={e =>
                        setTemplate({
                          ...template,
                          header: { ...template.header, officeTitle: e.target.value },
                        })
                      }
                      placeholder="e.g. OFFICE OF THE PUNONG BARANGAY"
                      className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-0.5">Official Email</label>
                    <input
                      type="text"
                      value={template.header.contactEmail || ''}
                      onChange={e =>
                        setTemplate({
                          ...template,
                          header: { ...template.header, contactEmail: e.target.value },
                        })
                      }
                      placeholder="e.g. brgy.nava@hinunangan.gov.ph"
                      className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-stone-700 mb-0.5">Official Contact / Hotline</label>
                    <input
                      type="text"
                      value={template.header.contactPhone || ''}
                      onChange={e =>
                        setTemplate({
                          ...template,
                          header: { ...template.header, contactPhone: e.target.value },
                        })
                      }
                      placeholder="e.g. 09763070221"
                      className="w-full px-2.5 py-1.5 bg-white border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic Logos Array */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">
                    CONFIGURED LOGOS ({template.logos?.length || 0})
                  </span>
                  <span className="text-[11px] text-stone-500">Live preview updates immediately</span>
                </div>

                {(template.logos || []).length === 0 ? (
                  <div className="text-center py-6 border-2 border-dashed border-stone-200 rounded-xl bg-stone-50">
                    <Image className="w-8 h-8 text-stone-300 mx-auto mb-1" />
                    <p className="text-xs font-bold text-stone-600">No logos added</p>
                    <p className="text-[11px] text-stone-400">Click &ldquo;+ Add Logo&rdquo; above to attach official seals</p>
                  </div>
                ) : (
                  (template.logos || []).map((logo, index) => (
                    <div
                      key={logo.id}
                      className="bg-white p-3.5 rounded-xl border border-stone-200 shadow-2xs space-y-3 relative"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-md bg-slate-900 text-white font-black text-[11px] flex items-center justify-center">
                            #{index + 1}
                          </span>
                          <span className="text-xs font-black text-slate-800 uppercase">
                            {logo.type === 'barangay'
                              ? `Barangay Seal (${logo.barangayName || template.barangay})`
                              : logo.type === 'municipality'
                              ? translateInterfaceText("Municipality of Hinunangan Seal")
                              : logo.type === 'da'
                              ? translateInterfaceText("Department of Agriculture (DA) Seal")
                              : logo.type === 'bagong_pilipinas'
                              ? 'Bagong Pilipinas Official Logo'
                              : logo.type === 'province'
                              ? translateInterfaceText("Province of Southern Leyte Seal")
                              : 'Custom Uploaded Logo'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleMoveLogo(index, 'up')}
                            disabled={index === 0}
                            className="p-1 rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30 cursor-pointer"
                            title={translateInterfaceText("Move Up")}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveLogo(index, 'down')}
                            disabled={index === (template.logos?.length || 0) - 1}
                            className="p-1 rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30 cursor-pointer"
                            title={translateInterfaceText("Move Down")}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveLogo(logo.id)}
                            className="p-1 rounded text-rose-500 hover:bg-rose-50 cursor-pointer"
                            title="Remove Logo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {/* Position Selector (LEFT, CENTER, RIGHT) */}
                        <div>
                          <label className="block text-[11px] font-bold text-stone-700 mb-1"><InterfaceText source="Position:" /><span className="text-blue-600 uppercase font-black">{logo.position}</span>
                          </label>
                          <select
                            value={logo.position}
                            onChange={e =>
                              handleUpdateLogo(logo.id, {
                                position: e.target.value as CertificateLogoPosition,
                              })
                            }
                            className="w-full px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs font-bold text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                          >
                            <option value="left">LEFT</option>
                            <option value="center">CENTER</option>
                            <option value="right">RIGHT</option>
                          </select>
                        </div>

                        {/* Seal Type / Change Logo */}
                        <div>
                          <label className="block text-[11px] font-bold text-stone-700 mb-1"><InterfaceText source="Seal Type" /></label>
                          <select
                            value={logo.type}
                            onChange={e =>
                              handleUpdateLogo(logo.id, {
                                type: e.target.value as CertificateLogoType,
                              })
                            }
                            className="w-full px-2.5 py-1.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                          >
                            <option value="barangay">{translateInterfaceText("Barangay Official Seal")}</option>
                            <option value="municipality">{translateInterfaceText("Municipality of Hinunangan")}</option>
                            <option value="province">{translateInterfaceText("Province of Southern Leyte")}</option>
                            <option value="da">{translateInterfaceText("Department of Agriculture (DA)")}</option>
                            <option value="bagong_pilipinas">Bagong Pilipinas</option>
                            <option value="custom">Custom Uploaded File</option>
                          </select>
                        </div>

                        {/* Dimensions */}
                        <div>
                          <label className="block text-[11px] font-bold text-stone-700 mb-1">
                            Size ({logo.widthPx}px)
                          </label>
                          <input
                            type="range"
                            min="45"
                            max="110"
                            value={logo.widthPx}
                            onChange={e =>
                              handleUpdateLogo(logo.id, {
                                widthPx: Number(e.target.value),
                                heightPx: Number(e.target.value),
                              })
                            }
                            className="w-full accent-blue-600 cursor-pointer"
                          />
                        </div>
                      </div>

                      {/* If Barangay Seal, select which barangay */}
                      {logo.type === 'barangay' && (
                        <div>
                          <label className="block text-[11px] font-bold text-stone-700 mb-1">
                            Select Barangay (Hinunangan 1-40)
                          </label>
                          <select
                            value={logo.barangayName || template.barangay}
                            onChange={e => handleUpdateLogo(logo.id, { barangayName: e.target.value })}
                            className="w-full px-2.5 py-1.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                          >
                            {HINUNANGAN_BARANGAYS.map(b => (
                              <option key={b.code} value={b.name}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Change Logo Upload / Replace */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-stone-100">
                        <label className="px-3 py-1 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer border border-stone-300">
                          <Upload className="w-3.5 h-3.5" />
                          <span>Change Logo (Upload Image)</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={e => handleLogoFileUpload(e, logo.id)}
                            className="hidden"
                          />
                        </label>
                        {logo.customUrl && (
                          <span className="text-[11px] text-emerald-600 font-bold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Custom Image Attached
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* CARD 3: CERTIFICATE BODY */}
          {activeSection === 'body' && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-xs p-5 space-y-4 animate-in fade-in duration-150">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="text-sm font-black text-slate-900">3. Certificate Body</h3>
                <p className="text-xs text-stone-500">
                  Write the official body text in English, Bisaya, or Filipino with dynamic placeholders
                </p>
              </div>

              <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black text-slate-800">Template field mappings</h4>
                    <p className="text-[10px] text-stone-500">Select registry-backed values, edit labels/defaults, and mark required fields.</p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={templateCustomFieldLabel}
                      onChange={event => setTemplateCustomFieldLabel(event.target.value)}
                      placeholder="Custom field"
                      className="w-36 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs text-slate-900"
                    />
                    <button type="button" onClick={addTemplateCustomField} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white">
                      Add field
                    </button>
                  </div>
                </div>
                {(template.templateFields || []).length === 0 ? (
                  <p className="text-[11px] text-stone-500">No custom mappings. Use the standard placeholders below or add a configurable field.</p>
                ) : (
                  <div className="space-y-2">
                    {(template.templateFields || []).map((field, index) => (
                      <div key={`${field.key}-${index}`} className="grid gap-2 rounded-lg border border-stone-200 bg-white p-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
                        <input
                          value={field.label}
                          onChange={event => setTemplate({
                            ...template,
                            templateFields: template.templateFields?.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, label: event.target.value } : item),
                          })}
                          aria-label="Template field label"
                          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-slate-900"
                        />
                        <select
                          value={field.key}
                          onChange={event => {
                            const nextKey = event.target.value;
                            setTemplate({
                              ...template,
                              bodyTemplate: template.bodyTemplate.replaceAll(`{{${field.key}}}`, `{{${nextKey}}}`),
                              templateFields: template.templateFields?.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, key: nextKey } : item),
                            });
                          }}
                          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-slate-900"
                        >
                          {CERTIFICATE_FIELD_OPTIONS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
                          {!CERTIFICATE_FIELD_OPTIONS.some(option => option.key === field.key) && (
                            <option value={field.key}>{field.key} (custom)</option>
                          )}
                        </select>
                        <input
                          value={field.defaultValue || ''}
                          onChange={event => setTemplate({
                            ...template,
                            templateFields: template.templateFields?.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, defaultValue: event.target.value } : item),
                          })}
                          placeholder="Optional default"
                          aria-label="Template field default"
                          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs text-slate-900"
                        />
                        <label className="flex items-center gap-1 text-[11px] text-slate-700">
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={event => setTemplate({
                              ...template,
                              templateFields: template.templateFields?.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, required: event.target.checked } : item),
                            })}
                          />
                          Required
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Placeholder helper chips */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                  CLICK TO INSERT PLACEHOLDER VARIABLES:
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 bg-slate-50 border border-stone-200 rounded-xl">
                  {AVAILABLE_PLACEHOLDERS.map(ph => (
                    <button
                      key={ph.key}
                      type="button"
                      onClick={() => handleInsertPlaceholder(ph.key)}
                      className="px-2 py-1 bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-[11px] font-mono font-bold transition cursor-pointer flex items-center gap-1"
                      title={`Sample: ${ph.sample}`}
                    >
                      <span>+ {ph.key}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Rich Body Textarea */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1">
                  Body Template Content (Supports Double Line Breaks for Paragraphs)
                </label>
                <textarea
                  rows={10}
                  value={template.bodyTemplate}
                  onChange={e => setTemplate({ ...template, bodyTemplate: e.target.value })}
                  className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-xs font-serif leading-relaxed text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Optional Note Text */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1">
                  Official Footer Note / Notice (Italicized)
                </label>
                <input
                  type="text"
                  value={template.noteText || ''}
                  onChange={e => setTemplate({ ...template, noteText: e.target.value })}
                  placeholder="e.g. Note: This certification is not valid without official seal."
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}

          {/* CARD 4: OFFICIAL SIGNATORIES */}
          {activeSection === 'signatories' && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-xs p-5 space-y-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">4. Official Signatories</h3>
                  <p className="text-xs text-stone-500">
                    Customize names, designations, clear horizontal signature lines, and digital signatures
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddSignatory}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ ADD SIGNATORY</span>
                </button>
              </div>

              <div className="space-y-4">
                {(template.signatories || []).map((sig, index) => (
                  <div
                    key={sig.id}
                    className="bg-white p-4 rounded-xl border border-stone-200 shadow-2xs space-y-3 relative"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-md bg-slate-900 text-white font-black text-[11px] flex items-center justify-center">
                          #{index + 1}
                        </span>
                        <span className="text-xs font-black text-slate-900 uppercase">
                          {sig.position || translateInterfaceText("Signatory")}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleMoveSignatory(index, 'up')}
                          disabled={index === 0}
                          className="p-1 rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30 cursor-pointer"
                          title={translateInterfaceText("Move Up")}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMoveSignatory(index, 'down')}
                          disabled={index === (template.signatories?.length || 0) - 1}
                          className="p-1 rounded text-stone-500 hover:bg-stone-100 disabled:opacity-30 cursor-pointer"
                          title={translateInterfaceText("Move Down")}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveSignatory(sig.id)}
                          className="p-1 rounded text-rose-500 hover:bg-rose-50 cursor-pointer"
                          title="Remove Signatory"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Full Name */}
                      <div>
                        <label className="block text-[11px] font-bold text-stone-700 mb-1">
                          FULL NAME / PLACEHOLDER
                        </label>
                        <input
                          type="text"
                          value={sig.name}
                          onChange={e => handleUpdateSignatory(sig.id, { name: e.target.value })}
                          placeholder="e.g. HON. VICENTE T. MADRONERO JR. or {{resident_name}}"
                          className="w-full px-2.5 py-1.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                        />
                      </div>

                      {/* Position */}
                      <div>
                        <label className="block text-[11px] font-bold text-stone-700 mb-1">
                          POSITION / DESIGNATION
                        </label>
                        <input
                          type="text"
                          value={sig.position}
                          onChange={e => handleUpdateSignatory(sig.id, { position: e.target.value })}
                          placeholder="e.g. PUNONG BARANGAY"
                          className="w-full px-2.5 py-1.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                        />
                      </div>

                      {/* Signatory Prefix */}
                      <div>
                        <label className="block text-[11px] font-bold text-stone-700 mb-1">
                          SIGNATORY PREFIX (OPTIONAL)
                        </label>
                        <input
                          type="text"
                          value={sig.prefix || sig.details || ''}
                          onChange={e =>
                            handleUpdateSignatory(sig.id, {
                              prefix: e.target.value,
                              details: e.target.value,
                            })
                          }
                          placeholder="e.g. Noted by: / Certified by: / CONFORME:"
                          className="w-full px-2.5 py-1.5 bg-stone-50 border border-stone-300 rounded-lg text-xs font-semibold text-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-stone-700 mb-1">
                          SIGNATURE
                        </label>
                        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                          Leave this area blank for the authorized signatory to sign by hand. Uploaded signature images are not printed as approval.
                        </p>
                      </div>
                    </div>

                    {/* SIGNATURE LINE CUSTOMIZATION CONTROLS */}
                    <div className="bg-slate-50 p-3 rounded-lg border border-stone-200 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 font-bold text-slate-900 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={sig.showSignatureLine !== false}
                            onChange={e =>
                              handleUpdateSignatory(sig.id, { showSignatureLine: e.target.checked })
                            }
                            className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                          />
                          <span>Show Horizontal Signature Line</span>
                        </label>
                        <span className="text-[10px] text-stone-500">Rendered directly above name</span>
                      </div>

                      {sig.showSignatureLine !== false && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                          {/* Line Width */}
                          <div>
                            <label className="block text-[10px] font-bold text-stone-600 mb-0.5">Line Width</label>
                            <select
                              value={sig.lineWidth || '220px'}
                              onChange={e => handleUpdateSignatory(sig.id, { lineWidth: e.target.value })}
                              className="w-full px-2 py-1 bg-white border border-stone-300 rounded text-xs font-semibold text-slate-900"
                            >
                              <option value="160px">Compact (160px)</option>
                              <option value="180px">Standard (180px)</option>
                              <option value="200px">Medium (200px)</option>
                              <option value="220px">Wide (220px)</option>
                              <option value="260px">Extra Wide (260px)</option>
                              <option value="100%">Full Width (100%)</option>
                            </select>
                          </div>

                          {/* Line Alignment */}
                          <div>
                            <label className="block text-[10px] font-bold text-stone-600 mb-0.5">
                              Line Alignment
                            </label>
                            <select
                              value={sig.lineAlignment || sig.alignment || 'center'}
                              onChange={e =>
                                handleUpdateSignatory(sig.id, {
                                  lineAlignment: e.target.value as any,
                                  alignment: e.target.value as any,
                                })
                              }
                              className="w-full px-2 py-1 bg-white border border-stone-300 rounded text-xs font-semibold text-slate-900"
                            >
                              <option value="left">{translateInterfaceText("Left")}</option>
                              <option value="center">{translateInterfaceText("Center")}</option>
                              <option value="right">{translateInterfaceText("Right")}</option>
                            </select>
                          </div>

                          {/* Signature Width */}
                          <div>
                            <label className="block text-[10px] font-bold text-stone-600 mb-0.5">
                              Signature Width
                            </label>
                            <select
                              value={sig.signatureWidth || '130px'}
                              onChange={e => handleUpdateSignatory(sig.id, { signatureWidth: e.target.value })}
                              className="w-full px-2 py-1 bg-white border border-stone-300 rounded text-xs font-semibold text-slate-900"
                            >
                              <option value="100px">Small (100px)</option>
                              <option value="130px">Medium (130px)</option>
                              <option value="160px">Large (160px)</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Big Add Signatory Button */}
                <button
                  type="button"
                  onClick={handleAddSignatory}
                  className="w-full py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 border-2 border-dashed border-blue-300 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>+ ADD SIGNATORY</span>
                </button>
              </div>
            </div>
          )}

          {/* CARD 5: WATERMARK */}
          {activeSection === 'watermark' && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-xs p-5 space-y-4 animate-in fade-in duration-150">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="text-sm font-black text-slate-900">5. Background Logo / Watermark</h3>
                <p className="text-xs text-stone-500">
                  Enable subtle background watermark visible behind certificate text
                </p>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 border border-stone-200 rounded-xl">
                <div>
                  <span className="text-xs font-black text-slate-900">Enable Background Watermark</span>
                  <p className="text-[11px] text-stone-500">Display seal in center behind document body</p>
                </div>
                <input
                  type="checkbox"
                  checked={template.watermark?.enabled || false}
                  onChange={e =>
                    setTemplate({
                      ...template,
                      watermark: { ...template.watermark, enabled: e.target.checked },
                    })
                  }
                  className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </div>

              {template.watermark?.enabled && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-stone-700 mb-1">Watermark Seal Type</label>
                      <select
                        value={template.watermark.type}
                        onChange={e =>
                          setTemplate({
                            ...template,
                            watermark: { ...template.watermark, type: e.target.value as any },
                          })
                        }
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="municipality">{translateInterfaceText("Municipality of Hinunangan Seal")}</option>
                        <option value="barangay">{translateInterfaceText("Barangay Official Seal")}</option>
                        <option value="da">{translateInterfaceText("Department of Agriculture (DA) Seal")}</option>
                        <option value="province">{translateInterfaceText("Province of Southern Leyte Seal")}</option>
                        <option value="custom">Custom Uploaded Watermark</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-stone-700 mb-1">Watermark Size</label>
                      <select
                        value={template.watermark.size}
                        onChange={e =>
                          setTemplate({
                            ...template,
                            watermark: { ...template.watermark, size: e.target.value as any },
                          })
                        }
                        className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="small">Small (280px)</option>
                        <option value="medium">Medium (380px)</option>
                        <option value="large">Large (480px)</option>
                      </select>
                    </div>
                  </div>

                  {/* Opacity Slider */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-bold text-stone-700">Watermark Opacity</label>
                      <span className="text-xs font-black text-blue-700 font-mono">
                        {Math.round((template.watermark.opacity || 0.12) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.04"
                      max="0.35"
                      step="0.01"
                      value={template.watermark.opacity || 0.12}
                      onChange={e =>
                        setTemplate({
                          ...template,
                          watermark: {
                            ...template.watermark,
                            opacity: parseFloat(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                  </div>

                  {template.watermark.type === 'custom' && (
                    <div>
                      <label className="block text-xs font-bold text-stone-700 mb-1">
                        Upload Custom Watermark Image
                      </label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleWatermarkUpload}
                        className="text-xs"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* CARD 6: RECEIPT & FOOTER */}
          {activeSection === 'receipt' && (
            <div className="bg-white rounded-2xl border border-stone-200 shadow-xs p-5 space-y-4 animate-in fade-in duration-150">
              <div className="border-b border-stone-100 pb-3">
                <h3 className="text-sm font-black text-slate-900">6. Official Receipt & Notes</h3>
                <p className="text-xs text-stone-500">Configure bottom-left official receipt payment block</p>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 border border-stone-200 rounded-xl">
                <div>
                  <span className="text-xs font-black text-slate-900">Show Official Receipt (O.R.) Box</span>
                  <p className="text-[11px] text-stone-500">Renders official receipt number, amount paid, and timestamp</p>
                </div>
                <input
                  type="checkbox"
                  checked={template.receipt?.showReceiptBox || false}
                  onChange={e =>
                    setTemplate({
                      ...template,
                      receipt: { ...template.receipt, showReceiptBox: e.target.checked },
                    })
                  }
                  className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </div>

              {template.receipt?.showReceiptBox && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">Receipt Format Style</label>
                    <select
                      value={template.receipt.formatStyle || 'nava'}
                      onChange={e =>
                        setTemplate({
                          ...template,
                          receipt: { ...template.receipt, formatStyle: e.target.value as any },
                        })
                      }
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900"
                    >
                      <option value="nava">Nava Format (Official Receipt Paid: OR / ₱)</option>
                      <option value="standard">Standard Format (O.R. # : ...)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">Default Fee (PHP)</label>
                    <input
                      type="text"
                      value={template.receipt.amountPaid || '100.00'}
                      onChange={e =>
                        setTemplate({
                          ...template,
                          receipt: { ...template.receipt, amountPaid: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-900"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: LIVE CERTIFICATE PREVIEW (EXACT OUTPUT WITH IMMEDIATE UPDATES) */}
        {/* ========================================================================= */}
        <div className="lg:col-span-6 space-y-3">
          <div className="bg-white p-3.5 rounded-2xl border border-stone-200 shadow-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-black text-slate-900 uppercase tracking-wide">
                LIVE CERTIFICATE PREVIEW
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span>Print Preview</span>
              </button>
            </div>
          </div>

          {/* Scaled & Scrollable Document Canvas (No floating distracting buttons) */}
          <div className="bg-slate-200/90 p-4 sm:p-6 rounded-2xl border border-stone-300 shadow-inner overflow-x-auto">
            <DynamicCertificateView
              containerRef={printRef}
              template={template}
              data={sampleDataContext}
              previewOnly
            />
          </div>
        </div>
      </div>

      {/* ADD LOGO MODAL */}
      {isAddLogoModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-stone-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Image className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-black text-slate-900">Add Official Seal / Logo</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddLogoModalOpen(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Position Selector */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1.5">Position in Header</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['left', 'center', 'right'] as CertificateLogoPosition[]).map(pos => (
                    <button
                      key={pos}
                      type="button"
                      onClick={() => setNewLogoPosition(pos)}
                      className={`py-2 px-3 rounded-xl font-bold uppercase text-xs transition cursor-pointer border ${
                        newLogoPosition === pos
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
              </div>

              {/* Logo Source Type */}
              <div>
                <label className="block text-xs font-bold text-stone-700 mb-1">Seal / Insignia Source</label>
                <select
                  value={newLogoType}
                  onChange={e => setNewLogoType(e.target.value as CertificateLogoType)}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl font-semibold text-slate-900"
                >
                  <option value="barangay">{translateInterfaceText("Barangay Official Seal")}</option>
                  <option value="municipality">{translateInterfaceText("Municipality of Hinunangan Seal")}</option>
                  <option value="province">{translateInterfaceText("Province of Southern Leyte Seal")}</option>
                  <option value="da">{translateInterfaceText("Department of Agriculture (DA) Seal")}</option>
                  <option value="bagong_pilipinas">Bagong Pilipinas Official Logo</option>
                  <option value="custom">Custom Uploaded File</option>
                </select>
              </div>

              {/* If Barangay Seal, select which barangay */}
              {newLogoType === 'barangay' && (
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1"><InterfaceText source="Select Barangay" /></label>
                  <select
                    value={newLogoBarangay}
                    onChange={e => setNewLogoBarangay(e.target.value)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl font-semibold text-slate-900"
                  >
                    {HINUNANGAN_BARANGAYS.map(b => (
                      <option key={b.code} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* If Custom, upload image */}
              {newLogoType === 'custom' && (
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Upload Seal Image</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={e => handleLogoFileUpload(e)}
                    className="w-full text-xs"
                  />
                </div>
              )}

              {/* Dimensions */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-stone-700">Logo Size</label>
                  <span className="font-mono font-bold text-blue-600">{newLogoSize}px</span>
                </div>
                <input
                  type="range"
                  min="45"
                  max="110"
                  value={newLogoSize}
                  onChange={e => setNewLogoSize(Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setIsAddLogoModalOpen(false)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold rounded-xl text-xs transition cursor-pointer"
              ><InterfaceText source="Cancel" /></button>
              <button
                type="button"
                onClick={handleSaveNewLogo}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-xs"
              >
                Save Logo
              </button>
            </div>
          </div>
        </div>
      )}

      {isImportDialogOpen && (
        createPortal(<div className="fixed inset-0 z-[1000] flex items-end justify-center overflow-hidden bg-slate-950/80 p-2 backdrop-blur-sm sm:items-center sm:p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="certificate-import-title"
            className="flex max-h-[95dvh] w-[95vw] max-w-[52rem] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl sm:max-h-[90dvh] sm:w-full"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-700 px-4 py-3 sm:px-5 sm:py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400">Template import</p>
                <h3 id="certificate-import-title" className="text-lg font-black text-white">Import Certificate Template</h3>
                <p className="mt-0.5 text-xs text-slate-400">Upload and configure your certificate template.</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportBack}
                  className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-800"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={requestCloseImportDialog}
                  aria-label="Close import dialog"
                  className="rounded-lg border border-slate-600 p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:space-y-5 sm:p-5">
              <div className="rounded-2xl border border-dashed border-slate-600 bg-slate-950/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-slate-200">Accepted formats</p>
                    <p className="text-[11px] text-slate-400">PDF, DOCX, JPG/JPEG, PNG (also JSON/HTML template exports)</p>
                  </div>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">
                    up to 5 MB
                  </span>
                </div>

                <label
                  onDragOver={event => {
                    event.preventDefault();
                    setIsDraggingImport(true);
                  }}
                  onDragLeave={event => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingImport(false);
                  }}
                  onDrop={event => {
                    event.preventDefault();
                    setIsDraggingImport(false);
                    const file = event.dataTransfer.files[0];
                    if (file) void processImportTemplateFile(file);
                  }}
                  className={`mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-4 py-6 text-center transition sm:px-5 sm:py-8 ${
                    isDraggingImport
                      ? 'border-emerald-400 bg-emerald-500/10'
                      : 'border-slate-700 bg-slate-900 hover:border-blue-500 hover:bg-slate-800'
                  }`}
                >
                  <Upload className="h-8 w-8 text-emerald-400" />
                  <div>
                    <p className="text-sm font-black text-white">Drag and drop or browse files</p>
                    <p className="mt-1 text-[11px] text-slate-400">Select a template export or certificate reference document.</p>
                  </div>
                  <input
                    type="file"
                    accept=".json,.html,.htm,.docx,.pdf,.png,.jpg,.jpeg"
                    onChange={handleImportTemplateFile}
                    className="sr-only"
                    aria-label="Choose a certificate template file"
                  />
                  <span className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white"><InterfaceText source="Browse Files" /></span>
                </label>
              </div>

              {isImportingFile && (
                <div role="status" className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                  Reading the selected certificate…
                </div>
              )}

              {importedFile && (
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-200">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black text-white">{importedFile.name}</p>
                      <p className="text-slate-400">{formatImportSize(importedFile.size)} • {importedFile.type || 'Unknown type'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setImportedFile(null);
                        setImportedTemplate(null);
                        setImportedBody('');
                        setImportedFields([]);
                        setPendingSourceFile(null);
                        setImportError(null);
                      }}
                      className="rounded-lg border border-slate-600 px-2 py-1 font-bold text-slate-200 hover:bg-slate-800"
                    ><InterfaceText source="Replace File" /></button>
                  </div>
                </div>
              )}

              {importError && (
                <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {<LocalizedFeedback value={importError} />}
                </div>
              )}

              {importProgress > 0 && importProgress < 1 && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-100">
                  Extracting certificate text… {Math.round(importProgress * 100)}%
                </div>
              )}

              {importedTemplate && (
                <div className="space-y-4 rounded-2xl border border-slate-700 bg-slate-950/50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Ready to review
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <label htmlFor="imported-template-name" className="mb-1 block text-xs font-bold text-slate-200">Template name</label>
                      <input
                        id="imported-template-name"
                        type="text"
                        value={importedTemplateName}
                        onChange={e => setImportedTemplateName(e.target.value)}
                        className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold text-white outline-none ring-0 focus:border-blue-500"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label htmlFor="imported-template-description" className="mb-1 block text-xs font-bold text-slate-200"><InterfaceText source="Description" /></label>
                      <textarea
                        id="imported-template-description"
                        value={importedTemplateDescription}
                        onChange={e => setImportedTemplateDescription(e.target.value)}
                        rows={3}
                        className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold text-white outline-none ring-0 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label htmlFor="imported-document-type" className="mb-1 block text-xs font-bold text-slate-200">Document type</label>
                      <select
                        id="imported-document-type"
                        value={importedDocumentType}
                        onChange={e => setImportedDocumentType(e.target.value)}
                        className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-blue-500"
                      >
                        {DOCUMENT_TYPE_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="imported-barangay-scope" className="mb-1 block text-xs font-bold text-slate-200">Barangay scope</label>
                      <select
                        id="imported-barangay-scope"
                        value={importedBarangay}
                        onChange={e => setImportedBarangay(e.target.value)}
                        className="w-full rounded-xl border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-blue-500"
                      >
                        <option value="All">{translateInterfaceText("All Barangays")}</option>
                        {HINUNANGAN_BARANGAYS.map(b => (
                          <option key={b.code} value={b.name}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {importedTemplate.layoutHints && (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-[10px] text-slate-300">
                      <span className="font-black uppercase tracking-wide text-slate-400">Layout clues:</span>
                      <span>{importedTemplate.pageSize} {importedTemplate.orientation}</span>
                      <span>{importedTemplate.layoutHints.headings.length} heading candidate(s)</span>
                      {importedTemplate.layoutHints.hasTables && <span>possible table</span>}
                      {importedTemplate.layoutHints.hasImages && <span>image/logo candidate (not copied)</span>}
                      {importedTemplate.layoutHints.hasSignatureArea && <span>signature-area text candidate</span>}
                    </div>
                  )}

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="space-y-3">
                      <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Extracted wording — edit freely</p>
                        <textarea
                          value={importedBody}
                          onChange={event => setImportedBody(event.target.value)}
                          rows={14}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100"
                        />
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Detected field mapping</p>
                            <p className="mt-1 text-[10px] text-slate-400">Review each mapping; fields without authorized data remain visibly unresolved.</p>
                          </div>
                          <div className="flex gap-2">
                            <input
                              value={customFieldLabel}
                              onChange={event => setCustomFieldLabel(event.target.value)}
                              placeholder="Custom field label"
                              className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                            />
                            <button type="button" onClick={addImportedCustomField} className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white">
                              Add field
                            </button>
                          </div>
                        </div>
                        {importedFields.length === 0 ? (
                          <p className="py-2 text-xs text-amber-200">No labeled fields were confidently detected. Add custom fields and place their placeholders in the wording above.</p>
                        ) : (
                          <div className="max-h-64 space-y-2 overflow-auto">
                            {importedFields.map((field, index) => (
                              <div key={`${field.key}-${index}`} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-800 p-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-center">
                                <span className="text-xs text-slate-200">
                                  {field.label}
                                  {field.confidence === 'review' && <span className="ml-1 text-amber-300">Review</span>}
                                </span>
                                <select
                                  value={field.key}
                                  onChange={event => {
                                    const nextKey = event.target.value;
                                    setImportedFields(previous => previous.map((item, itemIndex) => itemIndex === index
                                      ? { ...item, key: nextKey }
                                      : item));
                                    setImportedBody(previous => previous.replaceAll(`{{${field.key}}}`, `{{${nextKey}}}`));
                                  }}
                                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                                >
                                  {CERTIFICATE_FIELD_OPTIONS.map(option => (
                                    <option key={option.key} value={option.key}>{option.label}</option>
                                  ))}
                                  {importedFields
                                    .filter(option => !CERTIFICATE_FIELD_OPTIONS.some(standard => standard.key === option.key))
                                    .map(option => <option key={option.key} value={option.key}>{option.label} (custom)</option>)}
                                </select>
                                <input
                                  value={field.defaultValue || ''}
                                  onChange={event => setImportedFields(previous => previous.map((item, itemIndex) => itemIndex === index
                                    ? { ...item, defaultValue: event.target.value }
                                    : item))}
                                  placeholder="Optional default"
                                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                                />
                                <label className="flex items-center gap-1 text-[11px] text-slate-300">
                                  <input
                                    type="checkbox"
                                    checked={field.required}
                                    onChange={event => setImportedFields(previous => previous.map((item, itemIndex) => itemIndex === index
                                      ? { ...item, required: event.target.checked }
                                      : item))}
                                  />
                                  Required
                                </label>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/80">
                        <p className="px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Original source preview</p>
                        {importedFile?.type === 'application/pdf' && importedSourcePreviewUrl ? (
                          <iframe title="Imported certificate source" src={importedSourcePreviewUrl} className="h-56 w-full bg-white sm:h-72" />
                        ) : importedFile?.type.startsWith('image/') && importedSourcePreviewUrl ? (
                          <img src={importedSourcePreviewUrl} alt="Imported certificate source" className="max-h-72 w-full object-contain bg-white" />
                        ) : (
                          <p className="px-3 pb-3 text-xs text-slate-300">Original document preview is not supported by this browser. The extracted text is shown for review.</p>
                        )}
                        {importedFile?.type === 'application/pdf' && (
                          <p className="border-t border-slate-700 px-3 py-2 text-[11px] leading-5 text-amber-200">
                            The original PDF is retained as a reference. Extracted wording is an editable approximation; the original visual layout is not converted into an editable background.
                          </p>
                        )}
                      </div>
                      <div className="rounded-xl border border-slate-700 bg-white p-3">
                        <p className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Editable template preview — not issued</p>
                        <p className="whitespace-pre-wrap text-xs leading-5 text-stone-900">
                          {replaceTemplatePlaceholders(importedBody, Object.fromEntries(
                            importedFields.map(field => [field.key, field.defaultValue || '—']),
                          ))}
                        </p>
                      </div>
                    </div>
                  </div>

                  {importedTemplate.warnings.length > 0 && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                      {importedTemplate.warnings.map(warning => (
                        <p key={warning} className="mb-1 last:mb-0">• {<LocalizedFeedback value={warning} />}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-700 bg-slate-900 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
              <button
                type="button"
                onClick={requestCloseImportDialog}
                disabled={isSaving}
                className="min-h-10 rounded-xl border border-slate-600 px-4 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
              ><InterfaceText source="Cancel" /></button>
              <button
                type="button"
                disabled={!importedTemplate || isImportingFile || isSaving}
                onClick={() => void handleSaveImportedTemplate()}
                className="flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving && <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {isSaving ? 'Saving…' : 'Save Template'}
              </button>
            </footer>
          </section>
        </div>, document.body)
      )}
    </div>
  );
};