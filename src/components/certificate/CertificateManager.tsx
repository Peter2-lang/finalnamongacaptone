import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Printer,
  FileText,
  FileSpreadsheet,
  Edit3,
  RefreshCw,
  Columns as ColumnsIcon,
  Globe,
  CheckCircle2,
  ChevronDown,
  X,
  ShieldCheck,
  Layers,
  Search,
  Sliders,
  Plus,
  Trash2,
  Eye,
  Award,
  BookOpen,
  Send,
  FileCheck,
  Sparkles,
  Download,
  ShieldAlert,
  Lock,
} from 'lucide-react';
import {
  SwineRecord,
  UserAccount,
  IssuedCertificate,
  CertificateTypeDefinition,
  CertificateTemplate,
  Barangay,
} from '../../types';
import { certificatesApi, moduleDataApi } from '../../services/api';
import { HINUNANGAN_BARANGAYS } from '../../data/barangays';
import {
  SealBagongPilipinas,
  SealDA,
  SealMunicipality,
} from '../common/OfficialSeals';
import {
  BarangayCertificateView,
  CertificateData,
} from './BarangayCertificateView';
import {
  CertificateLogoCustomizer,
  CertificateLogoSettings,
} from './CertificateLogoCustomizer';
import { CreateCertificateModal } from './CreateCertificateModal';
import { CertificateTemplateEditor } from './CertificateTemplateEditor';
import { TransmittalLetterManager } from './TransmittalLetterManager';
import { calculateSwineAge, formatDobDisplay } from '../../utils/swineRegistryLogic';
import { downloadElementAsPdf } from '../../utils/pdfUtils';
import { printDocument } from '../../utils/printUtils';
import { filterCertificateTemplates } from '../../utils/certificateTemplateFilters';
import { useCertificateTemplateSync } from '../../hooks/useCertificateTemplateSync';

interface CertificateManagerProps {
  swineList: SwineRecord[];
  barangays: Barangay[];
  currentUser: UserAccount | null;
  selectedSwineInitial?: SwineRecord | null;
}

// Built-in Standard Individual Certificate Formats
const STANDARD_CERTIFICATE_TYPES: CertificateTypeDefinition[] = [
  {
    id: 'barangay-certification',
    name: 'Barangay Certification (Market Sale / Transfer)',
    title: 'BARANGAY CERTIFICATION',
    formatType: 'barangay_cert',
    letterBody: `TO WHOM IT MAY CONCERN:

This is to certify that {farmerName} is a bonafide resident of Barangay {barangay}, Hinunangan, Southern Leyte.

This certifies further that {farmerName} owned {numberOfHeads} heads of pigs sold to {buyerName} of {destination}.

This certification is being issued upon the request of the named person for whatever legal purpose it may serve best.

Issued this {issueDate} at Barangay {barangay}, Hinunangan, Southern Leyte, Philippines.`,
    termsAndConditions: [
      'This Barangay Certification serves as proof of origin, ownership, and clearance for livestock sale and transit.',
      'The livestock originates from a registered ASF-Free (Green Zone) holding with zero clinical fever symptoms.',
      'Official Receipt (O.R.) payment is recorded under Barangay Regulatory Fees Ordinance.',
      'Subject to presentation at the Municipal Agriculture Office and Animal Quarantine Checkpoints.',
    ],
    signatories: [
      { id: 'sig-1', name: 'HON. VICENTE T. MADRONERO JR.', title: 'Punong Barangay', office: 'Office of the Punong Barangay', order: 1 },
      { id: 'sig-2', name: 'RANDY N. BURLAZA, BBO', title: 'Barangay Biosecurity Officer', office: 'Committee on Agriculture', order: 2 },
      { id: 'sig-3', name: '{farmerName}', title: 'FARMER/OWNER', office: 'Conforme', order: 3 },
    ],
  },
  {
    id: 'biosecurity-transit',
    name: 'Livestock Biosecurity Clearance & Transit Permit',
    title: 'OFFICIAL BARANGAY LIVESTOCK BIOSECURITY CLEARANCE & TRANSFER PERMIT',
    formatType: 'biosecurity',
    letterBody: `THIS IS TO CERTIFY that the swine described herein has undergone comprehensive biosecurity inspection and is officially cleared for live animal transit, transfer, and commercial trade in accordance with Municipal Agriculture ordinances and African Swine Fever (ASF) biosecurity protocols.

The registered farm lot has been inspected and certified as ASF-Free (Green Zone Status), with zero history of clinical febrile outbreaks, zero swill feeding practices, and standard perimeter disinfection setbacks verified.`,
    termsAndConditions: [
      'This clearance is strictly valid for seventy-two (72) hours from official timestamp of issuance.',
      'Transport vehicle must be sanitized and disinfected before loading livestock at the municipal checkpoint.',
      'Any unauthorized route deviation or offloading in uncertified red/pink buffer zones revokes this permit immediately.',
      'Carrier must present this physical or digital QR certificate at all designated DA quarantine checkpoints.',
    ],
    signatories: [
      { id: 'sig-1', name: 'HON. CIRILO B. MONTEJO', title: 'Punong Barangay / Council Chair', office: 'Barangay Local Government Unit', order: 1 },
      { id: 'sig-2', name: 'ENGR. ARNALDO M. VALDEZ', title: 'Municipal Agricultural Officer', office: 'Office of the Municipal Agriculturist', order: 2 },
      { id: 'sig-3', name: 'DR. MARICEL P. TANYAG', title: 'Veterinary Biosecurity Inspector', office: 'Municipal Agriculture & Veterinary Services', order: 3 },
    ],
  },
  {
    id: 'vhc-clinical',
    name: 'Veterinary Health Certificate (VHC)',
    title: 'VETERINARY HEALTH CERTIFICATE (VHC) FOR SWINE TRANSIT & INSPECTION',
    formatType: 'health',
    letterBody: `THIS IS TO CERTIFY that I have personally conducted a comprehensive ante-mortem veterinary clinical examination on the live swine identified by the Ear Tag registered below.

Upon rigorous physical examination, the animal exhibited normal physiological parameters (rectal temperature within 38.5°C–39.5°C), normal mucosal membranes, clear ocular/nasal passages, absence of cutaneous hemorrhages or cyanosis, and exhibited zero clinical signs compatible with African Swine Fever (ASF), Hog Cholera, or other contagious viral diseases.`,
    termsAndConditions: [
      'Clinical certification is valid for 72 hours from the completion of ante-mortem physical examination.',
      'The livestock originates from a non-quarantined herd with verified vaccination and biosecurity audit records.',
      'Must be accompanied by the designated driver and carrier vehicle listed in the livestock manifest.',
    ],
    signatories: [
      { id: 'sig-1', name: 'DR. MARICEL P. TANYAG, DVM', title: 'Municipal Veterinary Officer', office: 'Provincial Veterinary Field Unit • Southern Leyte', order: 1 },
      { id: 'sig-2', name: 'ENGR. ARNALDO M. VALDEZ', title: 'Municipal Agricultural Officer (MAO)', office: 'Office of the Municipal Agriculturist - Hinunangan', order: 2 },
    ],
  },
  {
    id: 'slaughter-pass',
    name: 'Municipal Slaughter & Movement Permit',
    title: 'MUNICIPAL SLAUGHTER & LIVESTOCK DISPATCH PERMIT',
    formatType: 'slaughter',
    letterBody: `PERMISSION IS HEREBY GRANTED to transport, transfer, and deliver the live market swine detailed hereunder to the designated Municipal Slaughterhouse or accredited meat processing facility.

Ante-mortem clearance has been established, fees have been recorded, and the carcass is cleared for regulated processing in strict adherence to National Meat Inspection Service (NMIS) standards.`,
    termsAndConditions: [
      'Permit valid strictly for direct transit to the accredited slaughter facility specified herein.',
      'Slaughter without ante-mortem inspection tag constitutes a violation of Municipal Health Ordinance.',
      'Valid for 48 hours from dispatch schedule.',
    ],
    signatories: [
      { id: 'sig-1', name: 'ENGR. ARNALDO M. VALDEZ', title: 'Municipal Agricultural Officer', office: 'Office of the Municipal Agriculturist', order: 1 },
      { id: 'sig-2', name: 'ROBERTO L. TAN', title: 'Meat Inspection Officer / Abattoir Supervisor', office: 'Municipal Slaughterhouse Division', order: 2 },
    ],
  },
];

const DEFAULT_CERTIFICATE_LOGO_SETTINGS: CertificateLogoSettings = {
  leftLogoType: 'barangay',
  leftBarangayName: 'NAVA',
  centerLogoType: 'municipality',
  rightLogoType: 'bagong_pilipinas',
  showWatermark: true,
  watermarkType: 'municipality',
  watermarkOpacity: 0.12,
  barangayEmail: 'nava.hinunangan20@gmail.com',
  barangayPhone: '09763070221',
  headerMotto: '',
};

// Helper to parse Full Name into Family Name, Given Name, Middle Name
function parseFullName(fullName: string): { familyName: string; givenName: string; middleName: string } {
  if (!fullName || !fullName.trim()) {
    return { familyName: '', givenName: '', middleName: '' };
  }
  const clean = fullName.trim();
  if (clean.includes(',')) {
    const [last, rest] = clean.split(',').map(s => s.trim());
    const restParts = (rest || '').split(' ').filter(Boolean);
    const middle = restParts.length > 1 ? restParts.pop() || '' : '';
    const given = restParts.join(' ') || (rest || '');
    return {
      familyName: last.toUpperCase(),
      givenName: given.toUpperCase(),
      middleName: (middle || '-').toUpperCase(),
    };
  }

  const parts = clean.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return { familyName: parts[0].toUpperCase(), givenName: parts[0].toUpperCase(), middleName: '-' };
  }
  if (parts.length === 2) {
    return { familyName: parts[1].toUpperCase(), givenName: parts[0].toUpperCase(), middleName: '-' };
  }
  const family = parts.pop() || '';
  const middle = parts.length > 1 ? parts.pop() || '' : '';
  const given = parts.join(' ');
  return {
    familyName: family.toUpperCase(),
    givenName: given.toUpperCase(),
    middleName: (middle || '-').toUpperCase(),
  };
}

function getFormattedRsbsaId(swine: SwineRecord): string {
  return swine.rsbsaId?.trim() || '—';
}

function getFarmerBirthday(swine: SwineRecord): string {
  const savedBirthday = swine.customFields?.farmerBirthDate || swine.customFields?.farmer_birth_date;
  return typeof savedBirthday === 'string' && savedBirthday ? formatDobDisplay(savedBirthday) : '—';
}

function toCsvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export type DocumentType =
  | 'barangay_certification'
  | 'issued_archive'
  | 'official_reports'
  | 'masterlist'
  | 'transmittal'
  | 'directory'
  | 'biosecurity_report'
  | 'complete_package';

export type PaperSize = 'folio' | 'letter' | 'a4' | 'legal';
export type Orientation = 'landscape' | 'portrait';
export type MarginsSetting = 'normal' | 'compact' | 'wide';
export type DensitySetting = 'compact' | 'standard' | 'spacious';

interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
}

export const CertificateManager: React.FC<CertificateManagerProps> = ({
  swineList,
  barangays,
  currentUser,
  selectedSwineInitial,
}) => {
  const isUserAdmin = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
  const canManageTemplates = isUserAdmin || currentUser?.role === 'focal';
  const userAssignedBarangay = currentUser?.assignedBarangay || '';
  const userBarangayId = currentUser?.barangay_id || '';

  // Main Report & Document Type Selection (Default to Barangay Certification)
  const [documentType, setDocumentType] = useState<DocumentType>('barangay_certification');

  // Filter Bar Controls
  const [selectedBarangayScope, setSelectedBarangayScope] = useState<string>(() => {
    if (!isUserAdmin && userAssignedBarangay) {
      return userAssignedBarangay;
    }
    return 'all';
  });

  // Security Access Denied Modal State
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  // Official Certificate Report Generator States
  const [reportBarangayFilter, setReportBarangayFilter] = useState<string>(() => {
    if (!isUserAdmin && userAssignedBarangay) {
      return userAssignedBarangay;
    }
    return 'all';
  });
  const [reportCertTypeFilter, setReportCertTypeFilter] = useState<string>('all');
  const [reportDateFrom, setReportDateFrom] = useState<string>(`${new Date().getFullYear()}-01-01`);
  const [reportDateTo, setReportDateTo] = useState<string>(new Date().toISOString().substring(0, 10));
  const [isExportingReportPdf, setIsExportingReportPdf] = useState(false);
  const officialReportPrintRef = useRef<HTMLDivElement>(null);
  const [croppingSeason, setCroppingSeason] = useState<string>('Wet Season (WS) 2026 (June – Dec)');
  const [paperSize, setPaperSize] = useState<PaperSize>('letter');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [margins, setMargins] = useState<MarginsSetting>('normal');
  const [density, setDensity] = useState<DensitySetting>('standard');

  // Masterlist Column Visibility Controls
  const [isColumnPickerOpen, setIsColumnPickerOpen] = useState(false);
  const [columns, setColumns] = useState<ColumnConfig[]>([
    { key: 'rsbsa', label: 'RSBSA / Reg No.', visible: true },
    { key: 'name', label: 'Farmer Name (Family, Given, Middle)', visible: true },
    { key: 'address', label: 'Residential Address', visible: true },
    { key: 'birthday', label: 'Farmer Birthday', visible: false },
    { key: 'swineDob', label: 'Date of Birth', visible: true },
    { key: 'swineAge', label: 'Age at Report Date', visible: true },
    { key: 'farmLocation', label: 'Farm Location / Sitio', visible: true },
    { key: 'coordinates', label: 'GPS Coordinates (Lat/Lng)', visible: true },
    { key: 'heads', label: 'Swine Heads', visible: true },
    { key: 'breed', label: 'Breed / Commodity', visible: true },
    { key: 'weight', label: 'Total Weight (kg)', visible: true },
    { key: 'farmType', label: 'Farm Scale', visible: true },
    { key: 'biosecurity', label: 'Biosecurity Status', visible: true },
    { key: 'earTag', label: 'Ear Tag ID', visible: false },
    { key: 'regDate', label: 'Date Registered', visible: false },
  ]);

  // Signatory & Official Customization Modal State
  const [isSignatoryModalOpen, setIsSignatoryModalOpen] = useState(false);
  const [preparedByName, setPreparedByName] = useState('ROB PETER E. MADAJE');
  const [preparedByTitle, setPreparedByTitle] = useState('Field Inspector / BBO');
  const [verifiedByName, setVerifiedByName] = useState('ENGR. ARNALDO M. VALDEZ');
  const [verifiedByTitle, setVerifiedByTitle] = useState('Municipal Agricultural Officer');
  const [approvedByName, setApprovedByName] = useState('HON. VICENTE T. MADRONERO JR.');
  const [approvedByTitle, setApprovedByTitle] = useState('Municipal Mayor');

  // Transmittal Memorandum Custom Fields
  const [transmittalRefNo, setTransmittalRefNo] = useState('DA-MAO-HN-2026-TR-0982');
  const [transmittalRecipient, setTransmittalRecipient] = useState(
    'DR. ILUMINADO C. TANYAG, DVM\nProvincial Veterinary Officer\nProvincial Veterinary Office, Maasin City, Southern Leyte'
  );
  const [transmittalSubject, setTransmittalSubject] = useState(
    'TRANSMITTAL OF OFFICIAL RSBSA-REGISTERED SWINE RAISERS MASTERLIST & GIS BIOSECURITY AUDIT REPORT (CY 2026)'
  );

  // Logo & Seal Customizer Modal State
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);
  const [logoSettings, setLogoSettings] = useState<CertificateLogoSettings>(DEFAULT_CERTIFICATE_LOGO_SETTINGS);

  // Dynamic Certificate Templates State
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('tpl-nava-official');
  const [archivedTemplateOverride, setArchivedTemplateOverride] = useState<CertificateTemplate | null>(null);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null);
  const templateLoadSequence = useRef(0);
  const loadTemplates = useCallback(async () => {
    const sequence = ++templateLoadSequence.current;
    setIsLoadingTemplates(true);
    try {
      const savedTemplates = await moduleDataApi.get<CertificateTemplate[]>('certificate_templates');
      if (sequence !== templateLoadSequence.current) return;
      setTemplates(savedTemplates);
      setTemplateLoadError(null);
      setSelectedTemplateId(current => savedTemplates.some(template => template.id === current)
        ? current
        : savedTemplates[0]?.id || '');
    } catch (error) {
      if (sequence === templateLoadSequence.current) {
        console.error('Unable to load report templates from database:', error);
        setTemplateLoadError(error instanceof Error ? error.message : 'Unable to load templates from the database.');
      }
    } finally {
      if (sequence === templateLoadSequence.current) setIsLoadingTemplates(false);
    }
  }, [currentUser?.id]);
  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CertificateTemplate | undefined>(undefined);
  const [latestSavedTemplate, setLatestSavedTemplate] = useState<CertificateTemplate | null>(null);

  useCertificateTemplateSync(loadTemplates, Boolean(currentUser?.id));

  // Template Search & Filters in Manager
  const [tplSearchQuery, setTplSearchQuery] = useState('');
  const [tplBarangayFilter, setTplBarangayFilter] = useState('all');
  const [tplDocTypeFilter, setTplDocTypeFilter] = useState('all');
  const [tplLanguageFilter, setTplLanguageFilter] = useState('all');

  const filteredTemplates = useMemo(() => {
    return filterCertificateTemplates(templates, {
      search: tplSearchQuery,
      barangay: tplBarangayFilter === 'all' ? '' : tplBarangayFilter,
      documentType: tplDocTypeFilter === 'all' ? '' : tplDocTypeFilter,
      language: tplLanguageFilter === 'all' ? '' : tplLanguageFilter,
    });
  }, [templates, tplSearchQuery, tplBarangayFilter, tplDocTypeFilter, tplLanguageFilter]);

  const templateOptions = useMemo(() => {
    if (filteredTemplates.some(template => template.id === selectedTemplateId)) {
      return filteredTemplates;
    }
    const selectedTemplate = templates.find(template => template.id === selectedTemplateId);
    return selectedTemplate ? [selectedTemplate, ...filteredTemplates] : filteredTemplates;
  }, [filteredTemplates, selectedTemplateId, templates]);

  const activeTemplate = useMemo(() => {
    if (archivedTemplateOverride?.id === selectedTemplateId) return archivedTemplateOverride;
    return templates.find(t => t.id === selectedTemplateId);
  }, [archivedTemplateOverride, templates, selectedTemplateId]);
  const canManageActiveTemplate = Boolean(activeTemplate && (
    isUserAdmin || (
      userAssignedBarangay &&
      activeTemplate.barangay.trim().toLocaleLowerCase() === userAssignedBarangay.trim().toLocaleLowerCase()
    )
  ));

  useEffect(() => {
    if (!isLogoModalOpen) {
      setLogoSettings(activeTemplate?.logoSettings || DEFAULT_CERTIFICATE_LOGO_SETTINGS);
    }
  }, [activeTemplate?.id, activeTemplate?.updatedAt, activeTemplate?.logoSettings, isLogoModalOpen]);

  // Create Certificate Modal State
  const [isCreateCertModalOpen, setIsCreateCertModalOpen] = useState(false);
  const [certificateToEdit, setCertificateToEdit] = useState<IssuedCertificate | null>(null);

  const handleEditCertificate = (cert: IssuedCertificate) => {
    setCertificateToEdit(cert);
    setIsCreateCertModalOpen(true);
  };

  // Empty preview data avoids presenting example values as an official certificate.
  const [activeCertData, setActiveCertData] = useState<CertificateData>({
    templateStyle: 'nava',
    barangay: selectedSwineInitial?.barangay || '',
    farmerName: selectedSwineInitial?.farmerName || '',
    buyerName: '',
    destination: '',
    numberOfHeads: 0,
    orNumber: '',
    amountPaid: '',
    issueDate: new Date().toISOString().substring(0, 10),
    issuedAt: '',
    punongBarangay: '',
    bboName: '',
  });

  // Issued Certificates Archive
  const [issuedCertificates, setIssuedCertificates] = useState<IssuedCertificate[]>([]);
  const [archiveSearchQuery, setArchiveSearchQuery] = useState('');
  const [certToDelete, setCertToDelete] = useState<IssuedCertificate | null>(null);

  // PDF Export Feedback State
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const printableReportRef = useRef<HTMLDivElement>(null);
  const biosecurityReportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => certificatesApi.getAll().then(records => {
      if (active) setIssuedCertificates(records);
    }).catch(error => {
      if (active) setExportNotice(error instanceof Error ? error.message : 'Unable to load issued certificates from database.');
    });
    void refresh();
    const intervalId = window.setInterval(() => { void refresh(); }, 15000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [currentUser?.id]);

  // If selectedSwineInitial changes, sync farmer details
  useEffect(() => {
    if (selectedSwineInitial) {
      const calculatedAge = calculateSwineAge(
        selectedSwineInitial.birthDate ||
          selectedSwineInitial.dateOfBirth ||
          selectedSwineInitial.date_of_birth ||
          selectedSwineInitial.dob
      );
      setActiveCertData(prev => ({
        ...prev,
        farmerName: selectedSwineInitial.farmerName,
        barangay: selectedSwineInitial.barangay || prev.barangay,
        numberOfHeads: 1,
        swineAge: calculatedAge.hasDob ? calculatedAge.display : prev.swineAge,
      }));
      setLogoSettings(prev => ({
        ...prev,
        leftBarangayName: selectedSwineInitial.barangay || prev.leftBarangayName,
      }));
    }
  }, [selectedSwineInitial]);

  // Filtered swine dataset based on barangay scope
  const filteredSwineList = useMemo(() => {
    if (!isUserAdmin) {
      if (!userAssignedBarangay) return [];
      return swineList.filter(
        swine => (swine.barangay || '').toLowerCase() === userAssignedBarangay.toLowerCase()
      );
    }
    if (selectedBarangayScope === 'all') return swineList;
    return swineList.filter(
      s => (s.barangay || '').toLowerCase() === selectedBarangayScope.toLowerCase()
    );
  }, [isUserAdmin, swineList, selectedBarangayScope, userAssignedBarangay]);

  const biosecurityReportBarangays = useMemo(() => {
    if (!isUserAdmin) {
      return HINUNANGAN_BARANGAYS.filter(
        barangay => barangay.name.toLowerCase() === userAssignedBarangay.toLowerCase()
      );
    }
    if (selectedBarangayScope !== 'all') {
      return HINUNANGAN_BARANGAYS.filter(
        barangay => barangay.name.toLowerCase() === selectedBarangayScope.toLowerCase()
      );
    }
    return HINUNANGAN_BARANGAYS;
  }, [isUserAdmin, selectedBarangayScope, userAssignedBarangay]);

  // Aggregate Stats
  const totalRaisersCount = useMemo(() => {
    const set = new Set(filteredSwineList.map(s => s.farmerName));
    return set.size;
  }, [filteredSwineList]);

  const totalSwineHeads = useMemo(() => {
    return filteredSwineList.length;
  }, [filteredSwineList]);

  const totalWeightKg = useMemo(() => {
    return filteredSwineList.reduce((sum, s) => sum + (Number(s.weightKg) || 0), 0);
  }, [filteredSwineList]);

  const greenZoneCount = useMemo(() => {
    return filteredSwineList.filter(s => s.biosecurityStatus === 'COMPLIANT').length;
  }, [filteredSwineList]);

  // Filtered Archive
  const filteredArchive = useMemo(() => {
    if (!archiveSearchQuery.trim()) return issuedCertificates;
    const q = archiveSearchQuery.toLowerCase();
    return issuedCertificates.filter(
      c =>
        (c.certificateNo || '').toLowerCase().includes(q) ||
        (c.farmerName || '').toLowerCase().includes(q) ||
        (c.barangay || '').toLowerCase().includes(q) ||
        (c.buyerName || '').toLowerCase().includes(q) ||
        (c.orNumber || '').toLowerCase().includes(q)
    );
  }, [issuedCertificates, archiveSearchQuery]);

  // Column toggle helper
  const toggleColumn = (key: string) => {
    setColumns(prev =>
      prev.map(c => (c.key === key ? { ...c, visible: !c.visible } : c))
    );
  };

  const visibleColumnsCount = columns.filter(c => c.visible).length;

  const isColVisible = (key: string) => {
    const col = columns.find(c => c.key === key);
    return col ? col.visible : true;
  };

  // Reset Filters to pristine defaults
  const handleResetFilters = () => {
    setSelectedBarangayScope('all');
    setCroppingSeason('Wet Season (WS) 2026 (June – Dec)');
    setPaperSize('letter');
    setOrientation('portrait');
    setMargins('normal');
    setDensity('standard');
    setColumns(prev =>
      prev.map(c => ({ ...c, visible: c.key !== 'earTag' && c.key !== 'regDate' }))
    );
  };

  // Switch format template (supports dynamic template IDs and legacy styles)
  const handleSelectTemplate = (templateIdOrStyle: string) => {
    if (!templateIdOrStyle) return;
    const matched = templates.find(
      t => t.id === templateIdOrStyle ||
        t.id.toLowerCase().includes(templateIdOrStyle.toLowerCase()) ||
        (t.barangay || '').toLowerCase() === templateIdOrStyle.toLowerCase()
    );
    if (matched) {
      setArchivedTemplateOverride(null);
      setSelectedTemplateId(matched.id);
      setActiveCertData(prev => ({
        ...prev,
        templateId: matched.id,
        templateStyle: matched.id.includes('esperanza') ? 'nueva_esperanza' : matched.id.includes('tuburan') ? 'tuburan' : matched.id.includes('da') ? 'da_veterinary' : 'nava',
        barangay: matched.barangay,
        punongBarangay: matched.signatories?.find(s => s.position?.toLowerCase().includes('punong') || s.section === 'certified_by')?.name || prev.punongBarangay,
        bboName: matched.signatories?.find(s => s.position?.toLowerCase().includes('bbo') || s.section === 'noted_by')?.name || prev.bboName,
      }));
    }
  };

  // Execute Native Print
  const triggerScopedPrint = (target: string) => {
    try {
      printDocument(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the browser print dialog.';
      setExportNotice(message);
    }
  };

  const handleTriggerPrint = () => {
    if (!activeTemplate || !activeCertData.certificateNo || !activeCertData.farmerName) {
      setExportNotice('Only a saved, issued certificate with a matching template can be printed.');
      return;
    }
    triggerScopedPrint('certificate');
  };

  const handleExportPdf = async () => {
    const element = printableReportRef.current;
    if (!element || !activeTemplate || !activeCertData.certificateNo || !activeCertData.farmerName) {
      setExportNotice('Only a saved, issued certificate with a matching template can be downloaded.');
      return;
    }
    setIsExportingPdf(true);
    setExportNotice('Generating high-resolution official PDF document...');

    try {
      await downloadElementAsPdf(
        element,
        `DA-Hinunangan-Barangay-Certification-${activeCertData.barangay}-${Date.now()}.pdf`,
        { format: 'letter', orientation: 'portrait', marginMm: 10 }
      );

      setExportNotice('Official Certificate PDF downloaded successfully!');
      setTimeout(() => setExportNotice(null), 3500);
    } catch (err) {
      setExportNotice(err instanceof Error ? `Certificate PDF generation failed: ${err.message}` : 'Certificate PDF generation failed.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Export CSV Data
  const handleExportCsv = () => {
    const headers = [
      'RSBSA Number',
      'Family Name',
      'Given Name',
      'Middle Name',
      'Barangay',
      'Municipality',
      'Province',
      'Farmer Birthday',
      'Swine Date of Birth',
      'Age at Report Date',
      'Farm Location',
      'Latitude',
      'Longitude',
      'Head Count',
      'Breed',
      'Weight (kg)',
      'Farm Scale',
      'Biosecurity Status',
      'Ear Tag ID',
    ];

    const rows = filteredSwineList.map(s => {
      const { familyName, givenName, middleName } = parseFullName(s.farmerName);
      const rsbsa = getFormattedRsbsaId(s);
      const bday = getFarmerBirthday(s);
      const dobVal = s.birthDate || s.dateOfBirth || s.date_of_birth || s.dob;
      const dobFormatted = formatDobDisplay(dobVal);
      const ageAtReport = calculateSwineAge(dobVal, reportDateTo || undefined).display;
      return [
        rsbsa,
        familyName,
        givenName,
        middleName,
        s.barangay || '—',
        'Hinunangan',
        'Southern Leyte',
        bday,
        dobFormatted,
        ageAtReport,
        s.farmName || s.farmerAddress || '—',
        s.latitude,
        s.longitude,
        1,
        s.breed || '—',
        s.weightKg,
        s.farmScale || s.farmType || '—',
        s.biosecurityStatus || '—',
        s.earTagNo || '—',
      ].map(toCsvCell).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `DA-Hinunangan-Swine-Registry-Masterlist-${selectedBarangayScope}-${Date.now()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setExportNotice('CSV dataset exported successfully!');
    setTimeout(() => setExportNotice(null), 3000);
  };

  const handleCertificateIssuedFromModal = (cert: IssuedCertificate, printNow = false) => {
    setIssuedCertificates(previous => [cert, ...previous.filter(item => item.id !== cert.id)]);
    certificatesApi.getAll().then(setIssuedCertificates).catch(error => {
      setExportNotice(error instanceof Error ? error.message : 'Certificate was saved, but the archive could not be refreshed.');
    });
    setArchivedTemplateOverride(cert.templateSnapshot || null);
    if (cert.templateSnapshot) setSelectedTemplateId(cert.templateSnapshot.id);
    else if (cert.templateId) setSelectedTemplateId(cert.templateId);
    setActiveCertData({
      certificateNo: cert.certificateNo,
      templateId: cert.templateSnapshot?.id || cert.templateId,
      templateStyle: 'nava',
      barangay: cert.farmerBarangay || cert.issuingBarangay || '',
      farmerName: cert.farmerName,
      buyerName: cert.buyerName || '',
      destination: cert.destinationBarangay || cert.destinationMunicipality || '',
      numberOfHeads: cert.numberOfHeads ?? 0,
      orNumber: cert.orNumber || '',
      amountPaid: cert.amountPaid ?? '',
      issueDate: cert.issueDate,
      punongBarangay: cert.punongBarangay || cert.authorizedBy || '',
      bboName: cert.bboName || '',
    });
    setDocumentType('barangay_certification');
    setExportNotice(`Certificate #${cert.certificateNo} successfully issued and saved!`);
    setTimeout(() => setExportNotice(null), 3500);

    if (printNow) {
      setTimeout(() => {
        triggerScopedPrint('certificate');
      }, 400);
    }
  };

  const handleDeleteCertificate = async (certNo: string) => {
    if (confirm('Are you sure you want to delete this issued certificate record?')) {
      try {
        await certificatesApi.archive(certNo);
        setIssuedCertificates(await certificatesApi.getAll());
        setExportNotice('Certificate archived.');
        setTimeout(() => setExportNotice(null), 2500);
      } catch (error) {
        setExportNotice(error instanceof Error ? error.message : 'Unable to archive certificate.');
      }
    }
  };

  // Official Certificate Report dataset
  const officialReportRecords = useMemo(() => {
    let list = !isUserAdmin
      ? userAssignedBarangay
        ? issuedCertificates.filter(c =>
            (c.farmerBarangay || c.issuingBarangay || '').toLowerCase() === userAssignedBarangay.toLowerCase() ||
            (!!userBarangayId && c.barangay_id === userBarangayId)
          )
        : []
      : issuedCertificates;
    if (reportBarangayFilter && reportBarangayFilter !== 'all') {
      list = list.filter(
        c =>
          (c.farmerBarangay && c.farmerBarangay.toLowerCase() === reportBarangayFilter.toLowerCase()) ||
          (c.issuingBarangay && c.issuingBarangay.toLowerCase() === reportBarangayFilter.toLowerCase()) ||
          (c.barangay_id && c.barangay_id.toLowerCase() === reportBarangayFilter.toLowerCase())
      );
    }
    if (reportCertTypeFilter && reportCertTypeFilter !== 'all') {
      list = list.filter(
        c =>
          (c.certificateType || '').toLowerCase().includes(reportCertTypeFilter.toLowerCase()) ||
          (c.formatType || '').toLowerCase() === reportCertTypeFilter.toLowerCase()
      );
    }
    if (reportDateFrom) {
      list = list.filter(c => (c.issueDate || '') >= reportDateFrom);
    }
    if (reportDateTo) {
      list = list.filter(c => (c.issueDate || '') <= reportDateTo);
    }
    return list;
  }, [isUserAdmin, userAssignedBarangay, userBarangayId, reportBarangayFilter, reportCertTypeFilter, reportDateFrom, reportDateTo, issuedCertificates]);

  const reportTotalHeads = useMemo(() => {
    return officialReportRecords.reduce((sum, c) => sum + (Number(c.numberOfHeads) || 0), 0);
  }, [officialReportRecords]);

  const reportTotalAmount = useMemo(() => {
    return officialReportRecords.reduce((sum, c) => sum + (Number(c.amountPaid) || 0), 0);
  }, [officialReportRecords]);

  const handleExportOfficialReportCSV = () => {
    const headers = [
      '#',
      'Certificate No.',
      'Date Issued',
      'Certificate Type',
      'Hog Raiser / Farmer',
      'Barangay',
      'Swine Heads',
      'Buyer / Recipient',
      'Destination',
      'O.R. Number',
      'Amount Paid (PHP)',
      'Authorized Signatory',
      'Status',
    ];

    const rows = officialReportRecords.map((c, idx) => [
      idx + 1,
      c.certificateNo || '—',
      c.issueDate || '—',
      c.certificateType || '—',
      c.farmerName || '—',
      c.farmerBarangay || c.issuingBarangay || '—',
      c.numberOfHeads ?? '—',
      c.buyerName || '—',
      c.destinationBarangay || c.destinationMunicipality || '—',
      c.orNumber || '—',
      c.amountPaid ?? '—',
      c.punongBarangay || c.authorizedBy || '—',
      c.status || '—',
    ].map(toCsvCell));

    const csvContent = [headers.map(toCsvCell).join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `MAO-Hinunangan-Official-Certificates-Report-${reportBarangayFilter}-${Date.now()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setExportNotice('Official Certificate Report exported to CSV successfully!');
    setTimeout(() => setExportNotice(null), 3000);
  };

  const handleExportOfficialReportPdf = async () => {
    if (officialReportRecords.length === 0) {
      setExportNotice('No official certificates match the selected filters. Adjust the report filters before exporting.');
      return;
    }
    const element = officialReportPrintRef.current;
    if (!element) {
      setExportNotice('The official report is not available for PDF export.');
      return;
    }
    setIsExportingReportPdf(true);
    setExportNotice('Rendering official report into high-resolution PDF...');

    try {
      await downloadElementAsPdf(
        element,
        `MAO-Official-Certificate-Report-${reportBarangayFilter}-${Date.now()}.pdf`,
        { format: 'letter', orientation: 'landscape', marginMm: 8 }
      );

      setExportNotice('Official Certificate Report PDF generated and downloaded!');
      setTimeout(() => setExportNotice(null), 3500);
    } catch (err) {
      setExportNotice(err instanceof Error ? `Official report PDF generation failed: ${err.message}` : 'Official report PDF generation failed.');
    } finally {
      setIsExportingReportPdf(false);
    }
  };

  const handleExportBiosecurityPdf = async () => {
    const element = biosecurityReportRef.current;
    if (!element) {
      setExportNotice('The biosecurity report is not available for PDF export.');
      return;
    }
    setIsExportingReportPdf(true);
    try {
      await downloadElementAsPdf(
        element,
        `MAO-Biosecurity-Report-${selectedBarangayScope}-${Date.now()}.pdf`,
        { format: 'legal', orientation: 'landscape', marginMm: 8 }
      );
      setExportNotice('Biosecurity report PDF downloaded successfully.');
      setTimeout(() => setExportNotice(null), 3500);
    } catch (error) {
      setExportNotice(error instanceof Error ? `Biosecurity PDF generation failed: ${error.message}` : 'Biosecurity PDF generation failed.');
    } finally {
      setIsExportingReportPdf(false);
    }
  };

  const handleViewCertificate = (cert: IssuedCertificate) => {
    setArchivedTemplateOverride(cert.templateSnapshot || null);
    if (cert.templateSnapshot) {
      setSelectedTemplateId(cert.templateSnapshot.id);
    } else if (cert.templateId) {
      setSelectedTemplateId(cert.templateId);
    } else {
      setSelectedTemplateId('');
    }

    setActiveCertData({
      certificateNo: cert.certificateNo,
      templateId: cert.templateSnapshot?.id || cert.templateId,
      templateStyle: cert.farmerBarangay?.toLowerCase().includes('esperanza')
        ? 'nueva_esperanza'
        : cert.farmerBarangay?.toLowerCase().includes('tuburan')
        ? 'tuburan'
        : 'nava',
      barangay: cert.farmerBarangay || cert.issuingBarangay || '',
      farmerName: cert.farmerName,
      buyerName: cert.buyerName || '',
      destination: cert.destinationBarangay || cert.destinationMunicipality || '',
      numberOfHeads: cert.numberOfHeads ?? 0,
      orNumber: cert.orNumber || '',
      amountPaid: cert.amountPaid ?? '',
      issueDate: cert.issueDate,
      punongBarangay: cert.punongBarangay || cert.authorizedBy || '',
      bboName: cert.bboName || '',
    });
    setDocumentType('barangay_certification');
  };

  return (
    <div className="min-h-full bg-slate-100/80 text-stone-900 pb-16 relative selection:bg-emerald-200">
      {/* Toast Notification */}
      {exportNotice && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 border border-emerald-500/40 animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{exportNotice}</span>
        </div>
      )}

      {/* Main Top Header */}
      <div className="no-print bg-white border-b border-stone-200 px-6 py-4 shadow-2xs">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-2 sm:px-0">
          <div>
            <div className="text-[11px] font-bold tracking-widest text-slate-500 uppercase">
              MUNICIPALITY OF HINUNANGAN • PROVINCE OF SOUTHERN LEYTE
            </div>
            <h1 className="flex min-w-0 flex-wrap items-center gap-2 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">
              <span>Official Barangay Certification & Swine Registry</span>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                LGU Official
              </span>
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Create Certificate Main Button */}
            {documentType === 'barangay_certification' && (
              <button
                type="button"
                onClick={() => {
                  if (canManageTemplates) {
                    setEditingTemplate(undefined);
                    setIsTemplateEditorOpen(true);
                  } else {
                    setIsCreateCertModalOpen(true);
                  }
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-400 px-4 py-2 text-xs font-black text-slate-950 shadow-xs transition hover:bg-amber-300 cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>Create / Issue Certificate</span>
              </button>
            )}
            {documentType === 'barangay_certification' && canManageTemplates && (
              <button
                type="button"
                onClick={() => setIsCreateCertModalOpen(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-700 bg-emerald-700 px-4 py-2 text-xs font-black text-white shadow-xs transition hover:bg-emerald-800"
              >
                <FileCheck className="w-4 h-4" />
                <span>Issue Official Certificate</span>
              </button>
            )}

            <details className="relative">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">
                More actions <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 z-40 mt-1 w-[min(14rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl">
                <button
                  type="button"
                  onClick={event => {
                    setIsSignatoryModalOpen(true);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-stone-800 hover:bg-stone-50"
                >
                  <Edit3 className="h-4 w-4 text-stone-500" /> Edit signatories
                </button>
                <button
                  type="button"
                  disabled={!canManageActiveTemplate}
                  onClick={event => {
                    setIsLogoModalOpen(true);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sliders className="h-4 w-4 text-stone-500" /> Change logos & seals
                </button>
                <button
                  type="button"
                  onClick={event => {
                    window.open('/', '_blank');
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-stone-800 hover:bg-stone-50"
                >
                  <Globe className="h-4 w-4 text-stone-500" /> Public portal
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Document Type Selector Bar */}
      <div className="bg-white border-b border-stone-200 px-6 py-2.5 shadow-2xs">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-2 sm:px-0">
          {/* Document Types */}
          <div role="tablist" aria-label="Document workflows" className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto py-1">
            <span className="hidden shrink-0 text-[11px] font-black tracking-wider text-slate-600 uppercase mr-1 sm:inline">
              DOCUMENT:
            </span>

            {/* 1. Barangay Certification */}
            <button
              type="button"
              role="tab"
              aria-selected={documentType === 'barangay_certification'}
              onClick={() => setDocumentType('barangay_certification')}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold px-3.5 py-1.5 rounded-lg transition cursor-pointer border ${
                documentType === 'barangay_certification'
                  ? 'bg-blue-600 border-blue-600 text-white font-bold shadow-xs'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Barangay Certification (Official Format)</span>
            </button>

            {/* 2. Issued Archive */}
            <button
              type="button"
              role="tab"
              aria-selected={documentType === 'issued_archive'}
              onClick={() => setDocumentType('issued_archive')}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer border ${
                documentType === 'issued_archive'
                  ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold shadow-2xs'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Issued Archive ({issuedCertificates.length})</span>
            </button>

            {/* 3. Masterlist Registry */}
            <button
              type="button"
              role="tab"
              aria-selected={documentType === 'masterlist'}
              onClick={() => setDocumentType('masterlist')}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer border ${
                documentType === 'masterlist'
                  ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold shadow-2xs'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-blue-600" />
              <span>Masterlist Registry</span>
            </button>

            {/* 4. Transmittal Letter */}
            <button
              type="button"
              role="tab"
              aria-selected={documentType === 'transmittal'}
              onClick={() => setDocumentType('transmittal')}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer border ${
                documentType === 'transmittal'
                  ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold shadow-2xs'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <Send className="w-3.5 h-3.5 text-blue-600" />
              <span>Transmittal Letter</span>
            </button>

            {/* 5. Raisers Directory */}
            <button
              type="button"
              role="tab"
              aria-selected={documentType === 'directory'}
              onClick={() => setDocumentType('directory')}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer border ${
                documentType === 'directory'
                  ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold shadow-2xs'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 text-emerald-600" />
              <span>Raisers Directory</span>
            </button>

            {/* 6. Biosecurity & ASF Report */}
            <button
              type="button"
              role="tab"
              aria-selected={documentType === 'biosecurity_report'}
              onClick={() => setDocumentType('biosecurity_report')}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer border ${
                documentType === 'biosecurity_report'
                  ? 'bg-blue-50 border-blue-500 text-blue-800 font-bold shadow-2xs'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
              <span>Biosecurity Report</span>
            </button>

            {/* 7. Official Reports */}
            <button
              type="button"
              role="tab"
              aria-selected={documentType === 'official_reports'}
              onClick={() => setDocumentType('official_reports')}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer border ${
                documentType === 'official_reports'
                  ? 'bg-emerald-700 border-emerald-700 text-white font-bold shadow-xs'
                  : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Official Reports ({officialReportRecords.length})</span>
            </button>
          </div>

          {/* Right Tools: Columns Picker & Reset */}
          <div className="flex items-center gap-2 relative">
            {documentType === 'masterlist' && (
              <>
                <button
                  type="button"
                  onClick={() => setIsColumnPickerOpen(prev => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200 px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  <ColumnsIcon className="w-3.5 h-3.5" />
                  <span>Columns ({visibleColumnsCount}/{columns.length})</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                </button>

                {isColumnPickerOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-stone-200 rounded-2xl p-3 shadow-xl z-50 space-y-2 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                      <span className="text-xs font-bold text-stone-900">Configure Table Columns</span>
                      <button
                        type="button"
                        onClick={() => setIsColumnPickerOpen(false)}
                        className="p-1 rounded-lg text-stone-400 hover:text-stone-700 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1 text-xs">
                      {columns.map(col => (
                        <label
                          key={col.key}
                          className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-stone-700 select-none"
                        >
                          <input
                            type="checkbox"
                            checked={col.visible}
                            onChange={() => toggleColumn(col.key)}
                            className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                          />
                          <span className="text-xs font-medium">{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <button
              type="button"
              onClick={handleResetFilters}
              title="Reset all filters and settings"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-stone-200 transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Contextual Toolbar for Barangay Certification */}
      {documentType === 'barangay_certification' && (
        <div className="bg-slate-50 border-b border-stone-200 px-6 py-3 shadow-2xs no-print space-y-2.5">
          <div className="mx-auto flex max-w-[1400px] flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            {/* Search and Filters Bar */}
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1.5fr)_repeat(3,minmax(10rem,1fr))]">
              <div className="relative min-w-0">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={tplSearchQuery}
                  onChange={e => setTplSearchQuery(e.target.value)}
                  placeholder="Search templates (Nava, Bisaya, Tuburan, Gatepass...)"
                  aria-label="Search certificate templates"
                  className="min-h-11 w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-10 text-xs font-semibold text-slate-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {tplSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setTplSearchQuery('')}
                    aria-label="Clear template search"
                    className="absolute right-0 top-1/2 flex h-11 w-10 -translate-y-1/2 items-center justify-center text-stone-400 hover:text-stone-700"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Barangay Filter */}
              <select
                value={tplBarangayFilter}
                onChange={e => setTplBarangayFilter(e.target.value)}
                aria-label="Filter templates by barangay"
                className="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">All Barangays</option>
                {HINUNANGAN_BARANGAYS.map(b => (
                  <option key={b.code} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>

              <select
                value={tplDocTypeFilter}
                onChange={e => setTplDocTypeFilter(e.target.value)}
                aria-label="Filter templates by document type"
                className="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">All Certificate Types</option>
                {Array.from(new Set(templates.map(template => template.documentType).filter(Boolean)))
                  .sort((left, right) => left.localeCompare(right))
                  .map(documentType => (
                    <option key={documentType} value={documentType}>
                      {documentType}
                    </option>
                  ))}
              </select>

              {/* Language Filter */}
              <select
                value={tplLanguageFilter}
                onChange={e => setTplLanguageFilter(e.target.value)}
                aria-label="Filter templates by language"
                className="min-h-11 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">All Languages</option>
                <option value="english">English</option>
                <option value="bisaya">Bisaya Dialect</option>
                <option value="filipino">Filipino</option>
              </select>
            </div>

            {/* Quick Actions */}
            <div className="flex shrink-0 items-center gap-2">
              {(tplSearchQuery || tplBarangayFilter !== 'all' || tplDocTypeFilter !== 'all' || tplLanguageFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setTplSearchQuery('');
                    setTplBarangayFilter('all');
                    setTplDocTypeFilter('all');
                    setTplLanguageFilter('all');
                  }}
                  className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                >
                  Clear filters
                </button>
              )}
              <details className="relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">
                  Template actions <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </summary>
                <div className="absolute right-0 z-40 mt-1 w-[min(16rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl">
                  <button
                    type="button"
                    disabled={!canManageActiveTemplate || isLoadingTemplates}
                    onClick={event => {
                      setEditingTemplate(activeTemplate);
                      setIsTemplateEditorOpen(true);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sliders className="h-4 w-4 text-stone-500" /> Customize template & logos
                  </button>
                  <button
                    type="button"
                    disabled={!canManageTemplates || isLoadingTemplates}
                    onClick={event => {
                      setEditingTemplate(undefined);
                      setIsTemplateEditorOpen(true);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4 text-stone-500" /> Create new template
                  </button>
                </div>
              </details>
            </div>
          </div>

          {/* Dynamic Certificate Selector Control */}
          <div className="mx-auto flex max-w-[1400px] flex-col items-stretch justify-between gap-3 border-t border-stone-200/80 pt-2 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-700">
                <Layers className="w-4 h-4 text-blue-600" />
                CERTIFICATES ({templates.length}):
              </span>

              {/* Dynamic Combo Box / Dropdown Select */}
              <div className="relative w-full min-w-0 flex-1 sm:max-w-lg">
                <select
                  value={templateOptions.some(template => template.id === selectedTemplateId) ? selectedTemplateId : ''}
                  onChange={e => handleSelectTemplate(e.target.value)}
                  disabled={isLoadingTemplates || Boolean(templateLoadError) || templateOptions.length === 0}
                  title={activeTemplate?.name || 'Select a certificate template'}
                  className="min-h-11 w-full min-w-0 rounded-xl border-2 border-blue-500/60 bg-white py-1.5 pl-3 pr-8 text-xs font-bold text-slate-900 shadow-2xs focus:outline-none focus:ring-2 focus:ring-blue-600 cursor-pointer"
                >
                  {templateOptions.length === 0 && <option value="">No saved templates available</option>}
                  {templateOptions.map(tpl => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name} {tpl.id === selectedTemplateId && !filteredTemplates.some(item => item.id === tpl.id) ? '(current selection)' : ''} {tpl.barangay && tpl.barangay !== 'All' ? `(Brgy. ${tpl.barangay})` : ''} {tpl.isDefaultPreset ? '★' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {activeTemplate && (
                <p className="break-words text-xs font-semibold text-blue-900 sm:hidden">
                  Selected: {activeTemplate.name}
                </p>
              )}

              {/* Active Badge */}
              {activeTemplate && (
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-[11px] font-semibold text-blue-800">
                  <span className="font-bold">Format:</span>
                  <span className="capitalize">{(activeTemplate.layoutStyle || 'standard').replace(/_/g, ' ')}</span>
                  {activeTemplate.language && (
                    <span className="text-[10px] text-blue-600 bg-blue-100/80 px-1.5 py-0.5 rounded font-bold uppercase">
                      {activeTemplate.language}
                    </span>
                  )}
                </div>
              )}
              {!isLoadingTemplates && templateLoadError && (
                <div role="alert" className="flex flex-wrap items-center gap-3 text-xs text-rose-700 sm:col-span-2 xl:col-span-4">
                  <span>Template list could not be loaded: {templateLoadError}</span>
                  <button type="button" onClick={() => void loadTemplates()} className="min-h-10 rounded-lg border border-rose-300 px-3 font-bold hover:bg-rose-50">
                    Retry
                  </button>
                </div>
              )}
              {!isLoadingTemplates && !templateLoadError && templates.length === 0 && (
                <p role="status" className="text-xs text-amber-800 sm:col-span-2 xl:col-span-4">
                  No saved certificate templates are available. Create and save a template to enable preview and printing.
                </p>
              )}
              {isLoadingTemplates && (
                <p role="status" className="text-xs text-stone-600 sm:col-span-2 xl:col-span-4">
                  Loading saved certificate templates…
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Document Body Canvas */}
      <div className="mx-auto max-w-[1400px] px-3 pt-4 sm:px-6 sm:pt-6">
        {/* ========================================================================= */}
        {/* 1. BARANGAY CERTIFICATION VIEW */}
        {/* ========================================================================= */}
        {documentType === 'barangay_certification' && (
          <div className="space-y-6">
            <div className="flex flex-col justify-between gap-3 px-2 no-print sm:flex-row sm:items-center">
              <div>
                <h2 className="text-base font-bold tracking-tight text-slate-900">
                  Certificate preview
                </h2>
                <p className="text-xs text-slate-500">
                  {activeTemplate?.description || 'Review the official layout, seals, signatories, and certificate details before printing.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!activeTemplate || isLoadingTemplates || Boolean(templateLoadError)}
                  onClick={() => {
                    setEditingTemplate(activeTemplate);
                    setIsTemplateEditorOpen(true);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-bold text-purple-700 shadow-xs transition hover:bg-purple-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Layout / Logos</span>
                </button>

                <button
                  type="button"
                  onClick={handleTriggerPrint}
                  disabled={!activeTemplate || !activeCertData.certificateNo || !activeCertData.farmerName}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Document</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={isExportingPdf || !activeTemplate || !activeCertData.certificateNo || !activeCertData.farmerName}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:opacity-50"
                >
                  <FileText className="w-4 h-4" />
                  <span>Download PDF</span>
                </button>
              </div>
            </div>
            {(!activeTemplate || !activeCertData.certificateNo || !activeCertData.farmerName) && (
              <p className="no-print px-2 text-xs text-amber-800" role="status">
                Preview only. Save and issue the certificate before printing or downloading it.
              </p>
            )}

            {/* Render Authentic Certificate Container */}
            <div className="py-2">
              {activeTemplate ? (
                <BarangayCertificateView
                  data={activeCertData}
                  template={activeTemplate}
                  logoSettings={logoSettings}
                  containerRef={printableReportRef}
                />
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  The saved certificate template is unavailable, so this document cannot be previewed or printed.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 2. ISSUED CERTIFICATES ARCHIVE */}
        {/* ========================================================================= */}
        {documentType === 'issued_archive' && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-5">
            {!isUserAdmin && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center justify-between text-xs text-amber-900">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    <strong>Authorized Scope:</strong> Showing issued certificates for <strong>Barangay {userAssignedBarangay || 'Assigned Barangay'}</strong>. Cross-barangay access is restricted under municipal security policy.
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-950 font-black text-[10px] uppercase tracking-wider">
                  Focal Officer Mode
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
              <div>
                <h2 className="text-lg font-black text-slate-900">
                  Issued Barangay Certificates Archive
                </h2>
                <p className="text-xs text-stone-500">
                  Official registry of all generated clearances, receipts, and transit permits
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={archiveSearchQuery}
                    onChange={e => setArchiveSearchQuery(e.target.value)}
                    placeholder="Search by name, OR#, cert#..."
                    className="pl-9 pr-3 py-1.5 bg-slate-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setIsCreateCertModalOpen(true)}
                  className="px-4 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black rounded-xl text-xs flex items-center gap-1.5 shadow-2xs transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create Certificate</span>
                </button>
              </div>
            </div>

            {filteredArchive.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <FileText className="w-12 h-12 text-stone-300 mx-auto" />
                <p className="text-sm font-bold text-stone-600">No certificates found</p>
                <p className="text-xs text-stone-400 max-w-sm mx-auto">
                  Click &ldquo;Create / Issue Certificate&rdquo; to generate official certifications for registered hog raisers.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCreateCertModalOpen(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Issue First Certificate</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-stone-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                      <th className="py-2.5 px-3">Cert # / Date</th>
                      <th className="py-2.5 px-3">Farmer / Raiser</th>
                      <th className="py-2.5 px-3">Barangay</th>
                      <th className="py-2.5 px-3">Heads</th>
                      <th className="py-2.5 px-3">Buyer & Destination</th>
                      <th className="py-2.5 px-3">O.R. Number</th>
                      <th className="py-2.5 px-3">Issued By</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {filteredArchive.map(cert => (
                      <tr key={cert.certificateNo} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-3">
                          <span className="font-mono font-bold text-blue-700 block">
                            {cert.certificateNo || '—'}
                          </span>
                          <span className="text-[10px] text-stone-400">{cert.issueDate || '—'}</span>
                        </td>
                        <td className="py-3 px-3 font-bold text-slate-900 uppercase">
                          {cert.farmerName || '—'}
                        </td>
                        <td className="py-3 px-3 font-semibold text-slate-700">
                          {cert.farmerBarangay || cert.issuingBarangay || '—'}
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-black px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                            {cert.numberOfHeads ?? '—'} Heads
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-semibold text-slate-800 block">
                            {cert.buyerName || '—'}
                          </span>
                          <span className="text-[10px] text-stone-400">
                            {cert.destinationBarangay || cert.destinationMunicipality || '—'}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono font-semibold text-slate-800">
                          {cert.orNumber || '—'}
                        </td>
                        <td className="py-3 px-3 text-slate-700 font-semibold">
                          {cert.punongBarangay || cert.authorizedBy || '—'}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleViewCertificate(cert)}
                              title="View & Print Certificate"
                              aria-label={`View and print certificate ${cert.certificateNo}`}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-blue-50 p-1.5 font-bold text-blue-700 transition hover:bg-blue-100"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleEditCertificate(cert)}
                              title="Edit Certificate"
                              aria-label={`Edit certificate ${cert.certificateNo}`}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-amber-50 p-1.5 font-bold text-amber-700 transition hover:bg-amber-100"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setCertToDelete(cert)}
                              title="Delete Record"
                              aria-label={`Delete certificate ${cert.certificateNo}`}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-1.5 font-bold text-rose-600 transition hover:bg-rose-50"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* OFFICIAL CERTIFICATE ISSUANCE REPORT GENERATOR */}
        {/* ========================================================================= */}
        {documentType === 'official_reports' && (
          <div className="space-y-6">
            {/* Filter and Control Bar */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 no-print space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
                <div>
                  <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-emerald-600" />
                    <span>Official Certificate Issuance Report</span>
                  </h2>
                  <p className="text-xs text-stone-500">
                    Filter, audit, compile, and print verified certificate issuance records across Hinunangan.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => triggerScopedPrint('official-report')}
                    className="inline-flex items-center gap-2 text-xs font-bold text-slate-800 bg-stone-100 hover:bg-stone-200 border border-stone-300 px-3.5 py-2 rounded-xl transition cursor-pointer"
                  >
                    <Printer className="w-4 h-4 text-stone-600" />
                    <span>Print Report</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportOfficialReportCSV}
                    className="inline-flex items-center gap-2 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3.5 py-2 rounded-xl transition cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-emerald-600" />
                    <span>Export CSV</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportOfficialReportPdf}
                    disabled={isExportingReportPdf}
                    className="inline-flex items-center gap-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 px-4 py-2 rounded-xl transition cursor-pointer disabled:opacity-50"
                  >
                    <FileCheck className="w-4 h-4" />
                    <span>{isExportingReportPdf ? 'Generating PDF...' : 'Download Official PDF'}</span>
                  </button>
                </div>
              </div>

              {/* Filter Controls Row */}
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {/* Barangay Filter */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Barangay Jurisdiction
                  </label>
                  {isUserAdmin ? (
                    <select
                      value={reportBarangayFilter}
                      onChange={e => setReportBarangayFilter(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="all">All 40 Barangays (Municipal Scope)</option>
                      {HINUNANGAN_BARANGAYS.map(b => (
                        <option key={b.code} value={b.name}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-2 bg-slate-100 border border-stone-300 rounded-xl text-xs font-semibold text-slate-700 select-none">
                      <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Barangay {userAssignedBarangay || 'Assigned'} (Locked)</span>
                    </div>
                  )}
                </div>

                {/* Certificate Type Filter */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Certificate Type
                  </label>
                  <select
                    value={reportCertTypeFilter}
                    onChange={e => setReportCertTypeFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="all">All Certificate Types</option>
                    <option value="Barangay Certification">Barangay Certification</option>
                    <option value="Veterinary Health">Veterinary Health Certificate</option>
                    <option value="Biosecurity">Biosecurity Clearance</option>
                    <option value="Transit">Transit Permit / Shipping Clearance</option>
                  </select>
                </div>

                {/* Date From */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Date From
                  </label>
                  <input
                    type="date"
                    value={reportDateFrom}
                    onChange={e => setReportDateFrom(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Date To */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Date To
                  </label>
                  <input
                    type="date"
                    value={reportDateTo}
                    onChange={e => setReportDateTo(e.target.value)}
                    className="w-full px-3 py-1.5 bg-slate-50 border border-stone-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* Printable Document Wrapper */}
            <div
              ref={officialReportPrintRef}
              data-print-document="official-report"
              className="bg-white rounded-2xl border border-stone-300 p-8 sm:p-12 shadow-sm space-y-8 font-serif"
            >
              {/* Official Municipal Header */}
              <div className="flex items-center justify-between border-b-2 border-slate-900 pb-5">
                <div className="w-20 h-20 shrink-0 flex items-center justify-center">
                  <SealMunicipality className="w-18 h-18" />
                </div>

                <div className="text-center font-sans">
                  <div className="text-xs font-bold tracking-widest text-slate-600 uppercase">
                    Republic of the Philippines • Province of Southern Leyte
                  </div>
                  <div className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    Municipality of Hinunangan
                  </div>
                  <div className="text-sm font-bold text-emerald-800 uppercase tracking-wider mt-0.5">
                    Office of the Municipal Agriculturist
                  </div>
                  <div className="text-[10px] text-slate-500 italic mt-0.5">
                    Livestock & Swine Biosecurity Regulatory Services Division
                  </div>
                </div>

                <div className="w-20 h-20 shrink-0 flex items-center justify-center">
                  <SealDA className="w-18 h-18" />
                </div>
              </div>

              {/* Report Title & Metadata */}
              <div className="text-center space-y-1 font-sans">
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  Official Certificate Issuance & Clearance Summary
                </h3>
                <p className="text-xs text-slate-600">
                  Statutory audit and master record of authorized swine movement and biosecurity clearances
                </p>
                <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500 pt-2">
                  <span><strong>Scope:</strong> {reportBarangayFilter === 'all' ? 'All Municipal Barangays (40 Barangays)' : `Barangay ${reportBarangayFilter}`}</span>
                  <span>•</span>
                  <span><strong>Period:</strong> {reportDateFrom} to {reportDateTo}</span>
                  <span>•</span>
                  <span><strong>Generated:</strong> {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                </div>
              </div>

              {/* KPI Summary Strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-sans no-print">
                <div className="bg-slate-50 border border-stone-200 rounded-xl p-4 text-center">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Certificates Issued
                  </span>
                  <span className="text-2xl font-black text-slate-900">
                    {officialReportRecords.length}
                  </span>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                    Swine Heads Cleared
                  </span>
                  <span className="text-2xl font-black text-emerald-900">
                    {reportTotalHeads}
                  </span>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
                  <span className="text-[10px] font-bold text-blue-800 uppercase tracking-wider block">
                    Fees Collected
                  </span>
                  <span className="text-2xl font-black text-blue-900">
                    ₱{reportTotalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-center">
                  <span className="text-[10px] font-bold text-purple-800 uppercase tracking-wider block">
                    Jurisdiction Mode
                  </span>
                  <span className="text-xs font-bold text-purple-950 block mt-2">
                    {isUserAdmin ? 'Municipal Master Scope' : `Brgy. ${userAssignedBarangay} Focal`}
                  </span>
                </div>
              </div>

              {/* Report Records Table */}
              <div className="overflow-x-auto font-sans">
                <table className="w-full text-xs text-left border-collapse border border-stone-300">
                  <thead>
                    <tr className="bg-slate-100 border-b border-stone-300 text-slate-800 font-bold uppercase text-[10px] tracking-wider">
                      <th className="py-2.5 px-3 border-r border-stone-300 text-center w-10">#</th>
                      <th className="py-2.5 px-3 border-r border-stone-300">Cert # / Date</th>
                      <th className="py-2.5 px-3 border-r border-stone-300">Hog Raiser / Farmer</th>
                      <th className="py-2.5 px-3 border-r border-stone-300">Barangay</th>
                      <th className="py-2.5 px-3 border-r border-stone-300 text-center">Heads</th>
                      <th className="py-2.5 px-3 border-r border-stone-300">Buyer & Destination</th>
                      <th className="py-2.5 px-3 border-r border-stone-300">O.R. No. / Fee</th>
                      <th className="py-2.5 px-3">Authorized Signatory</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 text-stone-800">
                    {officialReportRecords.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400 italic">
                          No official certificates found matching the selected filters.
                        </td>
                      </tr>
                    ) : (
                      officialReportRecords.map((cert, idx) => (
                        <tr key={cert.certificateNo || idx} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 border-r border-stone-200 text-center text-stone-500 font-mono">
                            {idx + 1}
                          </td>
                          <td className="py-2 px-3 border-r border-stone-200">
                            <span className="font-mono font-bold text-blue-700 block">
                              {cert.certificateNo || '—'}
                            </span>
                            <span className="text-[10px] text-stone-400">{cert.issueDate || '—'}</span>
                          </td>
                          <td className="py-2 px-3 border-r border-stone-200 font-bold uppercase">
                            {cert.farmerName || '—'}
                          </td>
                          <td className="py-2 px-3 border-r border-stone-200">
                            {cert.farmerBarangay || cert.issuingBarangay || '—'}
                          </td>
                          <td className="py-2 px-3 border-r border-stone-200 text-center font-bold">
                            {cert.numberOfHeads ?? '—'}
                          </td>
                          <td className="py-2 px-3 border-r border-stone-200">
                            <span className="block font-medium">{cert.buyerName || '—'}</span>
                            <span className="text-[10px] text-stone-400 block">
                              {cert.destinationBarangay || cert.destinationMunicipality || '—'}
                            </span>
                          </td>
                          <td className="py-2 px-3 border-r border-stone-200 font-mono">
                            <span className="block font-semibold">O.R. #{cert.orNumber || '—'}</span>
                            <span className="text-[10px] text-emerald-700 font-bold block">
                              {cert.amountPaid == null ? '—' : `₱${Number(cert.amountPaid).toFixed(2)}`}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-semibold block">{cert.punongBarangay || cert.authorizedBy || '—'}</span>
                            <span className="text-[10px] text-stone-500 block">{cert.status || '—'}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Official Attestation & Signatories Block */}
              <div className="pt-8 border-t border-stone-300 font-sans space-y-8">
                <div className="text-xs text-stone-600 leading-relaxed text-justify">
                  <strong>OFFICIAL CERTIFICATION:</strong> I hereby certify that the above list of issued certificates and swine health clearances is true, accurate, and extracted directly from the verified database of the Municipal Agriculture Office and Barangay Biosecurity Registry of Hinunangan, Southern Leyte.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-4">
                  <div className="text-center space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">Prepared By:</div>
                    <div className="h-12 flex items-end justify-center">
                      <div className="font-bold text-xs text-slate-900 uppercase border-b border-stone-800 pb-1 w-4/5">
                        {preparedByName}
                      </div>
                    </div>
                    <div className="text-[10px] text-stone-600 font-medium">{preparedByTitle}</div>
                  </div>

                  <div className="text-center space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">Verified By:</div>
                    <div className="h-12 flex items-end justify-center">
                      <div className="font-bold text-xs text-slate-900 uppercase border-b border-stone-800 pb-1 w-4/5">
                        {verifiedByName}
                      </div>
                    </div>
                    <div className="text-[10px] text-stone-600 font-medium">{verifiedByTitle}</div>
                  </div>

                  <div className="text-center space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-stone-500">Approved By:</div>
                    <div className="h-12 flex items-end justify-center">
                      <div className="font-bold text-xs text-slate-900 uppercase border-b border-stone-800 pb-1 w-4/5">
                        {approvedByName}
                      </div>
                    </div>
                    <div className="text-[10px] text-stone-600 font-medium">{approvedByTitle}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-stone-400 border-t border-stone-100 pt-3">
                  <span>Document ID: MAO-CERT-REP-{Date.now().toString().slice(-6)}</span>
                  <span>Hinunangan Swine Registry System • Republic of the Philippines</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 3. MASTERLIST REGISTRY */}
        {/* ========================================================================= */}
        {documentType === 'masterlist' && (
          <div
            ref={printableReportRef}
            data-print-document="masterlist"
            className="bg-white rounded-xl border border-stone-300 p-6 sm:p-8 space-y-6 shadow-sm font-sans"
          >
            {/* Masterlist Official Header */}
            <div className="text-center space-y-1 border-b border-stone-200 pb-4">
              <div className="flex items-center justify-center gap-3 mb-2">
                <SealDA className="w-12 h-12" />
                <SealMunicipality className="w-12 h-12" />
                <SealBagongPilipinas className="w-12 h-12" />
              </div>
              <p className="text-xs font-semibold text-stone-600 uppercase">
                Republic of the Philippines • Department of Agriculture
              </p>
              <h2 className="text-base font-black uppercase text-stone-900 tracking-wide">
                OFFICE OF THE MUNICIPAL AGRICULTURAL SERVICES (OMAS)
              </h2>
              <p className="text-xs font-bold text-stone-700">
                Municipality of Hinunangan, Province of Southern Leyte
              </p>
              <h1 className="text-lg font-black text-blue-900 uppercase pt-1">
                MASTERLIST OF REGISTERED SWINE RAISERS & GIS BIOSECURITY AUDIT
              </h1>
              <p className="text-xs text-stone-500 font-semibold">
                Cropping Season: {croppingSeason} | Barangay Scope:{' '}
                {selectedBarangayScope === 'all' ? 'All 40 Barangays' : `Barangay ${selectedBarangayScope}`}
              </p>
            </div>

            {/* Summary KPI Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center bg-slate-50 p-3 rounded-xl border border-stone-200">
              <div>
                <span className="text-[10px] uppercase font-bold text-stone-500 block">Total Raisers</span>
                <span className="text-base font-black text-slate-900">{totalRaisersCount}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-stone-500 block">Swine Heads</span>
                <span className="text-base font-black text-blue-700">{totalSwineHeads}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-stone-500 block">Estimated Biomass</span>
                <span className="text-base font-black text-emerald-700">{totalWeightKg.toLocaleString()} kg</span>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-stone-500 block">Biosecurity Rating</span>
                <span className="text-base font-black text-purple-700">
                  {greenZoneCount} compliant
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse border border-stone-300">
                <thead>
                  <tr className="bg-slate-100 border-b border-stone-300 text-slate-800 font-black uppercase text-[10px]">
                    <th className="border border-stone-300 p-2">#</th>
                    {isColVisible('rsbsa') && <th className="border border-stone-300 p-2">RSBSA ID</th>}
                    {isColVisible('name') && <th className="border border-stone-300 p-2">Farmer Full Name</th>}
                    {isColVisible('address') && <th className="border border-stone-300 p-2">Barangay</th>}
                    {isColVisible('birthday') && <th className="border border-stone-300 p-2">Farmer Birthday</th>}
                    {isColVisible('swineDob') && <th className="border border-stone-300 p-2">Date of Birth</th>}
                    {isColVisible('swineAge') && <th className="border border-stone-300 p-2">Age at Report Date</th>}
                    {isColVisible('heads') && <th className="border border-stone-300 p-2">Heads</th>}
                    {isColVisible('breed') && <th className="border border-stone-300 p-2">Breed</th>}
                    {isColVisible('weight') && <th className="border border-stone-300 p-2">Weight (kg)</th>}
                    {isColVisible('farmType') && <th className="border border-stone-300 p-2">Scale</th>}
                    {isColVisible('biosecurity') && <th className="border border-stone-300 p-2">Biosecurity</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredSwineList.map((swine, idx) => (
                    <tr key={swine.id} className={idx % 2 === 1 ? 'bg-slate-50/50' : 'bg-white'}>
                      <td className="border border-stone-300 p-2 text-stone-500 font-mono text-center">
                        {idx + 1}
                      </td>
                      {isColVisible('rsbsa') && (
                        <td className="border border-stone-300 p-2 font-mono text-blue-700 font-semibold">
                          {getFormattedRsbsaId(swine)}
                        </td>
                      )}
                      {isColVisible('name') && (
                        <td className="border border-stone-300 p-2 font-bold text-slate-900 uppercase">
                          {swine.farmerName}
                        </td>
                      )}
                      {isColVisible('address') && (
                        <td className="border border-stone-300 p-2 font-medium">
                          {swine.barangay || '—'}
                        </td>
                      )}
                      {isColVisible('birthday') && (
                        <td className="border border-stone-300 p-2 text-stone-600 font-mono">
                          {getFarmerBirthday(swine)}
                        </td>
                      )}
                      {isColVisible('swineDob') && (
                        <td className="border border-stone-300 p-2 text-stone-700 font-mono text-[10px]">
                          {formatDobDisplay(swine.birthDate || swine.dateOfBirth || swine.date_of_birth || swine.dob)}
                        </td>
                      )}
                      {isColVisible('swineAge') && (
                        <td className="border border-stone-300 p-2 font-bold text-emerald-950">
                          {calculateSwineAge(swine.birthDate || swine.dateOfBirth || swine.date_of_birth || swine.dob, reportDateTo || undefined).display}
                        </td>
                      )}
                      {isColVisible('heads') && (
                        <td className="border border-stone-300 p-2 text-center font-bold">1</td>
                      )}
                      {isColVisible('breed') && (
                        <td className="border border-stone-300 p-2">{swine.breed || '—'}</td>
                      )}
                      {isColVisible('weight') && (
                        <td className="border border-stone-300 p-2 text-center">{swine.weightKg ?? '—'}</td>
                      )}
                      {isColVisible('farmType') && (
                        <td className="border border-stone-300 p-2 uppercase text-[10px] font-semibold">
                          {swine.farmScale || swine.farmType || '—'}
                        </td>
                      )}
                      {isColVisible('biosecurity') && (
                        <td className="border border-stone-300 p-2 text-center">
                          <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700 font-bold text-[10px]">
                            {swine.biosecurityStatus || 'Not recorded'}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Signatures */}
            <div className="pt-8 grid grid-cols-3 gap-6 text-center text-xs">
              <div>
                <p className="text-stone-500 font-semibold mb-6">Prepared by:</p>
                <div className="border-b border-black font-bold uppercase pb-1">{preparedByName}</div>
                <p className="text-[10px] text-stone-600 font-semibold pt-0.5">{preparedByTitle}</p>
              </div>

              <div>
                <p className="text-stone-500 font-semibold mb-6">Verified by:</p>
                <div className="border-b border-black font-bold uppercase pb-1">{verifiedByName}</div>
                <p className="text-[10px] text-stone-600 font-semibold pt-0.5">{verifiedByTitle}</p>
              </div>

              <div>
                <p className="text-stone-500 font-semibold mb-6">Approved by:</p>
                <div className="border-b border-black font-bold uppercase pb-1">{approvedByName}</div>
                <p className="text-[10px] text-stone-600 font-semibold pt-0.5">{approvedByTitle}</p>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* 4. TRANSMITTAL LETTER */}
        {/* ========================================================================= */}
        {documentType === 'transmittal' && (
          <TransmittalLetterManager
            currentUser={currentUser}
            onNotice={msg => {
              setExportNotice(msg);
              setTimeout(() => setExportNotice(null), 3500);
            }}
          />
        )}

        {/* ========================================================================= */}
        {/* 5. RAISERS DIRECTORY & BIOSECURITY REPORT VIEWS */}
        {/* ========================================================================= */}
        {documentType === 'directory' && (
          <div className="bg-white rounded-xl border border-stone-300 p-6 space-y-4 shadow-sm font-sans">
            <h2 className="text-base font-black text-slate-900 uppercase">
              Hinunangan Swine Raisers Directory
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredSwineList.map(swine => (
                <div
                  key={swine.id}
                  className="p-3.5 rounded-xl border border-stone-200 bg-slate-50 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] font-bold text-blue-700">
                      {getFormattedRsbsaId(swine)}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {swine.status || '—'}
                    </span>
                  </div>
                  <h4 className="font-bold text-xs text-slate-900 uppercase">{swine.farmerName}</h4>
                  <p className="text-[11px] text-slate-600">
                    📍 Barangay {swine.barangay || '—'}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    🐷 {swine.breed || '—'} • {swine.weightKg ?? '—'} kg
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {documentType === 'biosecurity_report' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 no-print">
              <div>
                <h2 className="text-base font-black text-slate-900 uppercase">
                  Municipal Biosecurity & ASF Compliance Audit
                </h2>
                <p className="text-xs text-stone-500">
                  Comprehensive 40-Barangay audit report for BABay ASF / BAI standards
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerScopedPrint('biosecurity-report')}
                  className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Print Report</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportBiosecurityPdf}
                  disabled={isExportingReportPdf}
                  className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 transition cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>{isExportingReportPdf ? 'Generating PDF...' : 'Download PDF'}</span>
                </button>
              </div>
            </div>

            <div
              ref={biosecurityReportRef}
              data-print-document="biosecurity-report"
              className="bg-white rounded-xl border border-stone-300 p-6 sm:p-8 space-y-6 shadow-sm font-sans"
            >
              {/* Header */}
              <div className="text-center space-y-1 border-b border-stone-200 pb-4">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <SealDA className="w-12 h-12" />
                  <SealMunicipality className="w-12 h-12" />
                  <SealBagongPilipinas className="w-12 h-12" />
                </div>
                <p className="text-xs font-semibold text-stone-600 uppercase">
                  Republic of the Philippines • Department of Agriculture • Region VIII
                </p>
                <h2 className="text-base font-black uppercase text-stone-900 tracking-wide">
                  OFFICE OF THE MUNICIPAL AGRICULTURIST
                </h2>
                <p className="text-xs font-bold text-stone-700">
                  Municipality of Hinunangan, Province of Southern Leyte
                </p>
                <h1 className="text-lg font-black text-emerald-900 uppercase pt-1">
                  OFFICIAL BIOSECURITY AUDIT & ASF SURVEILLANCE COMPLIANCE REPORT
                </h1>
                <p className="text-xs text-stone-500 font-semibold">
                  Coverage: {selectedBarangayScope === 'all' ? 'All listed barangays' : `Barangay ${selectedBarangayScope}`} • Based on saved registry records
                </p>
              </div>

              {/* Status Banner */}
              <div className="bg-emerald-50 border border-emerald-300 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-stone-900 uppercase">
                    Biosecurity data summary
                  </h3>
                  <p className="text-xs text-stone-700 mt-0.5">
                    {greenZoneCount} of {totalSwineHeads} visible registered records are marked compliant. This report does not infer area-wide ASF status.
                  </p>
                </div>
                <div className="bg-stone-100 text-stone-800 font-black text-xs px-3.5 py-1.5 rounded-lg shadow-2xs">
                  Saved status only
                </div>
              </div>

              {/* 40 Barangays Audit Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse border border-stone-300">
                  <thead>
                    <tr className="bg-slate-100 border-b border-stone-300 font-black uppercase text-[10px] text-slate-800">
                      <th className="border border-stone-300 p-2">#</th>
                      <th className="border border-stone-300 p-2">Barangay</th>
                      <th className="border border-stone-300 p-2 text-center">Registered Farms</th>
                      <th className="border border-stone-300 p-2 text-center">Audited Farms</th>
                      <th className="border border-stone-300 p-2 text-center">Footbath / Disinfection</th>
                      <th className="border border-stone-300 p-2 text-center">Setback Compliance</th>
                      <th className="border border-stone-300 p-2 text-center">Zoning Classification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {biosecurityReportBarangays.map((b, idx) => {
                      const records = filteredSwineList.filter(
                        s => (s.barangay || '').toLowerCase() === b.name.toLowerCase()
                      );
                      const auditedRecords = records.filter(
                        s => s.biosecurityStatus != null || s.biosecurityScore != null
                      );
                      const footbathCount = auditedRecords.filter(s => s.biosecurity?.footbathInstalled).length;
                      const setbackRecords = records.filter(s => typeof s.setbackCompliant === 'boolean');
                      const setbackPassCount = setbackRecords.filter(s => s.setbackCompliant).length;
                      const zoneCounts = records.reduce<Record<string, number>>((counts, record) => {
                        if (record.asfZone) counts[record.asfZone] = (counts[record.asfZone] || 0) + 1;
                        return counts;
                      }, {});
                      const zones = Object.entries(zoneCounts)
                        .map(([zone, count]) => `${zone} (${count})`)
                        .join(', ');
                      return (
                        <tr key={b.id} className={idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'}>
                          <td className="border border-stone-300 p-2 text-stone-500 font-mono text-center">
                            {idx + 1}
                          </td>
                          <td className="border border-stone-300 p-2 font-bold uppercase text-slate-900">
                            {b.name}
                          </td>
                          <td className="border border-stone-300 p-2 text-center font-semibold">
                            {records.length}
                          </td>
                          <td className="border border-stone-300 p-2 text-center font-semibold text-blue-700">
                            {auditedRecords.length || '—'}
                          </td>
                          <td className="border border-stone-300 p-2 text-center font-bold">
                            {auditedRecords.length ? `${footbathCount}/${auditedRecords.length} recorded` : 'Not recorded'}
                          </td>
                          <td className="border border-stone-300 p-2 text-center font-semibold">
                            {setbackRecords.length ? `${setbackPassCount}/${setbackRecords.length} pass` : 'Not recorded'}
                          </td>
                          <td className="border border-stone-300 p-2 text-center">
                            {zones || 'Not recorded'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Official Signatures */}
              <div className="pt-8 grid grid-cols-3 gap-6 text-center text-xs">
                <div>
                  <p className="text-stone-500 font-semibold mb-6">Prepared by:</p>
                  <div className="border-b border-black font-bold uppercase pb-1">{preparedByName}</div>
                  <p className="text-[10px] text-stone-600 font-semibold pt-0.5">{preparedByTitle}</p>
                </div>

                <div>
                  <p className="text-stone-500 font-semibold mb-6">Verified by:</p>
                  <div className="border-b border-black font-bold uppercase pb-1">{verifiedByName}</div>
                  <p className="text-[10px] text-stone-600 font-semibold pt-0.5">{verifiedByTitle}</p>
                </div>

                <div>
                  <p className="text-stone-500 font-semibold mb-6">Approved by:</p>
                  <div className="border-b border-black font-bold uppercase pb-1">{approvedByName}</div>
                  <p className="text-[10px] text-stone-600 font-semibold pt-0.5">{approvedByTitle}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dynamic Certificate Template Editor & Customizer Modal */}
      {isTemplateEditorOpen && (
        <CertificateTemplateEditor
          initialTemplate={editingTemplate}
          userRole={currentUser?.role}
          assignedBarangay={userAssignedBarangay}
          onClose={() => setIsTemplateEditorOpen(false)}
          onSave={async savedTemplate => {
            const persisted = await moduleDataApi.save<CertificateTemplate>('certificate_templates', savedTemplate);
            setTemplates(previous => [persisted, ...previous.filter(template => template.id !== persisted.id)]);
            setSelectedTemplateId(persisted.id);
            setLatestSavedTemplate(persisted);
            setIsTemplateEditorOpen(false);
            setExportNotice(`Template "${persisted.name}" saved successfully!`);
            setTimeout(() => setExportNotice(null), 3500);
            void loadTemplates();
            return persisted;
          }}
        />
      )}

      {/* Logo & Seal Customizer Modal */}
      <CertificateLogoCustomizer
        isOpen={isLogoModalOpen}
        onClose={() => {
          setLogoSettings(activeTemplate?.logoSettings || DEFAULT_CERTIFICATE_LOGO_SETTINGS);
          setIsLogoModalOpen(false);
        }}
        settings={logoSettings}
        onChange={updated => setLogoSettings(updated)}
        onSave={async updated => {
          if (!activeTemplate || !canManageActiveTemplate) {
            throw new Error('Select a certificate template within your authorized scope before saving logo settings.');
          }
          const persisted = await moduleDataApi.save<CertificateTemplate>('certificate_templates', {
            ...activeTemplate,
            logoSettings: updated,
          });
          setTemplates(previous => [persisted, ...previous.filter(template => template.id !== persisted.id)]);
          setSelectedTemplateId(persisted.id);
          setLatestSavedTemplate(persisted);
          setLogoSettings(persisted.logoSettings || updated);
          setIsLogoModalOpen(false);
          setExportNotice(`Logo settings for "${persisted.name}" saved successfully.`);
          setTimeout(() => setExportNotice(null), 3500);
          void loadTemplates();
        }}
      />

      {/* Create / Edit Certificate Modal */}
      <CreateCertificateModal
        isOpen={isCreateCertModalOpen}
        onClose={() => {
          setIsCreateCertModalOpen(false);
          setCertificateToEdit(null);
        }}
        swineList={filteredSwineList}
        barangays={barangays}
        currentUser={currentUser}
        onCertificateIssued={handleCertificateIssuedFromModal}
        canCreateTemplate={canManageTemplates}
        onCreateTemplate={() => {
          setEditingTemplate(undefined);
          setIsTemplateEditorOpen(true);
        }}
        latestSavedTemplate={latestSavedTemplate}
        initialData={certificateToEdit || {
          barangay: activeCertData.barangay,
          farmerName: activeCertData.farmerName,
          buyerName: activeCertData.buyerName,
          destination: activeCertData.destination,
          numberOfHeads: activeCertData.numberOfHeads,
        }}
      />

      {/* Signatories Edit Modal */}
      {isSignatoryModalOpen && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white max-w-2xl w-full rounded-2xl p-6 shadow-2xl border border-stone-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-700" />
                <h3 className="text-base font-black text-slate-900">
                  Edit Signatories & Official Parameters
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSignatoryModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={e => {
                e.preventDefault();
                setIsSignatoryModalOpen(false);
                setExportNotice('Signatories and document headers updated successfully!');
                setTimeout(() => setExportNotice(null), 3000);
              }}
              className="space-y-4 text-xs"
            >
              <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-stone-200">
                <span className="font-extrabold text-slate-800 uppercase">
                  1. Prepared by (Field Operator / BBO)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Officer Name
                    </label>
                    <input
                      type="text"
                      value={preparedByName}
                      onChange={e => setPreparedByName(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Official Position Title
                    </label>
                    <input
                      type="text"
                      value={preparedByTitle}
                      onChange={e => setPreparedByTitle(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-stone-200">
                <span className="font-extrabold text-slate-800 uppercase">
                  2. Verified by (Municipal Agriculturist)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      MAO Officer Name
                    </label>
                    <input
                      type="text"
                      value={verifiedByName}
                      onChange={e => setVerifiedByName(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Official Position Title
                    </label>
                    <input
                      type="text"
                      value={verifiedByTitle}
                      onChange={e => setVerifiedByTitle(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-stone-200">
                <span className="font-extrabold text-slate-800 uppercase">
                  3. Approved by (Municipal Mayor)
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Mayor / Executive Name
                    </label>
                    <input
                      type="text"
                      value={approvedByName}
                      onChange={e => setApprovedByName(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">
                      Official Position Title
                    </label>
                    <input
                      type="text"
                      value={approvedByTitle}
                      onChange={e => setApprovedByTitle(e.target.value)}
                      className="w-full bg-white border border-stone-300 rounded-lg p-2 font-bold text-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSignatoryModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-stone-600 hover:bg-stone-100 font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold cursor-pointer shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Certificate Confirmation Modal */}
      {certToDelete && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 shadow-2xl border border-rose-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900">Delete Issued Certificate?</h3>
                <p className="text-xs text-slate-500">This action will remove the archived certificate from the registry.</p>
              </div>
            </div>

            <div className="bg-slate-50 p-3.5 rounded-xl border border-stone-200 text-xs space-y-1">
              <p className="font-bold text-slate-800">
                Cert No: <span className="font-mono text-blue-700">{certToDelete.certificateNo}</span>
              </p>
              <p className="font-semibold text-slate-700">
                Farmer: <span className="uppercase">{certToDelete.farmerName}</span>
              </p>
              <p className="text-slate-500">
                Barangay: {certToDelete.farmerBarangay || certToDelete.issuingBarangay || 'N/A'} • OR No: {certToDelete.orNumber || 'N/A'}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCertToDelete(null)}
                className="px-4 py-2 rounded-xl text-stone-600 hover:bg-stone-100 font-bold text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDeleteCertificate(certToDelete.certificateNo);
                  setCertToDelete(null);
                }}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs cursor-pointer shadow-sm"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Security Access Denied Modal */}
      {accessDeniedMessage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-rose-200 shadow-2xl max-w-md w-full p-6 text-center space-y-4 animate-in zoom-in-95">
            <div className="w-16 h-16 rounded-2xl bg-rose-100 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto shadow-inner">
              <ShieldAlert className="w-9 h-9" />
            </div>
            <div>
              <span className="text-[11px] font-black uppercase tracking-widest text-rose-600 block mb-1">
                Security Restriction • 403 Forbidden
              </span>
              <h3 className="text-lg font-black text-slate-900">
                Barangay Jurisdiction Access Denied
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {accessDeniedMessage}
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 rounded-xl border border-stone-200 text-[11px] text-slate-600 text-left leading-relaxed">
              <strong>Official Notice:</strong> Under Hinunangan Municipal Ordinance No. 2025-59, Barangay Focal Officers are strictly restricted to accessing records of their assigned barangay. Cross-barangay registry inspections are strictly reserved for Municipal Agriculture Administrators.
            </div>
            <button
              type="button"
              onClick={() => setAccessDeniedMessage(null)}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition cursor-pointer shadow-sm"
            >
              Acknowledge & Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};