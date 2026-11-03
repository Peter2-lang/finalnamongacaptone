import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  ArrowUpDown,
  Printer,
  Edit,
  Trash2,
  Archive,
  ArchiveRestore,
  CheckCircle,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  Plus,
  Sparkles,
  ShoppingBag,
  Upload,
  Image as ImageIcon,
  Save,
  Eye,
  Columns,
  Layers,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  X,
  MapPin,
  SlidersHorizontal,
  AlertCircle,
  AlertTriangle,
  Lock,
  Calendar,
  Scale,
  Shield,
  Phone,
  User,
  Tag,
  RotateCw,
  Database,
} from 'lucide-react';
import {
  Barangay,
  RegistryFormField,
  RegistryFormSchema,
  SwineRecord,
  SwineType,
  FarmScale,
  ASFZone,
  UserAccount,
  UserRole,
  FarmerSelection,
} from '../../types';
import { storageService } from '../../services/storageService';
import { mediaApi } from '../../services/api';
import { ImportSwineModal } from './ImportSwineModal';
import {
  ActiveFieldItem,
  formatFieldValue,
  getAllActiveFields,
  getFieldValue,
  matchRecordSearch,
} from '../../utils/registryFieldUtils';
import { printDocument } from '../../utils/printUtils';
import {
  calculateSwineAge,
  formatDobDisplay,
  getEstimatedWeightRange,
  classifyFarmScale,
  getBarangayASFZone,
  shouldShowASFWarning,
} from '../../utils/swineRegistryLogic';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Highlights text segments that match the search query in real time
 */
const HighlightMatch: React.FC<{ text: string | null | undefined; query: string }> = ({
  text,
  query,
}) => {
  if (!text) return null;
  if (!query || !query.trim()) return <>{text}</>;

  const trimmedQuery = query.trim();
  const escaped = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-amber-200 text-amber-950 font-bold px-0.5 rounded-xs"
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
};

const SwinePhoto: React.FC<{ src?: string; className: string }> = ({ src, className }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = src && !/^data:/i.test(src) ? src : null;

  useEffect(() => {
    setImageFailed(false);
  }, [src]);

  return (
    <div className={`${className} relative flex items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-stone-100 text-stone-400`}>
      {imageSrc && !imageFailed ? (
        <img
          src={imageSrc}
          alt="Swine"
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <ImageIcon className="h-5 w-5" aria-label="Swine photo unavailable" />
      )}
    </div>
  );
};

interface PigsRecordsProps {
  swineList: SwineRecord[];
  barangays: Barangay[];
  currentUser: UserAccount | null;
  currentRole: UserRole;
  onEditSwine: (swine: SwineRecord) => void;
  onIssueCertificate: (swine: SwineRecord) => void;
  onAddSwine: (farmer?: FarmerSelection) => void;
  onRefresh: () => void;
  onViewOnMap?: (swine: SwineRecord) => void;
  initialViewingRecordId?: string | null;
}

type EnhancedSwineRecord = SwineRecord & {
  computedPigId: string;
  computedAgeYears: number;
  computedAgeMonths: number;
  computedAgeDays: number;
  computedTotalDays: number;
  computedTotalMonths: number;
  computedAgeLabel: string;
  computedHasDob: boolean;
  computedDobFormatted: string;
  computedEstimatedWeight: string;
  computedActualWeight: number | string | null;
  computedFarmScale: FarmScale;
  computedAsfZone: ASFZone;
  computedHasWarning: boolean;
  computedIsReady: boolean;
};

type SwineRecordAction =
  | 'view'
  | 'farmer'
  | 'map'
  | 'print'
  | 'certificate'
  | 'edit'
  | 'ready'
  | 'sold'
  | 'archive'
  | 'delete';

const getFarmerGroupKey = (record: SwineRecord): string => {
  if (record.farmerId) return `farmer:${record.farmerId}`;
  const normalize = (value: string | undefined) => (value || '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  const rsbsa = normalize(record.rsbsaId);
  if (rsbsa) return `rsbsa:${rsbsa}`;
  const name = normalize(record.farmerName);
  if (!name) return `record:${record.id}`;
  const contact = (record.farmerContact || '').replace(/\D/g, '');
  return `profile:${name}|${normalize(record.farmName)}|${normalize(record.farmerAddress)}|${normalize(record.barangay)}|${contact}`;
};

export const PigsRecords: React.FC<PigsRecordsProps> = ({
  swineList,
  barangays,
  currentUser,
  currentRole,
  onEditSwine,
  onIssueCertificate,
  onAddSwine,
  onRefresh,
  onViewOnMap,
  initialViewingRecordId,
}) => {
  const { t, getSwineTypeLabel, getFarmScaleLabel, getAsfZoneLabel, getStatusLabel } = useLanguage();

  // Schema configuration state
  const [formSchema, setFormSchema] = useState<RegistryFormSchema>(() =>
    storageService.getRegistryFormSchema()
  );

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [searchScope, setSearchScope] = useState<'all' | 'tag' | 'owner'>('all');
  const [selectedBarangay, setSelectedBarangay] = useState<string>(
    currentRole === 'focal' && currentUser?.assignedBarangay ? currentUser.assignedBarangay : 'all'
  );
  const [swineTypeFilter, setSwineTypeFilter] = useState<string>('all');
  const [farmScaleFilter, setFarmScaleFilter] = useState<string>('all');
  const [asfZoneFilter, setAsfZoneFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [biosecurityFilter, setBiosecurityFilter] = useState<'all' | 'warning' | 'no_warning'>('all');
  const [readyFilter, setReadyFilter] = useState<'all' | 'ready' | 'not_ready'>('all');
  const [ageFilter, setAgeFilter] = useState<'all' | 'under_1m' | '1_3m' | '4_6m' | '7_12m' | 'over_1y'>('all');
  const [registeredFrom, setRegisteredFrom] = useState('');
  const [registeredTo, setRegisteredTo] = useState('');
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Sorting State
  const [sortFieldKey, setSortFieldKey] = useState<string>('registeredAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Column Picker Management
  const [visibleColumnIds, setVisibleColumnIds] = useState<Record<string, boolean>>({});
  const [showColumnPicker, setShowColumnPicker] = useState<boolean>(false);

  // Modals & Selection
  const [viewingRecord, setViewingRecord] = useState<SwineRecord | null>(null);
  const [expandedFarmerKey, setExpandedFarmerKey] = useState<string | null>(null);
  const [deleteConfirmRecord, setDeleteConfirmRecord] = useState<SwineRecord | null>(null);
  const [printSingleRecord, setPrintSingleRecord] = useState<SwineRecord | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState<boolean>(false);
  const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
  const [bulkActionNotice, setBulkActionNotice] = useState<string>('');

  // Database Connection & Query States
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(false);
  const [isRefreshingDb, setIsRefreshingDb] = useState<boolean>(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string>('');
  const moreActionsRef = useRef<HTMLDetailsElement>(null);
  const [mobileActionMenuRecordId, setMobileActionMenuRecordId] = useState<string | null>(null);
  const mobileActionTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const closeMenuOnOutsideClick = (event: PointerEvent) => {
      if (moreActionsRef.current && !moreActionsRef.current.contains(event.target as Node)) {
        moreActionsRef.current.open = false;
      }
      if (!(event.target instanceof Element) || !event.target.closest('[data-record-actions]')) {
        setMobileActionMenuRecordId(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && moreActionsRef.current?.open) {
        moreActionsRef.current.open = false;
        moreActionsRef.current.querySelector('summary')?.focus();
      }
      if (event.key === 'Escape' && mobileActionMenuRecordId) {
        setMobileActionMenuRecordId(null);
        mobileActionTriggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', closeMenuOnOutsideClick);
    document.addEventListener('keydown', closeMenuOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenuOnOutsideClick);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [mobileActionMenuRecordId]);

  useEffect(() => {
    document.body.classList.add('records-view-active');
    return () => document.body.classList.remove('records-view-active');
  }, []);

  const handleFetchFromDatabase = async (isManual = false) => {
    if (isManual) {
      setIsRefreshingDb(true);
      setRefreshNotice('Fetching latest records...');
    } else {
      setIsLoadingDb(true);
    }
    setDbError(null);

    try {
      const { total } = await storageService.fetchSwineRecords({
        barangay: currentRole === 'focal' && currentUser?.assignedBarangay ? currentUser.assignedBarangay : undefined,
      });
      onRefresh();
      if (isManual) {
        setRefreshNotice(`${total} records loaded`);
        setTimeout(() => setRefreshNotice(''), 3500);
      }
    } catch (err: any) {
      console.error('Failed to load swine records from database:', err);
      setDbError(err.message || 'Unable to load Swine Records. The system could not retrieve records from the database.');
    } finally {
      setIsLoadingDb(false);
      setIsRefreshingDb(false);
    }
  };

  // Automatically fetch records directly from the database on component mount
  useEffect(() => {
    handleFetchFromDatabase(false);
  }, [currentRole, currentUser?.assignedBarangay]);

  // Keep selectedRecordIds synchronized with swineList
  useEffect(() => {
    setSelectedRecordIds(prev => {
      if (prev.size === 0) return prev;
      const validIds = new Set(swineList.map(s => s.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach(id => {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [swineList]);

  useEffect(() => {
    if (initialViewingRecordId) {
      const found = swineList.find(
        s => s.id === initialViewingRecordId || s.pigIdTag === initialViewingRecordId
      );
      if (found) {
        setViewingRecord(found);
      }
    }
  }, [initialViewingRecordId, swineList]);

  // Table Print & Import States
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [importFileType, setImportFileType] = useState<'csv' | 'xlsx' | 'all'>('all');
  const [showPrintSelectModal, setShowPrintSelectModal] = useState<boolean>(false);
  const [printSelectedColumnIds, setPrintSelectedColumnIds] = useState<Record<string, boolean>>({});
  const [printValidationError, setPrintValidationError] = useState<string | null>(null);
  const [activePrintColumns, setActivePrintColumns] = useState<ActiveFieldItem[]>([]);
  const [printRecordScope, setPrintRecordScope] = useState<'all' | 'selected'>('all');
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string>('');

  const triggerScopedPrint = (target: 'swine-record' | 'registry-report') => {
    try {
      printDocument(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the browser print dialog.';
      setPrintValidationError(message);
      window.alert(message);
    }
  };

  // Logo customization for Official Print Report
  const [reportLeftLogo, setReportLeftLogo] = useState<string>('/icon.svg');
  const [reportRightLogo, setReportRightLogo] = useState<string>('/icon.svg');
  const [showLogoCustomizer, setShowLogoCustomizer] = useState<boolean>(false);
  const [logoSaveSuccess, setLogoSaveSuccess] = useState<boolean>(false);

  // Sync Schema Changes
  useEffect(() => {
    const handleSchemaChange = (e: Event) => {
      const customEvent = e as CustomEvent<RegistryFormSchema>;
      if (customEvent.detail) {
        setFormSchema(customEvent.detail);
      } else {
        setFormSchema(storageService.getRegistryFormSchema());
      }
    };
    window.addEventListener('da_registry_schema_change', handleSchemaChange);
    return () => window.removeEventListener('da_registry_schema_change', handleSchemaChange);
  }, []);

  // Load Certificate Config Logos
  useEffect(() => {
    try {
      const certConf = storageService.getCertificateConfig();
      if (certConf.daLogoUrl) setReportLeftLogo(certConf.daLogoUrl);
      if (certConf.lguLogoUrl) setReportRightLogo(certConf.lguLogoUrl);
    } catch {
      // ignore
    }
  }, []);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchTerm,
    searchScope,
    selectedBarangay,
    swineTypeFilter,
    farmScaleFilter,
    asfZoneFilter,
    statusFilter,
    biosecurityFilter,
    readyFilter,
    ageFilter,
    registeredFrom,
    registeredTo,
    showArchived,
  ]);

  // Active Fields from Schema
  const activeFields: ActiveFieldItem[] = useMemo(() => {
    return getAllActiveFields(formSchema);
  }, [formSchema]);

  // Handle Logo Save
  const handleSaveReportLogos = () => {
    try {
      const currentConf = storageService.getCertificateConfig();
      storageService.saveCertificateConfig({
        ...currentConf,
        daLogoUrl: reportLeftLogo,
        lguLogoUrl: reportRightLogo,
      });
      setLogoSaveSuccess(true);
      setTimeout(() => setLogoSaveSuccess(false), 2000);
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, position: 'left' | 'right') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const asset = await mediaApi.uploadFile(file, 'report-logos');
      if (position === 'left') {
        setReportLeftLogo(asset.fileUrl);
      } else {
        setReportRightLogo(asset.fileUrl);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to upload report logo to Supabase Storage.');
    }
  };

  const toggleColumnVisibility = (fieldId: string) => {
    setVisibleColumnIds(prev => ({
      ...prev,
      [fieldId]: prev[fieldId] === false ? true : false,
    }));
  };

  const resetColumnsToDefault = () => {
    setVisibleColumnIds({});
  };

  // Pre-calculate derived fields for every swine record to ensure reactive accuracy
  const enhancedSwineList = useMemo<EnhancedSwineRecord[]>(() => {
    return swineList.map(s => {
      const pigId = s.pigIdTag || s.earTagNo || 'HIN-2026-0000';
      const effectiveDob = s.birthDate || s.dateOfBirth || s.date_of_birth || s.dob;
      const age = calculateSwineAge(effectiveDob);
      const safeDays = age.isValid ? age.totalDays : (s.ageDays || 0);
      const safeMonths = age.isValid ? age.totalMonths : (s.ageMonths || 0);
      const estimatedWeightRange = getEstimatedWeightRange(safeDays);
      const actualWeight = s.actualWeightKg !== undefined && s.actualWeightKg !== null ? s.actualWeightKg : (s.weightKg || null);
      const currentFarmScale = s.farmScale || classifyFarmScale(s.penCapacity || (s.farmType === 'commercial' ? 50 : 5));
      const currentAsfZone = getBarangayASFZone(s.barangay, barangays);
      const hasBiosecurityWarning = shouldShowASFWarning(s.swineType, currentAsfZone);
      const isReadyToSell = s.readyToSell || s.status === 'ready_to_sell';

      return {
        ...s,
        birthDate: effectiveDob,
        computedPigId: pigId,
        computedAgeYears: age.years,
        computedAgeMonths: age.months,
        computedAgeDays: age.days,
        computedTotalDays: age.totalDays,
        computedTotalMonths: age.totalMonths,
        computedAgeLabel: age.display,
        computedHasDob: age.hasDob && age.isValid,
        computedDobFormatted: formatDobDisplay(effectiveDob),
        computedEstimatedWeight: estimatedWeightRange,
        computedActualWeight: actualWeight,
        computedFarmScale: currentFarmScale,
        computedAsfZone: currentAsfZone,
        computedHasWarning: hasBiosecurityWarning,
        computedIsReady: isReadyToSell,
      };
    });
  }, [swineList, barangays]);

  // Filtering
  const filtered = useMemo<EnhancedSwineRecord[]>(() => {
    return enhancedSwineList.filter(s => {
      // Role scope filter
      const itemBg = (s.barangay || '').toLowerCase();
      if (currentRole === 'focal' && currentUser?.assignedBarangay) {
        if (itemBg !== (currentUser.assignedBarangay || '').toLowerCase()) {
          return false;
        }
      } else if (selectedBarangay !== 'all') {
        if (itemBg !== (selectedBarangay || '').toLowerCase()) return false;
      }

      // Active vs Archived
      if (showArchived) {
        if (!s.isArchived) return false;
      } else {
        if (s.isArchived) return false;
      }

      // Swine Type Filter
      if (swineTypeFilter !== 'all') {
        const typeNormalized = (s.swineType || '').toLowerCase();
        if (swineTypeFilter === 'boar' && typeNormalized !== 'boar' && typeNormalized !== 'breeding_boar') return false;
        if (swineTypeFilter === 'sow' && typeNormalized !== 'sow' && typeNormalized !== 'breeding_sow') return false;
        if (swineTypeFilter === 'piglet' && typeNormalized !== 'piglet') return false;
        if (swineTypeFilter === 'grower' && typeNormalized !== 'grower') return false;
        if (swineTypeFilter === 'finisher' && typeNormalized !== 'finisher') return false;
      }

      // Farm Scale Filter
      if (farmScaleFilter !== 'all' && s.computedFarmScale !== farmScaleFilter) {
        return false;
      }

      // ASF Zone Filter
      if (asfZoneFilter !== 'all' && s.computedAsfZone !== asfZoneFilter) {
        return false;
      }

      // Status Filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'ready' && !s.computedIsReady) return false;
        if (statusFilter === 'sold' && s.status !== 'sold') return false;
        if (statusFilter === 'active' && (s.status === 'sold' || s.isArchived)) return false;
        if (statusFilter === 'quarantined' && s.status !== 'quarantined') return false;
        if (statusFilter === 'sick' && s.status !== 'sick') return false;
      }

      // Biosecurity Warning Filter
      if (biosecurityFilter === 'warning' && !s.computedHasWarning) return false;
      if (biosecurityFilter === 'no_warning' && s.computedHasWarning) return false;

      // Ready to Sell Quick Filter
      if (readyFilter === 'ready' && !s.computedIsReady) return false;
      if (readyFilter === 'not_ready' && s.computedIsReady) return false;

      // Age Dynamic Filter (Calculated from DOB / Current Date)
      if (ageFilter !== 'all') {
        if (!s.computedHasDob) return false;
        const tm = s.computedTotalMonths;
        if (ageFilter === 'under_1m' && tm !== 0) return false;
        if (ageFilter === '1_3m' && (tm < 1 || tm > 3)) return false;
        if (ageFilter === '4_6m' && (tm < 4 || tm > 6)) return false;
        if (ageFilter === '7_12m' && (tm < 7 || tm > 12)) return false;
        if (ageFilter === 'over_1y' && tm <= 12) return false;
      }

      const registeredDate = String(s.registeredAt || '').slice(0, 10);
      if (registeredFrom && (!registeredDate || registeredDate < registeredFrom)) return false;
      if (registeredTo && (!registeredDate || registeredDate > registeredTo)) return false;

      // Real-time Search Filter: Tag ID, Owner Name, Barangay, Swine Type, Status
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const qClean = q.replace(/[^a-z0-9]/gi, '');

        // Tag ID matching (Pig ID Tag & Ear Tag No)
        const pigIdRaw = (s.computedPigId || '').toLowerCase();
        const earTagRaw = (s.earTagNo || '').toLowerCase();
        const explicitPigId = (s.pigIdTag || '').toLowerCase();
        const pigIdClean = pigIdRaw.replace(/[^a-z0-9]/gi, '');
        const earTagClean = earTagRaw.replace(/[^a-z0-9]/gi, '');
        const explicitPigIdClean = explicitPigId.replace(/[^a-z0-9]/gi, '');

        const matchesTagId =
          pigIdRaw.includes(q) ||
          earTagRaw.includes(q) ||
          explicitPigId.includes(q) ||
          (qClean.length > 0 &&
            (pigIdClean.includes(qClean) ||
              earTagClean.includes(qClean) ||
              explicitPigIdClean.includes(qClean)));

        // Owner Name matching (Farmer Name, Farm Name, RSBSA ID, Contact)
        const farmerRaw = (s.farmerName || '').toLowerCase();
        const farmRaw = (s.farmName || '').toLowerCase();
        const rsbsaRaw = (s.rsbsaId || '').toLowerCase();
        const contactRaw = (s.farmerContact || '').toLowerCase();

        const matchesOwner =
          farmerRaw.includes(q) ||
          farmRaw.includes(q) ||
          rsbsaRaw.includes(q) ||
          contactRaw.includes(q);

        // General / Secondary matching
        const matchesBarangay = (s.barangay || '').toLowerCase().includes(q);
        const matchesType = (s.swineType || '').toLowerCase().includes(q);
        const matchesStatus = (s.status || '').toLowerCase().includes(q);
        const matchesCustom = matchRecordSearch(s, q, activeFields);

        if (searchScope === 'tag') {
          if (!matchesTagId) return false;
        } else if (searchScope === 'owner') {
          if (!matchesOwner) return false;
        } else {
          // 'all' mode: matches Tag ID OR Owner Name OR Barangay/Type/Status/Custom
          if (
            !matchesTagId &&
            !matchesOwner &&
            !matchesBarangay &&
            !matchesType &&
            !matchesStatus &&
            !matchesCustom
          ) {
            return false;
          }
        }
      }

      return true;
    });
  }, [
    enhancedSwineList,
    selectedBarangay,
    currentRole,
    currentUser,
    showArchived,
    swineTypeFilter,
    farmScaleFilter,
    asfZoneFilter,
    statusFilter,
    biosecurityFilter,
    readyFilter,
    ageFilter,
    registeredFrom,
    registeredTo,
    searchTerm,
    searchScope,
    activeFields,
  ]);

  // Sorting
  const sortedRecords = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      let valA: any;
      let valB: any;

      if (sortFieldKey === 'registeredAt') {
        valA = new Date(a.registeredAt).getTime();
        valB = new Date(b.registeredAt).getTime();
      } else if (sortFieldKey === 'pigIdTag') {
        valA = a.computedPigId || '';
        valB = b.computedPigId || '';
      } else if (sortFieldKey === 'birthDate') {
        valA = a.birthDate ? new Date(a.birthDate).getTime() : 0;
        valB = b.birthDate ? new Date(b.birthDate).getTime() : 0;
      } else if (sortFieldKey === 'age') {
        valA = a.computedTotalDays || 0;
        valB = b.computedTotalDays || 0;
      } else if (sortFieldKey === 'breed') {
        valA = a.breed || '';
        valB = b.breed || '';
      } else if (sortFieldKey === 'gender' || sortFieldKey === 'sex') {
        valA = a.gender || '';
        valB = b.gender || '';
      } else if (sortFieldKey === 'estimatedWeight') {
        valA = a.computedEstimatedWeight;
        valB = b.computedEstimatedWeight;
      } else if (sortFieldKey === 'actualWeight') {
        valA = Number(a.computedActualWeight) || 0;
        valB = Number(b.computedActualWeight) || 0;
      } else if (sortFieldKey === 'farmerName') {
        valA = a.farmerName || '';
        valB = b.farmerName || '';
      } else if (sortFieldKey === 'barangay') {
        valA = a.barangay || '';
        valB = b.barangay || '';
      } else if (sortFieldKey === 'swineType') {
        valA = a.swineType || '';
        valB = b.swineType || '';
      } else if (sortFieldKey === 'farmScale') {
        valA = a.computedFarmScale || '';
        valB = b.computedFarmScale || '';
      } else if (sortFieldKey === 'asfZone') {
        valA = a.computedAsfZone || '';
        valB = b.computedAsfZone || '';
      } else if (sortFieldKey === 'status') {
        valA = a.status || '';
        valB = b.status || '';
      } else {
        const matched = activeFields.find(f => f.field.id === sortFieldKey || f.fieldKey === sortFieldKey);
        if (matched) {
          valA = getFieldValue(a, matched.field);
          valB = getFieldValue(b, matched.field);
        } else {
          valA = (a as any)[sortFieldKey];
          valB = (b as any)[sortFieldKey];
        }
      }

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      let cmp = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        cmp = valA - valB;
      } else {
        cmp = String(valA).localeCompare(String(valB));
      }

      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortFieldKey, sortOrder, activeFields]);

  const selectedFilteredRecords = useMemo(
    () => sortedRecords.filter(record => selectedRecordIds.has(record.id)),
    [selectedRecordIds, sortedRecords]
  );
  const registryPrintRecords = printRecordScope === 'selected'
    ? selectedFilteredRecords
    : sortedRecords;

  const farmerGroups = useMemo(() => {
    const groups = new Map<string, { farmer: FarmerSelection; records: EnhancedSwineRecord[] }>();

    sortedRecords.forEach(record => {
      const key = getFarmerGroupKey(record);
      const group = groups.get(key);

      if (group) {
        group.records.push(record);
      } else {
        groups.set(key, {
          farmer: {
            id: record.farmerId,
            farmerName: record.farmerName,
            farmerContact: record.farmerContact,
            farmerAddress: record.farmerAddress,
            barangay: record.barangay,
            farmName: record.farmName,
            rsbsaId: record.rsbsaId,
          },
          records: [record],
        });
      }
    });

    return [...groups.entries()];
  }, [sortedRecords]);

  const groupByKey = useMemo(() => new Map(farmerGroups), [farmerGroups]);
  const totalFarmerGroups = farmerGroups.length;

  // Paginate farmers, keeping each farmer and all matching swine together.
  const totalRecords = sortedRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalFarmerGroups / pageSize));
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFarmerGroups);
  const paginatedFarmerGroups = farmerGroups.slice(startIndex, endIndex);
  const paginatedRecords = paginatedFarmerGroups.flatMap(([, group]) => group.records);
  const paginatedFarmerRepresentatives = paginatedFarmerGroups.map(([, group]) => group.records[0]);
  const startRecordIndex =
    totalRecords === 0
      ? 0
      : farmerGroups.slice(0, startIndex).reduce((total, [, group]) => total + group.records.length, 0) + 1;
  const endRecordIndex =
    totalRecords === 0
      ? 0
      : farmerGroups.slice(0, endIndex).reduce((total, [, group]) => total + group.records.length, 0);
  const activeFilterCount = [
    searchTerm.trim().length > 0,
    searchScope !== 'all',
    selectedBarangay !== (currentRole === 'focal' && currentUser?.assignedBarangay ? currentUser.assignedBarangay : 'all'),
    swineTypeFilter !== 'all',
    farmScaleFilter !== 'all',
    asfZoneFilter !== 'all',
    statusFilter !== 'all',
    biosecurityFilter !== 'all',
    readyFilter !== 'all',
    ageFilter !== 'all',
    registeredFrom !== '',
    registeredTo !== '',
    showArchived,
  ].filter(Boolean).length;

  useEffect(() => {
    if (searchTerm.trim()) {
      const query = searchTerm.toLowerCase().trim();
      const queryClean = query.replace(/[^a-z0-9]/gi, '');
      const taggedRecord = sortedRecords.find(record => {
        const tags = [record.computedPigId, record.pigIdTag, record.earTagNo];
        return tags.some(tag => {
          const raw = (tag || '').toLowerCase();
          const clean = raw.replace(/[^a-z0-9]/gi, '');
          return raw.includes(query) ||
            (queryClean.length >= 4 && clean.includes(queryClean) && (/^hin/i.test(query) || /^\d{4,}$/.test(queryClean)));
        });
      });
      if (taggedRecord) {
        const group = farmerGroups.find(([, entry]) => entry.records.some(record => record.id === taggedRecord.id));
        if (group) setExpandedFarmerKey(group[0]);
      }
    }

    if (expandedFarmerKey && !groupByKey.has(expandedFarmerKey)) {
      setExpandedFarmerKey(null);
    }
  }, [searchTerm, sortedRecords, farmerGroups, groupByKey, expandedFarmerKey]);

  // Handlers
  const handleConfirmDelete = async () => {
    if (!deleteConfirmRecord) return;
    try {
      await storageService.deleteSwineRecordCloud(deleteConfirmRecord.id);
    } catch (err: any) {
      console.warn('Cloud delete notice:', err?.message || err);
    }
    setDeleteConfirmRecord(null);
    onRefresh();
  };

  // Bulk Selection & Deletion Helpers (Admin)
  const isAllCurrentPageSelected =
    paginatedRecords.length > 0 && paginatedRecords.every(r => selectedRecordIds.has(r.id));
  const isSomeCurrentPageSelected = paginatedRecords.some(r => selectedRecordIds.has(r.id));

  const handleToggleSelectRecord = (id: string) => {
    setSelectedRecordIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectFarmer = (records: SwineRecord[]) => {
    setSelectedRecordIds(previous => {
      const next = new Set(previous);
      const allSelected = records.length > 0 && records.every(record => next.has(record.id));
      records.forEach(record => {
        if (allSelected) next.delete(record.id);
        else next.add(record.id);
      });
      return next;
    });
  };

  const handleToggleSelectAllCurrentPage = () => {
    if (isAllCurrentPageSelected) {
      setSelectedRecordIds(prev => {
        const next = new Set(prev);
        paginatedRecords.forEach(r => next.delete(r.id));
        return next;
      });
    } else {
      setSelectedRecordIds(prev => {
        const next = new Set(prev);
        paginatedRecords.forEach(r => next.add(r.id));
        return next;
      });
    }
  };

  const handleSelectAllFiltered = () => {
    setSelectedRecordIds(new Set(sortedRecords.map(r => r.id)));
  };

  const handleSelectVisiblePage = () => {
    setSelectedRecordIds(new Set(paginatedRecords.map(record => record.id)));
  };

  const handleClearSelection = () => {
    setSelectedRecordIds(new Set());
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedRecordIds.size === 0) return;
    const idsToDelete: string[] = Array.from(selectedRecordIds);
    try {
      await storageService.deleteSwineRecordsCloud(idsToDelete);
    } catch (err: any) {
      console.warn('Cloud bulk delete notice:', err?.message || err);
    }
    setSelectedRecordIds(new Set());
    setShowBulkDeleteModal(false);
    setBulkActionNotice(
      `Successfully deleted ${idsToDelete.length} swine record${idsToDelete.length === 1 ? '' : 's'}.`
    );
    onRefresh();

    setTimeout(() => {
      setBulkActionNotice('');
    }, 5000);
  };

  const selectedRecordsList = useMemo(() => {
    return swineList.filter(s => selectedRecordIds.has(s.id));
  }, [swineList, selectedRecordIds]);

  const handleToggleSell = (swine: SwineRecord) => {
    const nextState = !swine.readyToSell;
    storageService.toggleSellStatus(swine.id, nextState);
    onRefresh();
  };

  const handleMarkSold = (swine: SwineRecord) => {
    storageService.markAsSold(swine.id);
    onRefresh();
  };

  const handleToggleArchive = (id: string) => {
    storageService.toggleArchiveStatus(id);
    onRefresh();
  };

  const performRecordAction = (
    action: SwineRecordAction,
    swine: SwineRecord,
    farmerKey: string
  ) => {
    if (action === 'view') setViewingRecord(swine);
    else if (action === 'farmer') {
      const nextExpandedKey = expandedFarmerKey === farmerKey ? null : farmerKey;
      setExpandedFarmerKey(nextExpandedKey);
      if (nextExpandedKey) {
        document.getElementById(`mobile-farmer-group-${encodeURIComponent(farmerKey)}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
    else if (action === 'map' && onViewOnMap) onViewOnMap(swine);
    else if (action === 'print') setPrintSingleRecord(swine);
    else if (action === 'certificate') onIssueCertificate(swine);
    else if (action === 'edit' && currentRole !== 'agent') onEditSwine(swine);
    else if (action === 'ready' && currentRole !== 'agent' && swine.status !== 'sold') handleToggleSell(swine);
    else if (action === 'sold' && currentRole !== 'agent' && swine.status !== 'sold') handleMarkSold(swine);
    else if (action === 'archive' && currentRole !== 'agent') handleToggleArchive(swine.id);
    else if (action === 'delete' && currentRole === 'admin') setDeleteConfirmRecord(swine);
    setMobileActionMenuRecordId(null);
  };

  const renderExpandedFarmerRow = (farmerKey: string, rowId: string) => {
    const group = groupByKey.get(farmerKey);
    if (!group) return null;
    const panelId = `farmer-swines-${rowId}`;

    return (
      <tr key={`${rowId}-farmer-swines`} id={panelId}>
        <td
          colSpan={(currentRole === 'admin' ? 16 : 15) + customDynamicColumns.length}
          className="border-b border-stone-200 bg-stone-50 px-5 py-3"
        >
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wide text-stone-600">
              Swine registered to {group.farmer.farmerName} ({group.records.length} swine)
            </h4>
            {group.records.map(record => {
              const registeredAt = new Date(record.registeredAt);
              const gender = record.gender || record.sex;
              const sexLabel = gender === 'male'
                ? 'Male (Intact)'
                : gender === 'female'
                  ? 'Female (Gilt/Sow)'
                  : gender === 'castrated'
                    ? 'Castrated'
                    : 'Sex not recorded';
              const selected = selectedRecordIds.has(record.id);

              return (
                <article
                  key={record.id}
                  className={`rounded-xl border p-3 shadow-2xs ${
                    selected ? 'border-amber-300 bg-amber-50/70' : 'border-stone-200 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    {currentRole === 'admin' && (
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => handleToggleSelectRecord(record.id)}
                        className="h-4 w-4 rounded border-stone-300 accent-emerald-700"
                        aria-label={`Select swine record ${record.computedPigId || record.earTagNo || record.id}`}
                      />
                    )}
                    <SwinePhoto src={record.photoUrl} className="h-12 w-12 shrink-0" />
                    <div className="min-w-[190px] flex-1 space-y-0.5">
                      <p className="font-mono text-xs font-black text-emerald-950">
                        <Lock className="mr-1 inline h-3 w-3 text-stone-400" />
                        {record.computedPigId || record.pigIdTag || record.earTagNo}
                      </p>
                      <p className="text-[10px] text-stone-500">
                        {Number.isNaN(registeredAt.getTime())
                          ? 'Registration date unavailable'
                          : `Reg: ${registeredAt.toLocaleDateString()}`}
                        <span className="ml-2">{record.isSynced === false ? '· Pending Sync' : '· Synced'}</span>
                      </p>
                      <p className="text-xs font-semibold text-stone-800">{record.breed || record.swineType || 'Breed not recorded'}</p>
                      <p className="text-[11px] text-stone-600">
                        {sexLabel} · Brgy. {record.barangay || 'Not recorded'} · DOB: {record.birthDate ? formatDobDisplay(record.birthDate) : 'Not recorded'} · Age: {record.computedAgeLabel || 'Unavailable'}
                      </p>
                      <p className="text-[10px] text-stone-500">
                        Status: {getStatusLabel(record.status)} · Type: {getSwineTypeLabel(record.swineType)} · Est. weight: {record.computedEstimatedWeight || '—'} · Actual weight: {record.computedActualWeight ? `${record.computedActualWeight} kg` : '—'}
                      </p>
                      <p className="text-[10px] text-stone-500">
                        Farm scale: {getFarmScaleLabel(record.computedFarmScale)} · ASF zone: {record.computedAsfZone || getBarangayASFZone(record.barangay || '')} · Biosecurity: {record.computedHasWarning ? 'Warning' : 'No warning'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:ml-auto">
                      <label className="sr-only" htmlFor={`farmer-record-actions-${record.id}`}>
                        Actions for {record.computedPigId || record.pigIdTag || record.earTagNo}
                      </label>
                      <select
                        id={`farmer-record-actions-${record.id}`}
                        defaultValue=""
                        onChange={event => {
                          const action = event.currentTarget.value;
                          event.currentTarget.selectedIndex = 0;
                          if (action === 'view') setViewingRecord(record);
                          else if (action === 'map' && onViewOnMap) onViewOnMap(record);
                          else if (action === 'print') setPrintSingleRecord(record);
                          else if (action === 'certificate') onIssueCertificate(record);
                          else if (action === 'edit' && currentRole !== 'agent') onEditSwine(record);
                          else if (action === 'ready' && currentRole !== 'agent' && record.status !== 'sold') handleToggleSell(record);
                          else if (action === 'sold' && currentRole !== 'agent' && record.status !== 'sold') handleMarkSold(record);
                          else if (action === 'archive' && currentRole !== 'agent') handleToggleArchive(record.id);
                          else if (action === 'delete' && currentRole === 'admin') setDeleteConfirmRecord(record);
                        }}
                        className="min-h-11 w-full max-w-44 rounded-lg border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-800 focus-visible:outline-2 focus-visible:outline-emerald-700"
                      >
                        <option value="" disabled>Record actions</option>
                        <optgroup label="Record">
                          <option value="view">View details</option>
                          {currentRole !== 'agent' && <option value="edit">Edit record</option>}
                        </optgroup>
                        {onViewOnMap && <optgroup label="Location"><option value="map">View on GIS map</option></optgroup>}
                        <optgroup label="Documents">
                          <option value="print">Print swine record</option>
                          <option value="certificate">Generate certificate</option>
                        </optgroup>
                        {currentRole !== 'agent' && <optgroup label="Record status">
                          {record.status !== 'sold' && <>
                            <option value="ready">{record.readyToSell ? 'Remove ready to sell' : 'Mark ready to sell'}</option>
                            <option value="sold">Mark as sold</option>
                          </>}
                          <option value="archive">{record.isArchived ? 'Restore record' : 'Archive record'}</option>
                        </optgroup>}
                        {currentRole === 'admin' && <optgroup label="Destructive"><option value="delete">Delete record</option></optgroup>}
                      </select>
                    </div>
                  </div>
                  {customDynamicColumns.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 gap-2 border-t border-stone-100 pt-2 sm:grid-cols-2 lg:grid-cols-3">
                      {customDynamicColumns.map(item => (
                        <div key={item.field.id} className="text-[10px] text-stone-600">
                          <span className="font-bold">{item.field.label}: </span>
                          {formatFieldValue(getFieldValue(record, item.field), item.field)}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
            {currentRole !== 'agent' && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => onAddSwine(group.farmer)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-800"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Swine
                </button>
              </div>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Export to CSV with fully recalculated derived values
  const exportToExcel = () => {
    const headers = [
      'Swine ID / Registry ID',
      'Farmer Name',
      'Farmer Contact',
      'Barangay',
      'Breed',
      'Sex',
      'Date of Birth',
      'Current Age (Calculated)',
      'Age (Days)',
      'Age (Months)',
      'Estimated Weight (kg)',
      'Actual Weight (kg)',
      'Swine Type',
      'Farm Scale',
      'ASF Zone',
      'Biosecurity Warning',
      'Status',
      'Market Ready',
      'Estimated Price (PHP)',
      'Registered Date',
    ];

    const dynamicHeaders = customDynamicColumns.map(c => `"${c.field.label.replace(/"/g, '""')}"`);
    const allHeaders = [...headers, ...dynamicHeaders];

    const rows = sortedRecords.map(s => {
      const standardVals = [
        `"${s.computedPigId}"`,
        `"${s.farmerName.replace(/"/g, '""')}"`,
        `"${s.farmerContact || ''}"`,
        `"${s.barangay}"`,
        `"${(s.breed || 'Standard Commercial').replace(/"/g, '""')}"`,
        `"${s.gender ? s.gender.toUpperCase() : (s.sex ? s.sex.toUpperCase() : '')}"`,
        `"${s.computedDobFormatted || ''}"`,
        `"${s.computedAgeLabel.replace(/"/g, '""')}"`,
        s.computedAgeDays,
        s.computedAgeMonths,
        `"${s.computedEstimatedWeight}"`,
        s.computedActualWeight !== null ? s.computedActualWeight : '""',
        `"${s.swineType.toUpperCase()}"`,
        `"${s.computedFarmScale}"`,
        `"${s.computedAsfZone}"`,
        `"${s.computedHasWarning ? 'WARNING' : 'SAFE'}"`,
        `"${s.status.toUpperCase()}"`,
        `"${s.computedIsReady ? 'YES' : 'NO'}"`,
        s.estimatedPricePhp || 0,
        `"${new Date(s.registeredAt).toISOString().split('T')[0]}"`,
      ];
      const dynamicVals = customDynamicColumns.map(c => {
        const v = getFieldValue(s, c.field);
        const formatted = formatFieldValue(v, c.field);
        return `"${formatted.replace(/"/g, '""')}"`;
      });
      return [...standardVals, ...dynamicVals];
    });

    const csvContent = [allHeaders.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DA_Hinunangan_Swine_Records_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export to Word Document (.DOC)
  const exportToWord = () => {
    const tableRowsHtml = sortedRecords
      .map((s, i) => {
        const customCells = customDynamicColumns
          .map(c => {
            const v = getFieldValue(s, c.field);
            const formatted = formatFieldValue(v, c.field);
            return `<td style="padding: 6px; border: 1px solid #ccc;">${formatted}</td>`;
          })
          .join('');

        return `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 6px; border: 1px solid #ccc; font-weight: bold; font-family: monospace;">${s.computedPigId}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.farmerName}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.barangay}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.breed || 'Standard'}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.gender ? s.gender.toUpperCase() : (s.sex ? s.sex.toUpperCase() : '—')}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.computedDobFormatted || '—'}</td>
          <td style="padding: 6px; border: 1px solid #ccc; font-weight: bold;">${s.computedAgeLabel}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.computedEstimatedWeight}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.computedActualWeight ? `${s.computedActualWeight} kg` : '—'}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.swineType.toUpperCase()}</td>
          <td style="padding: 6px; border: 1px solid #ccc;">${s.computedFarmScale}</td>
          <td style="padding: 6px; border: 1px solid #ccc; font-weight: bold; color: ${s.computedAsfZone === 'RED' ? '#b91c1c' : s.computedAsfZone === 'PINK' ? '#db2777' : s.computedAsfZone === 'YELLOW' ? '#d97706' : '#15803d'};">${s.computedAsfZone}</td>
          <td style="padding: 6px; border: 1px solid #ccc; font-weight: bold;">${s.computedIsReady ? 'READY FOR SALE' : s.status.toUpperCase()}</td>
          ${customCells}
        </tr>
      `;
      })
      .join('');

    const customWordHeaders = customDynamicColumns
      .map(c => `<th style="padding: 6px; border: 1px solid #15803d;">${c.field.label}</th>`)
      .join('');

    const wordContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><title>DA Hinunangan Swine Records Registry</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 9.5pt; }
        h2, h3 { color: #15803d; margin-bottom: 2px; }
        table { border-collapse: collapse; width: 100%; margin-top: 15px; font-size: 8.5pt; }
      </style>
      </head>
      <body>
        <div style="text-align: center; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 10pt;">Republic of the Philippines • Province of Southern Leyte</p>
          <h2 style="margin: 4px 0;">MUNICIPALITY OF HINUNANGAN</h2>
          <h3 style="margin: 0;">DEPARTMENT OF AGRICULTURE - SWINE REGISTRY RECORDS</h3>
          <p style="margin-top: 4px; font-size: 9pt; color: #555;">Official Swine Registry Summary • Generated: ${new Date().toLocaleDateString()}</p>
        </div>
        <table>
          <thead>
            <tr style="background-color: #15803d; color: white;">
              <th style="padding: 6px; border: 1px solid #15803d;">Pig ID Tag</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Farmer</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Barangay</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Breed</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Sex</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Date of Birth</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Current Age</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Est. Weight</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Actual Weight</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Type</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Farm Scale</th>
              <th style="padding: 6px; border: 1px solid #15803d;">ASF Zone</th>
              <th style="padding: 6px; border: 1px solid #15803d;">Status</th>
              ${customWordHeaders}
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
        <div style="margin-top: 40px; display: flex; justify-content: space-between;">
          <div style="width: 250px; text-align: center;">
            <p>Prepared by:</p>
            <br/><br/>
            <p style="border-top: 1px solid #000; font-weight: bold; margin-top: 20px;">${currentUser?.name || 'Authorized DA Focal Person'}</p>
            <p style="font-size: 9pt; margin: 0;">Agricultural Extension Worker</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const blob = new Blob([wordContent], { type: 'application/msword;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DA_Hinunangan_Swine_Records_${new Date().toISOString().split('T')[0]}.doc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const displayedActiveFields = activeFields.filter(f => visibleColumnIds[f.field.id] !== false);

  const standardFieldKeys = useMemo(() => new Set([
    'pig_id_tag',
    'computed_pig_id',
    'ear_tag',
    'ear_tag_no',
    'farmer_name',
    'farmer',
    'barangay',
    'birth_date',
    'age',
    'estimated_weight',
    'actual_weight',
    'swine_type',
    'swine_category',
    'farm_scale',
    'farm_classification',
    'asf_zone',
    'biosecurity',
    'status'
  ]), []);

  const standardFieldIds = useMemo(() => new Set([
    'fld_ear_tag',
    'fld_farmer_name',
    'fld_barangay',
    'fld_birth_date',
    'fld_weight_kg',
    'fld_swine_category',
    'fld_farm_classification'
  ]), []);

  const customDynamicColumns = useMemo(() => {
    return displayedActiveFields.filter(item => {
      const k = item.fieldKey.toLowerCase();
      const id = item.field.id.toLowerCase();
      return !standardFieldKeys.has(k) && !standardFieldIds.has(id);
    });
  }, [displayedActiveFields, standardFieldKeys, standardFieldIds]);

  // Helper Badge Color Renderers
  const getFarmScaleBadge = (scale: FarmScale) => {
    switch (scale) {
      case 'COMMERCIAL_LARGE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-purple-100 text-purple-800 border border-purple-200">COMMERCIAL_LARGE</span>;
      case 'COMMERCIAL_MEDIUM':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-200">COMMERCIAL_MEDIUM</span>;
      case 'BACKYARD':
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-stone-100 text-stone-700 border border-stone-200">BACKYARD</span>;
    }
  };

  const getAsfZoneBadge = (zone: ASFZone) => {
    switch (zone) {
      case 'RED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-red-100 text-red-800 border border-red-300">RED</span>;
      case 'PINK':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-pink-100 text-pink-800 border border-pink-300">PINK</span>;
      case 'YELLOW':
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">YELLOW</span>;
      case 'GREEN':
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">GREEN</span>;
    }
  };

  return (
    <div className="swine-records-page mx-auto max-w-7xl space-y-6 px-3 py-6 sm:px-4">
      {/* Top Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-stone-200 shadow-xs">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-stone-900 sm:text-xl">{t('records_title', 'Swine Records Registry')}</h2>
            <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-0.5 rounded-full">
              {t('records_heads_count', { count: totalRecords }, `${totalRecords} Heads`)}
            </span>
            {currentRole === 'focal' && currentUser?.assignedBarangay && (
              <span className="bg-stone-100 text-stone-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-stone-200">
                Brgy. {currentUser.assignedBarangay} Scope
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 mt-1">
            {t('records_subtitle', 'Centralized Hinunangan swine registry with immutable Pig ID tags, automated age & weight recalculations, and dynamic biosecurity tracking.')}
          </p>
        </div>

        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
          {currentRole !== 'agent' && (
            <button
              type="button"
              onClick={() => onAddSwine()}
              className="order-first inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-600 sm:order-last sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              <span>{t('records_register_swine', 'Register Swine')}</span>
            </button>
          )}

          <details className="relative" ref={moreActionsRef}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">
              More actions <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-40 mt-2 max-h-[min(70vh,36rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-stone-200 bg-white p-3 shadow-xl">
              <div className="space-y-1 border-b border-stone-100 pb-2">
                <p className="px-2 text-[10px] font-bold uppercase tracking-wide text-stone-500">Records</p>
                <button
                  type="button"
                  onClick={event => {
                    void handleFetchFromDatabase(true);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  disabled={isRefreshingDb || isLoadingDb}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-emerald-50 disabled:opacity-50"
                  title="Fetch latest records directly from database"
                >
                  <RotateCw className={`h-4 w-4 text-emerald-700 ${isRefreshingDb ? 'animate-spin' : ''}`} />
                  {isRefreshingDb ? t('loading_records', 'Loading Records...') : t('records_refresh', 'Refresh Records')}
                </button>
              </div>
              <div className="space-y-1">
                <p className="px-2 text-[10px] font-bold uppercase tracking-wide text-stone-500">Display</p>
                <button
                  type="button"
                  onClick={event => {
                    setReadyFilter(readyFilter === 'ready' ? 'all' : 'ready');
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-amber-50"
                >
                  <Sparkles className="h-4 w-4 text-amber-600" />
                  {readyFilter === 'ready' ? 'Show all records' : 'Ready to Sell'}
                </button>
                <button
                  type="button"
                  onClick={event => {
                    setShowColumnPicker(value => !value);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-stone-50"
                >
                  <Columns className="h-4 w-4 text-emerald-700" />
                  {showColumnPicker ? 'Close column controls' : 'Choose visible columns'}
                </button>
              </div>

              {currentRole !== 'agent' && (
                <div className="mt-2 space-y-1 border-t border-stone-100 pt-2">
                  <p className="px-2 text-[10px] font-bold uppercase tracking-wide text-stone-500">Import records</p>
                  {([
                    ['csv', 'Import CSV', FileSpreadsheet],
                    ['xlsx', 'Import Excel Spreadsheet', FileSpreadsheet],
                    ['all', 'Import Records File', Upload],
                  ] as const).map(([fileType, label, Icon]) => (
                    <button
                      key={fileType}
                      type="button"
                      onClick={event => {
                        setImportFileType(fileType);
                        setShowImportModal(true);
                        event.currentTarget.closest('details')?.removeAttribute('open');
                      }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-purple-50"
                    >
                      <Icon className="h-4 w-4 text-purple-700" />
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-2 space-y-1 border-t border-stone-100 pt-2">
                <p className="px-2 text-[10px] font-bold uppercase tracking-wide text-stone-500">Print and export</p>
                <button
                  type="button"
                  onClick={event => {
                    setActivePrintColumns(activeFields);
                    setShowPrintModal(true);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-emerald-50"
                >
                  <Printer className="h-4 w-4 text-emerald-700" />
                  Print current records ({totalRecords})
                </button>
                <button
                  type="button"
                  onClick={event => {
                    exportToExcel();
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-emerald-50"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
                  Export Excel (.CSV)
                </button>
                <button
                  type="button"
                  onClick={event => {
                    exportToWord();
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-blue-50"
                >
                  <FileText className="h-4 w-4 text-blue-700" />
                  Export Word (.DOC)
                </button>
                <button
                  type="button"
                  onClick={event => {
                    const initial: Record<string, boolean> = {};
                    activeFields.forEach(field => {
                      initial[field.field.id] = true;
                    });
                    setPrintSelectedColumnIds(initial);
                    setPrintValidationError(null);
                    setShowPrintSelectModal(true);
                    event.currentTarget.closest('details')?.removeAttribute('open');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-stone-800 hover:bg-stone-50"
                >
                  <SlidersHorizontal className="h-4 w-4 text-stone-600" />
                  Select print columns
                </button>
              </div>
            </div>
          </details>

          {/* Bulk Delete Button (Admin only, active when records selected) */}
          {currentRole === 'admin' && selectedRecordIds.size > 0 && (
            <button
              type="button"
              onClick={() => setShowBulkDeleteModal(true)}
              className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm animate-fadeIn"
              title={`Bulk delete ${selectedRecordIds.size} selected records`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{t('btn_bulk_delete', { count: selectedRecordIds.size }, `Bulk Delete (${selectedRecordIds.size})`)}</span>
            </button>
          )}
        </div>
      </div>

      {/* Column Visibility Panel */}
      {showColumnPicker && (
        <div className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-stone-100 pb-2">
            <div>
              <h3 className="font-bold text-xs text-stone-900 flex items-center gap-1.5">
                <Columns className="w-4 h-4 text-emerald-700" />
                {t('records_customize_cols_title', 'Customize Swine Records Table Columns')}
              </h3>
              <p className="text-[11px] text-stone-500">
                {t('records_customize_cols_desc', 'Toggle column visibility to personalize your records view.')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetColumnsToDefault}
                className="text-[11px] text-emerald-700 font-semibold hover:underline cursor-pointer"
              >
                {t('records_show_all', 'Show All')}
              </button>
              <button
                type="button"
                onClick={() => setShowColumnPicker(false)}
                className="text-stone-400 hover:text-stone-700 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 pt-1 text-xs">
            {activeFields.map(item => {
              const isChecked = visibleColumnIds[item.field.id] !== false;
              return (
                <label
                  key={item.field.id}
                  className={`flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition ${
                    isChecked
                      ? 'bg-emerald-50/50 border-emerald-300 text-stone-900 font-medium'
                      : 'bg-stone-50 border-stone-200 text-stone-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleColumnVisibility(item.field.id)}
                    className="w-3.5 h-3.5 text-emerald-600 rounded border-stone-300 focus:ring-emerald-500"
                  />
                  <span className="truncate text-[11px]" title={item.field.label}>
                    {item.field.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {refreshNotice && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-900 font-bold rounded-2xl flex items-center justify-between shadow-2xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>{refreshNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshNotice('')}
            className="text-emerald-700 hover:text-emerald-950 text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {dbError && (
        <div className="p-4 bg-rose-50 border border-rose-300 text-rose-900 rounded-2xl flex items-center justify-between shadow-2xs animate-fadeIn">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-700 shrink-0" />
            <div>
              <p className="font-bold text-xs text-rose-950">Unable to load Swine Records.</p>
              <p className="text-[11px] text-rose-700 font-medium">The system could not retrieve records from the database. {dbError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleFetchFromDatabase(true)}
            className="px-3 py-1.5 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs shrink-0 shadow-2xs transition cursor-pointer flex items-center gap-1.5 ml-4"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {importSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold rounded-2xl flex items-center justify-between shadow-2xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{importSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setImportSuccessMsg('')}
            className="text-emerald-700 hover:text-emerald-900 text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Comprehensive Search & Filters Suite */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-stone-200 shadow-xs space-y-3.5">
        {/* Real-time Search Filter Bar */}
        <div className="space-y-2">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2.5">
            {/* Search Input Box */}
            <div className="relative flex-1">
              <Search
                className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors pointer-events-none ${
                  searchTerm ? 'text-emerald-700' : 'text-stone-400'
                }`}
              />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setSearchTerm('');
                }}
                placeholder={
                  searchScope === 'tag'
                    ? 'Search by Pig ID Tag'
                    : searchScope === 'owner'
                    ? 'Search by Farmer Name'
                    : 'Search by Pig ID Tag or Farmer Name'
                }
                className={`min-h-11 w-full rounded-xl border py-2.5 pl-10 pr-28 text-xs font-medium transition focus:outline-hidden ${
                  searchTerm
                    ? 'border-emerald-600 bg-emerald-50/25 ring-2 ring-emerald-600/15'
                    : 'border-stone-300 bg-white hover:border-stone-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20'
                }`}
              />

              {/* Inside right: Live Match Counter & Clear Button */}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {searchTerm.trim() && (
                  <>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${
                        totalRecords > 0
                          ? 'bg-emerald-50 text-emerald-850 border-emerald-200'
                          : 'bg-rose-50 text-rose-800 border-rose-200'
                      }`}
                    >
                      {totalRecords} {totalRecords === 1 ? 'match' : 'matches'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-md transition cursor-pointer"
                      title="Clear search (Esc)"
                      aria-label="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Dedicated Search Scope Selector */}
            <div className="flex min-h-11 w-full flex-wrap items-center gap-1 self-start rounded-xl border border-stone-200 bg-stone-100 p-1 text-xs md:w-auto md:flex-nowrap md:self-auto">
              <span className="text-[10px] font-bold uppercase text-stone-400 px-1.5 tracking-wider hidden lg:inline">
                {t('records_scope', 'Scope')}:
              </span>
              <button
                type="button"
                onClick={() => setSearchScope('all')}
                className={`min-h-11 flex-1 rounded-lg px-2 py-1.5 font-bold text-xs transition cursor-pointer ${
                  searchScope === 'all'
                    ? 'bg-white text-stone-900 shadow-2xs'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                {t('records_all_fields', 'All Fields')}
              </button>
              <button
                type="button"
                onClick={() => setSearchScope('tag')}
                className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-bold text-xs transition cursor-pointer ${
                  searchScope === 'tag'
                    ? 'bg-emerald-800 text-white shadow-2xs'
                    : 'text-stone-600 hover:text-emerald-800'
                }`}
              >
                <Tag className="w-3 h-3" />
                <span>{t('records_tag_id', 'Tag ID')}</span>
              </button>
              <button
                type="button"
                onClick={() => setSearchScope('owner')}
                className={`inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-bold text-xs transition cursor-pointer ${
                  searchScope === 'owner'
                    ? 'bg-emerald-800 text-white shadow-2xs'
                    : 'text-stone-600 hover:text-emerald-800'
                }`}
              >
                <User className="w-3 h-3" />
                <span>{t('records_owner_name', 'Owner Name')}</span>
              </button>
            </div>
          </div>

          {/* Real-time search status notice */}
          {searchTerm.trim() && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-xs text-stone-500">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                <span className="text-[11px]">
                  Filtering by{' '}
                  <strong className="text-stone-900">
                    {searchScope === 'tag'
                      ? 'Tag ID / Ear Tag'
                      : searchScope === 'owner'
                      ? 'Owner / Raiser Name'
                      : 'Tag ID & Owner Name'}
                  </strong>{' '}
                  matching <strong className="text-emerald-900">&ldquo;{searchTerm}&rdquo;</strong> ({totalRecords} found)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="text-[11px] text-emerald-800 hover:text-emerald-950 font-semibold cursor-pointer underline"
              >
                {t('common_reset', 'Reset')} (Esc)
              </button>
            </div>
          )}
        </div>

        {/* Primary filters remain visible; secondary filters stay available below. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-2 border-t border-stone-100">
          {/* Barangay Filter */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-stone-600">Barangay</label>
            <select
              value={selectedBarangay}
              disabled={currentRole === 'focal'}
              onChange={e => setSelectedBarangay(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden disabled:bg-stone-100"
            >
              <option value="all">{t('records_all_barangays', 'All Barangays')} ({barangays.length})</option>
              {barangays.map(b => (
                <option key={b.id} value={b.name}>
                  Brgy. {b.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-stone-600">Record status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="ready">Ready for Sale</option>
              <option value="sold">Sold</option>
              <option value="quarantined">Quarantined</option>
              <option value="sick">Suspected / Sick</option>
            </select>
          </div>
        </div>

        <details className="group border-t border-stone-100 pt-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-bold text-stone-700 focus-visible:outline-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            Advanced filters
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-600">{activeFilterCount} active</span>
          </summary>
          <div className="mt-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">

          {/* Swine Type Filter */}
          <div>
            <select
              value={swineTypeFilter}
              onChange={e => setSwineTypeFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <option value="all">{t('records_all_swine_types', 'All Swine Types')}</option>
              <option value="boar">{t('swine_type_breeding_boar', 'Breeding Boar')}</option>
              <option value="sow">{t('swine_type_breeding_sow', 'Breeding Sow')}</option>
              <option value="piglet">{t('swine_type_piglet', 'Piglet')}</option>
              <option value="grower">{t('swine_type_grower', 'Grower')}</option>
              <option value="finisher">{t('swine_type_finisher', 'Finisher')}</option>
            </select>
          </div>

          {/* Farm Scale Filter */}
          <div>
            <select
              value={farmScaleFilter}
              onChange={e => setFarmScaleFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <option value="all">{t('records_all_farm_scales', 'All Farm Scales')}</option>
              <option value="BACKYARD">{t('scale_backyard', 'Backyard')}</option>
              <option value="COMMERCIAL_MEDIUM">{t('scale_commercial_medium', 'Commercial Medium')}</option>
              <option value="COMMERCIAL_LARGE">{t('scale_commercial_large', 'Commercial Large')}</option>
            </select>
          </div>

          {/* ASF Zone Filter */}
          <div>
            <select
              value={asfZoneFilter}
              onChange={e => setAsfZoneFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <option value="all">{t('records_all_asf_zones', 'All ASF Zones')}</option>
              <option value="RED">{t('zone_red', 'RED Zone (Infected)')}</option>
              <option value="PINK">{t('zone_pink', 'PINK Zone (Buffer)')}</option>
              <option value="YELLOW">{t('zone_yellow', 'YELLOW Zone (Surveillance)')}</option>
              <option value="GREEN">{t('zone_dark_green', 'GREEN Zone (Free)')}</option>
            </select>
          </div>
        </div>

        {/* Advanced status, biosecurity, age, sorting, and archive controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
          {/* Biosecurity Warning Filter */}
          <div>
            <select
              value={biosecurityFilter}
              onChange={e => setBiosecurityFilter(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <option value="all">{t('records_biosecurity_all', 'Biosecurity: All')}</option>
              <option value="warning">⚠ {t('records_biosecurity_warning', 'Biosecurity Warning')}</option>
              <option value="no_warning">{t('records_biosecurity_safe', 'Biosecurity Safe')}</option>
            </select>
          </div>

          {/* Age Dynamic Filter */}
          <div>
            <select
              value={ageFilter}
              onChange={e => setAgeFilter(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
              aria-label="Filter by Age"
            >
              <option value="all">All Ages</option>
              <option value="under_1m">Under 1 Month</option>
              <option value="1_3m">1–3 Months</option>
              <option value="4_6m">4–6 Months</option>
              <option value="7_12m">7–12 Months</option>
              <option value="over_1y">Over 1 Year</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-stone-600">Registration date</label>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" aria-label="Registered from" value={registeredFrom} max={registeredTo || undefined} onChange={e => setRegisteredFrom(e.target.value)} className="min-h-11 min-w-0 w-full rounded-xl border border-stone-300 bg-white px-2 text-xs" />
              <input type="date" aria-label="Registered to" value={registeredTo} min={registeredFrom || undefined} onChange={e => setRegisteredTo(e.target.value)} className="min-h-11 min-w-0 w-full rounded-xl border border-stone-300 bg-white px-2 text-xs" />
            </div>
          </div>

          {/* Sort By Field */}
          <div className="flex items-center gap-1.5">
            <select
              value={sortFieldKey}
              onChange={e => setSortFieldKey(e.target.value)}
              className="flex-1 px-3 py-2 rounded-xl border border-stone-300 bg-white font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <option value="registeredAt">{t('records_sort_date', 'Sort: Date Registered')}</option>
              <option value="pigIdTag">{t('records_sort_pig_id', 'Sort: Pig ID Tag')}</option>
              <option value="farmerName">{t('records_sort_farmer', 'Sort: Farmer Name')}</option>
              <option value="breed">Sort: Breed</option>
              <option value="gender">Sort: Sex</option>
              <option value="birthDate">Sort: {t('form_birth_date', 'Birth Date')}</option>
              <option value="age">{t('records_sort_age', 'Sort: Age')}</option>
              <option value="estimatedWeight">Sort: {t('records_th_est_weight', 'Est. Weight')}</option>
              <option value="actualWeight">Sort: {t('records_th_actual_weight', 'Actual Weight')}</option>
              <option value="barangay">Sort: {t('records_th_barangay', 'Barangay')}</option>
              <option value="swineType">Sort: {t('records_th_swine_type', 'Swine Type')}</option>
              <option value="farmScale">Sort: {t('records_th_farm_scale', 'Farm Scale')}</option>
              <option value="asfZone">Sort: {t('records_th_asf_zone', 'ASF Zone')}</option>
              <option value="status">Sort: {t('records_th_status', 'Status')}</option>
            </select>
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="p-2 border border-stone-300 rounded-xl hover:bg-stone-50 text-stone-600 cursor-pointer shadow-2xs"
              title={`Toggle ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
          </div>

          {/* Items Per Page */}
          <div>
            <select
              value={pageSize}
              onChange={e => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="w-full px-3 py-2 rounded-xl border border-stone-300 bg-white font-medium focus:ring-2 focus:ring-emerald-600 focus:outline-hidden"
            >
              <option value={10}>10 farmer groups / page</option>
              <option value={25}>25 farmer groups / page</option>
              <option value={50}>50 farmer groups / page</option>
              <option value={100}>100 farmer groups / page</option>
            </select>
          </div>

          {/* Show Archived Toggle */}
          <div className="flex items-center justify-end">
            <label className="flex items-center gap-1.5 cursor-pointer font-medium text-stone-700">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="w-3.5 h-3.5 text-emerald-600 rounded border-stone-300"
              />
              <span>{t('records_archived', 'Archived Records')}</span>
            </label>
          </div>
        </div>

          </div>
        </details>

        {/* Live Filter Summary & Counter */}
        <div className="flex flex-wrap items-center justify-between pt-1 border-t border-stone-100 text-xs text-stone-500">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-1 font-semibold text-stone-700">
              {activeFilterCount} active {activeFilterCount === 1 ? 'filter' : 'filters'}
            </span>
            <span>
              {t('records_showing', {
                start: startRecordIndex,
                end: endRecordIndex,
                total: totalRecords,
              })}
            </span>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm('');
                  setSearchScope('all');
                  setSelectedBarangay(currentRole === 'focal' && currentUser?.assignedBarangay ? currentUser.assignedBarangay : 'all');
                  setSwineTypeFilter('all');
                  setFarmScaleFilter('all');
                  setAsfZoneFilter('all');
                  setStatusFilter('all');
                  setBiosecurityFilter('all');
                  setReadyFilter('all');
                  setAgeFilter('all');
                  setRegisteredFrom('');
                  setRegisteredTo('');
                  setShowArchived(false);
                }}
                className="min-h-11 text-emerald-700 hover:underline font-bold cursor-pointer"
              >
                Clear filters ({activeFilterCount})
              </button>
            )}
          </div>
          <span className="text-[11px]">
            {t('records_db_total', { total: swineList.length })}
          </span>
        </div>
      </div>

      {/* Admin Bulk Selection Actions Banner */}
      {currentRole === 'admin' && selectedRecordIds.size > 0 && (
        <div className="bg-stone-900 text-white p-3.5 sm:p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-md border border-stone-800 animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 font-black text-xs shrink-0">
              {selectedRecordIds.size}
            </div>
            <div>
              <div className="font-bold text-xs flex items-center gap-1.5">
                <span>
                  {selectedRecordIds.size} swine {selectedRecordIds.size === 1 ? 'record' : 'records'} selected
                </span>
                <span className="text-[10px] text-stone-400 font-normal">
                  (out of {totalRecords} filtered)
                </span>
              </div>
              <p className="text-[11px] text-stone-400">
                Admins can remove all selected swine records simultaneously after confirmation.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {paginatedRecords.some(record => !selectedRecordIds.has(record.id)) && (
              <button
                type="button"
                onClick={handleSelectVisiblePage}
                className="px-3 py-1.5 rounded-xl border border-emerald-700 bg-emerald-900 hover:bg-emerald-800 text-emerald-100 text-xs font-semibold transition cursor-pointer"
                title="Select only swine matching the current filters on this page"
              >
                Select visible on this page ({paginatedRecords.length})
              </button>
            )}
            {selectedRecordIds.size < totalRecords && (
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-semibold transition cursor-pointer"
              >
                Select all {totalRecords} filtered
              </button>
            )}
            <button
              type="button"
              onClick={handleClearSelection}
              className="px-3 py-1.5 rounded-xl border border-stone-700 bg-stone-800/80 hover:bg-stone-700 text-stone-300 text-xs font-semibold transition cursor-pointer"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={() => setShowBulkDeleteModal(true)}
              className="px-4 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Bulk Delete ({selectedRecordIds.size})</span>
            </button>
          </div>
        </div>
      )}

      {/* Bulk Action / Deletion Success Notice */}
      {bulkActionNotice && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2 shadow-2xs animate-fadeIn">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{bulkActionNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setBulkActionNotice('')}
            className="text-stone-400 hover:text-stone-700 p-1 cursor-pointer"
            aria-label="Close notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Phone card view shares the same filtered, grouped, and paginated records as the desktop table. */}
      <section className="mobile-record-cards space-y-3" aria-label="Swine records">
        {isLoadingDb && paginatedRecords.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-600">
            Loading swine records…
          </div>
        ) : paginatedRecords.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-600">
            No swine records match the current filters.
          </div>
        ) : paginatedRecords.map(swine => {
          const farmerKey = getFarmerGroupKey(swine);
          const farmerGroup = groupByKey.get(farmerKey);
          const farmerSwineCount = farmerGroup?.records.length ?? 1;
          const isFarmerExpanded = expandedFarmerKey === farmerKey;
          const isFarmerRepresentative = farmerGroup?.records[0]?.id === swine.id;
          const isSelected = selectedRecordIds.has(swine.id);
          const displayStatus = swine.status === 'sold'
            ? getStatusLabel('sold')
            : swine.computedIsReady
              ? t('records_ready_to_sell', 'Ready to Sell')
              : getStatusLabel(swine.status || 'active');
          const menuActions: { action: SwineRecordAction; label: string; destructive?: boolean }[] = [
            { action: 'view', label: 'View Details' },
            ...(farmerKey ? [{ action: 'farmer' as const, label: 'View Farmer’s Swine' }] : []),
            ...(currentRole !== 'agent' ? [{ action: 'edit' as const, label: 'Edit Record' }] : []),
            ...(onViewOnMap ? [{ action: 'map' as const, label: 'View on GIS Map' }] : []),
            { action: 'print', label: 'Print Swine Record' },
            { action: 'certificate', label: 'Generate Certificate' },
            ...(currentRole !== 'agent' && swine.status !== 'sold'
              ? [
                  { action: 'ready' as const, label: swine.readyToSell ? 'Remove Ready to Sell' : 'Mark Ready to Sell' },
                  { action: 'sold' as const, label: 'Mark as Sold' },
                ]
              : []),
            ...(currentRole !== 'agent'
              ? [{ action: 'archive' as const, label: swine.isArchived ? 'Restore Record' : 'Archive Record' }]
              : []),
            ...(currentRole === 'admin' ? [{ action: 'delete' as const, label: 'Delete Record', destructive: true }] : []),
          ];

          return (
            <article
              key={swine.id}
              id={`mobile-swine-${swine.id}`}
              className="relative rounded-2xl border border-stone-200 bg-white p-4 shadow-xs"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                {currentRole === 'admin' && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleSelectRecord(swine.id)}
                    className="mt-1 h-5 w-5 shrink-0 accent-emerald-700"
                    aria-label={`Select record ${swine.computedPigId || swine.pigIdTag || swine.earTagNo}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Pig ID Tag</p>
                  <p className="break-all font-mono text-base font-black leading-snug text-emerald-950">
                    {swine.computedPigId || swine.pigIdTag || swine.earTagNo || 'ID unavailable'}
                  </p>
                  {swine.earTagNo && swine.earTagNo !== swine.computedPigId && (
                    <p className="mt-0.5 break-all text-[11px] text-stone-500">Ear tag: {swine.earTagNo}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-start gap-1.5">
                  {swine.isSynced === false ? (
                    <span className="mt-1 inline-flex min-h-6 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 text-[10px] font-bold text-amber-900">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                      Pending
                    </span>
                  ) : (
                    <span className="mt-1 inline-flex min-h-6 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-semibold text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" />
                      Synced
                    </span>
                  )}
                  <div className="relative" data-record-actions>
                    <button
                      ref={mobileActionMenuRecordId === swine.id ? mobileActionTriggerRef : undefined}
                      type="button"
                      onClick={() => setMobileActionMenuRecordId(current => current === swine.id ? null : swine.id)}
                      aria-label={`Actions for ${swine.computedPigId || swine.pigIdTag || swine.earTagNo}`}
                      aria-haspopup="menu"
                      aria-expanded={mobileActionMenuRecordId === swine.id}
                      className="flex h-11 w-11 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-emerald-700"
                    >
                      <MoreVertical className="h-5 w-5" aria-hidden="true" />
                    </button>
                    {mobileActionMenuRecordId === swine.id && (
                      <div
                        role="menu"
                        aria-label={`Record actions for ${swine.computedPigId || swine.pigIdTag || swine.earTagNo}`}
                        className="absolute right-0 top-full z-50 mt-1 max-h-[min(65vh,28rem)] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl"
                      >
                        {menuActions.map(item => (
                          <React.Fragment key={item.action}>
                            {(item.action === 'map' || item.action === 'print' || item.action === 'ready' || item.action === 'archive' || item.action === 'delete') && (
                              <div className="my-1 border-t border-stone-100" role="separator" />
                            )}
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => performRecordAction(item.action, swine, farmerKey)}
                              className={`flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-emerald-700 ${
                                item.destructive
                                  ? 'text-red-700 hover:bg-red-50'
                                  : 'text-stone-800 hover:bg-stone-100'
                              }`}
                            >
                              {item.label}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-stone-100 pt-3 text-sm">
                <div className="col-span-2 min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Farmer</span>
                  <button
                    type="button"
                    disabled={!farmerKey}
                    onClick={() => farmerKey && performRecordAction('farmer', swine, farmerKey)}
                    aria-expanded={isFarmerExpanded}
                    className="min-h-11 max-w-full break-words text-left font-bold leading-snug text-stone-900 underline decoration-stone-300 underline-offset-2 disabled:no-underline"
                  >
                    {swine.farmerName || 'Farmer name unavailable'}
                  </button>
                  {farmerSwineCount > 1 && (
                    <span className="ml-2 inline-flex rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold text-stone-700">
                      {farmerSwineCount} swine
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Barangay</span>
                  <span className="break-words font-medium text-stone-800">{swine.barangay || '—'}</span>
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Farm</span>
                  <span className="break-words font-medium text-stone-800">{swine.farmName || swine.farmType || '—'}</span>
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Breed</span>
                  <span className="break-words font-medium text-stone-800">{swine.breed || 'Large White Cross'}</span>
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Sex</span>
                  <span className="break-words font-medium capitalize text-stone-800">
                    {swine.gender === 'male' ? 'Male (Intact)' : swine.gender === 'female' ? 'Female (Gilt/Sow)' : 'Castrated'}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Registered</span>
                  <span className="break-words font-medium text-stone-800">
                    {swine.registeredAt ? new Date(swine.registeredAt).toLocaleDateString() : '—'}
                  </span>
                </div>
                <div className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-stone-500">Status</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    swine.status === 'sold'
                      ? 'bg-stone-200 text-stone-800'
                      : swine.computedIsReady
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-emerald-50 text-emerald-800'
                  }`}>
                    {displayStatus}
                  </span>
                </div>
              </div>

              {isFarmerExpanded && isFarmerRepresentative && farmerGroup && (
                <section
                  id={`mobile-farmer-group-${encodeURIComponent(farmerKey)}`}
                  className="mt-3 space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3"
                  aria-label={`Swine records for ${farmerGroup.farmer.farmerName}`}
                >
                  <h3 className="text-xs font-bold text-emerald-950">Farmer’s swine ({farmerSwineCount})</h3>
                  <div className="space-y-1">
                    {farmerGroup.records.map(groupRecord => (
                      <button
                        key={groupRecord.id}
                        type="button"
                        onClick={() => document.getElementById(`mobile-swine-${groupRecord.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-xs font-medium text-stone-800 hover:bg-white"
                      >
                        <span className="break-all font-mono">{groupRecord.computedPigId || groupRecord.pigIdTag || groupRecord.earTagNo}</span>
                        <span className="shrink-0 text-stone-500">{groupRecord.breed || 'Breed unavailable'}</span>
                      </button>
                    ))}
                  </div>
                  {currentRole !== 'agent' && (
                    <button
                      type="button"
                      onClick={() => onAddSwine(farmerGroup.farmer)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800"
                    >
                      <Plus className="h-4 w-4" />
                      Add Swine
                    </button>
                  )}
                </section>
              )}

              <details className="mt-3 border-t border-stone-100 pt-2">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-xs font-semibold text-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-700">
                  <span>Additional record details</span>
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </summary>
                <div className="grid grid-cols-1 gap-2 border-t border-stone-100 pt-3 text-xs sm:grid-cols-2">
                  {[
                    ['Date of birth', swine.birthDate ? formatDobDisplay(swine.birthDate) : 'Not recorded'],
                    ['Age', swine.computedAgeLabel || 'Unavailable'],
                    ['Estimated weight', swine.computedEstimatedWeight || '—'],
                    ['Actual weight', swine.computedActualWeight ? `${swine.computedActualWeight} kg` : '—'],
                    ['Swine type', getSwineTypeLabel(swine.swineType)],
                    ['Farm scale', getFarmScaleLabel(swine.computedFarmScale)],
                    ['ASF zone', getAsfZoneLabel(swine.computedAsfZone)],
                    ['Farmer contact', swine.farmerContact || '—'],
                    ['Farmer address', swine.farmerAddress || '—'],
                    ['RSBSA ID', swine.rsbsaId || '—'],
                    ['Farm name', swine.farmName || '—'],
                    ['Farm type', swine.farmType || '—'],
                    ['Pen capacity', swine.penCapacity ?? '—'],
                    ['Coordinates', Number.isFinite(swine.latitude) && Number.isFinite(swine.longitude) ? `${swine.latitude}, ${swine.longitude}` : '—'],
                    ['Notes', swine.notes || '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 break-words rounded-lg bg-stone-50 p-2">
                      <span className="font-semibold text-stone-600">{label}: </span>
                      <span className="text-stone-800">{value}</span>
                    </div>
                  ))}
                  {activeFields.map(item => (
                    <div key={item.field.id} className="min-w-0 break-words rounded-lg bg-stone-50 p-2">
                      <span className="font-semibold text-stone-600">{item.field.label}: </span>
                      <span className="text-stone-800">
                        {formatFieldValue(getFieldValue(swine, item.field), item.field) || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </details>

              <div className="mt-2 flex justify-end border-t border-stone-100 pt-2">
                <button
                  type="button"
                  onClick={() => setViewingRecord(swine)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-700"
                >
                  View Details
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {/* Primary Swine Records Table */}
      <div className="desktop-record-table bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap min-w-[1250px]">
            <thead className="bg-stone-100/90 text-stone-700 font-bold border-b border-stone-200 uppercase tracking-wider text-[10px]">
              <tr>
                {/* Column 0: Checkbox Selector (Admin Only) */}
                {currentRole === 'admin' && (
                  <th className="py-3.5 px-3 w-10 min-w-[40px] max-w-[40px] text-center sticky left-0 bg-stone-100/95 z-20 border-r border-stone-200 shadow-2xs">
                    <input
                      type="checkbox"
                      checked={isAllCurrentPageSelected}
                      ref={el => {
                        if (el) {
                          el.indeterminate = isSomeCurrentPageSelected && !isAllCurrentPageSelected;
                        }
                      }}
                      onChange={handleToggleSelectAllCurrentPage}
                      className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-500 border-stone-300 cursor-pointer accent-emerald-700"
                      aria-label="Select all swine records on this page"
                      title={isAllCurrentPageSelected ? 'Deselect all on this page' : 'Select all on this page'}
                    />
                  </th>
                )}

                {/* Column 1: Pig ID Tag (Sticky Left, Read-only) */}
                <th
                  className={`py-3.5 px-4 sticky ${
                    currentRole === 'admin' ? 'left-10' : 'left-0'
                  } bg-stone-100/95 z-10 border-r border-stone-200 shadow-2xs cursor-pointer hover:bg-stone-200/50`}
                  onClick={() => {
                    setSortFieldKey('pigIdTag');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <Lock className="w-3 h-3 text-stone-400" />
                    <span>{t('records_th_pig_id', 'Pig ID Tag')}</span>
                    {sortFieldKey === 'pigIdTag' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 2: Farmer */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('farmerName');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_farmer', 'Farmer')}</span>
                    {sortFieldKey === 'farmerName' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 2a: Breed */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('breed');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_breed', 'Breed')}</span>
                    {sortFieldKey === 'breed' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 2b: Sex */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('gender');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_sex', 'Sex')}</span>
                    {sortFieldKey === 'gender' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 3: Barangay */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('barangay');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_barangay', 'Barangay')}</span>
                    {sortFieldKey === 'barangay' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 4: Birth Date */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('birthDate');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_birth_date', 'Birth Date')}</span>
                    {sortFieldKey === 'birthDate' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 5: Age (Automatically Calculated) */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('age');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_age', 'Age')}</span>
                    {sortFieldKey === 'age' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 6: Estimated Weight (Automatically Calculated) */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('estimatedWeight');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_est_weight', 'Est. Weight')}</span>
                    {sortFieldKey === 'estimatedWeight' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 7: Actual Weight */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('actualWeight');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_actual_weight', 'Actual Weight')}</span>
                    {sortFieldKey === 'actualWeight' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 8: Swine Type */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('swineType');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_swine_type', 'Swine Type')}</span>
                    {sortFieldKey === 'swineType' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 9: Farm Scale (Automatically Classified) */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('farmScale');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_farm_scale', 'Farm Scale')}</span>
                    {sortFieldKey === 'farmScale' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 10: ASF Zone */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('asfZone');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>{t('records_th_asf_zone', 'ASF Zone')}</span>
                    {sortFieldKey === 'asfZone' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 11: Biosecurity Warning */}
                <th className="py-3.5 px-4 border-r border-stone-200 text-center">
                  {t('records_th_biosecurity', 'Biosecurity')}
                </th>

                {/* Column 12: Status */}
                <th
                  className="py-3.5 px-4 border-r border-stone-200 text-center cursor-pointer hover:bg-stone-200/50"
                  onClick={() => {
                    setSortFieldKey('status');
                    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                  }}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span>{t('records_th_status', 'Status')}</span>
                    {sortFieldKey === 'status' && (
                      <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>

                {/* Column 12.5+: Dynamic Admin-Configured Schema Columns */}
                {customDynamicColumns.map(item => (
                  <th
                    key={item.field.id}
                    className="py-3.5 px-4 border-r border-stone-200 cursor-pointer hover:bg-stone-200/50"
                    onClick={() => {
                      setSortFieldKey(item.field.id);
                      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{item.field.label}</span>
                      {sortFieldKey === item.field.id && (
                        <span className="text-emerald-700 font-bold">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </div>
                  </th>
                ))}

                {/* Column 13: Sticky Actions */}
                <th className="sticky right-0 z-30 min-w-[320px] border-l border-stone-200 bg-stone-100 px-4 py-3.5 text-right shadow-2xs">
                  {t('records_th_actions', 'Actions')}
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-stone-200">
              {isLoadingDb && paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={(currentRole === 'admin' ? 16 : 15) + customDynamicColumns.length} className="py-20 text-center">
                    <div className="max-w-md mx-auto space-y-3 px-4">
                      <div className="w-10 h-10 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
                      <h4 className="font-bold text-stone-900 text-sm">{t('loading_records', 'Loading swine records...')}</h4>
                      <p className="text-xs text-stone-500">{t('records_db_status_connected', 'Retrieving actual records from the Swine Registry database...')}</p>
                    </div>
                  </td>
                </tr>
              ) : dbError && paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={(currentRole === 'admin' ? 16 : 15) + customDynamicColumns.length} className="py-16 text-center">
                    <div className="max-w-md mx-auto space-y-3 px-4 bg-rose-50 border border-rose-200 rounded-2xl p-6">
                      <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 border border-rose-200 flex items-center justify-center mx-auto">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-bold text-rose-900 text-sm">{t('records_load_error', 'Unable to load Swine Records.')}</h4>
                        <p className="text-xs text-rose-700 font-medium mt-1">{t('records_db_error_generic', 'The system could not retrieve records from the database.')}</p>
                        <p className="text-[11px] text-rose-600/80 mt-1">{dbError}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleFetchFromDatabase(true)}
                        className="px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white font-bold text-xs transition cursor-pointer shadow-sm flex items-center gap-1.5 mx-auto"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>{t('btn_retry', 'Retry')}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : paginatedRecords.length === 0 ? (
                <tr>
                  <td colSpan={(currentRole === 'admin' ? 16 : 15) + customDynamicColumns.length} className="py-16 text-center">
                    {swineList.length === 0 && !searchTerm.trim() ? (
                      <div className="max-w-md mx-auto space-y-3 px-4">
                        <div className="w-14 h-14 rounded-3xl bg-stone-100 text-stone-400 border border-stone-200 flex items-center justify-center mx-auto">
                          <Database className="w-7 h-7 text-stone-400" />
                        </div>
                        <div>
                          <h4 className="font-black text-stone-900 text-base">{t('records_empty_title', 'No Swine Records Found')}</h4>
                          <p className="text-xs text-stone-500 mt-1">{t('records_empty_desc', 'There are currently no swine records in the database.')}</p>
                        </div>
                        {currentRole !== 'agent' && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => onAddSwine()}
                              className="px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs transition cursor-pointer shadow-sm flex items-center gap-1.5 mx-auto"
                            >
                              <Plus className="w-4 h-4" />
                              <span>{t('records_add_first', 'Add Swine Record')}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ) : searchTerm.trim() ? (
                      <div className="max-w-md mx-auto space-y-3 px-4">
                        <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center mx-auto shadow-2xs">
                          <Search className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="font-bold text-stone-900 text-sm">
                            {t('records_no_match', { query: searchTerm })}
                          </h4>
                          <p className="text-xs text-stone-500 mt-1">
                            {t('records_try_different_search', 'Try adjusting your search keywords or broadening the scope.')}
                          </p>
                        </div>
                        <div className="flex items-center justify-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setSearchTerm('')}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-750 hover:bg-emerald-850 text-white font-bold text-xs transition cursor-pointer shadow-2xs"
                          >
                            {t('records_clear_search', 'Clear Search')}
                          </button>
                          {searchScope !== 'all' && (
                            <button
                              type="button"
                              onClick={() => setSearchScope('all')}
                              className="px-3.5 py-1.5 rounded-xl border border-stone-300 hover:bg-stone-50 text-stone-700 font-semibold text-xs transition cursor-pointer"
                            >
                              {t('records_all_fields', 'Search All Fields')}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 py-4">
                        <p className="text-stone-400 text-sm">{t('records_no_matching_filters', 'No swine records found matching your active filters.')}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBarangay('all');
                            setSwineTypeFilter('all');
                            setFarmScaleFilter('all');
                            setAsfZoneFilter('all');
                            setStatusFilter('all');
                            setBiosecurityFilter('all');
                            setReadyFilter('all');
                            setAgeFilter('all');
                          }}
                          className="text-xs text-emerald-800 hover:text-emerald-950 font-bold underline cursor-pointer"
                        >
                          {t('common_reset', 'Reset all filters')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                paginatedFarmerRepresentatives.map(swine => {
                  const farmerKey = getFarmerGroupKey(swine);
                  const farmerGroup = groupByKey.get(farmerKey)!;
                  const farmerRecords = farmerGroup.records;
                  const farmerSelectedCount = farmerRecords.filter(record => selectedRecordIds.has(record.id)).length;
                  const isSelected = farmerRecords.length > 0 && farmerSelectedCount === farmerRecords.length;
                  const isFarmerExpanded = expandedFarmerKey === farmerKey;
                  const farmerSwineCount = farmerRecords.length;
                  const panelId = `farmer-swines-${swine.id}`;
                  return (
                  <React.Fragment key={swine.id}>
                    <tr
                      className={`transition group ${
                        isSelected ? 'bg-amber-50/75 hover:bg-amber-100/70' : 'hover:bg-emerald-50/40'
                      }`}
                    >
                    {/* Column 0: Checkbox Selector (Admin Only) */}
                    {currentRole === 'admin' && (
                      <td
                        className={`py-3 px-3 text-center sticky left-0 z-20 border-r border-stone-200 w-10 min-w-[40px] max-w-[40px] ${
                          isSelected
                            ? 'bg-amber-50/95 group-hover:bg-amber-100/90'
                            : 'bg-white group-hover:bg-emerald-50/90'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          ref={element => {
                            if (element) {
                              element.indeterminate = farmerSelectedCount > 0 && !isSelected;
                            }
                          }}
                          onChange={() => handleToggleSelectFarmer(farmerRecords)}
                          className="w-4 h-4 rounded text-emerald-700 focus:ring-emerald-500 border-stone-300 cursor-pointer accent-emerald-700"
                          aria-label={`Select all ${farmerSwineCount} swine records for ${farmerGroup.farmer.farmerName}`}
                        />
                      </td>
                    )}

                    {/* Column 1: Pig ID Tag (Immutable Read-only) */}
                    <td
                      className={`py-3 px-4 sticky ${
                        currentRole === 'admin' ? 'left-10' : 'left-0'
                      } z-10 border-r border-stone-200 ${
                        isSelected
                          ? 'bg-amber-50/95 group-hover:bg-amber-100/90'
                          : 'bg-white group-hover:bg-emerald-50/90'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <SwinePhoto src={swine.photoUrl} className="h-9 w-9 shrink-0 shadow-2xs" />
                        <div>
                          <span className="font-mono font-black text-emerald-950 block text-xs flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5 text-stone-400" />
                            <HighlightMatch text={swine.computedPigId} query={searchTerm} />
                          </span>
                          {swine.earTagNo && swine.earTagNo !== swine.computedPigId && (
                            <span className="text-[10px] text-stone-500 font-mono block">
                              Ear: <HighlightMatch text={swine.earTagNo} query={searchTerm} />
                            </span>
                          )}
                          <span className="text-[10px] text-stone-400 block">
                            Reg: {new Date(swine.registeredAt).toLocaleDateString()}
                          </span>
                          {swine.isSynced === false ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.2 rounded-full mt-0.5 border border-amber-300">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse"></span>
                              {t('sync_badge_pending', 'Pending Sync')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded-full mt-0.5 border border-emerald-200">
                              <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                              {t('sync_badge_synced', 'Synced')}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Column 2: Farmer / Owner */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      <div className="flex items-start gap-1.5">
                        {farmerKey ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (isFarmerExpanded) {
                                setExpandedFarmerKey(null);
                              } else {
                                setExpandedFarmerKey(farmerKey);
                              }
                            }}
                            aria-expanded={isFarmerExpanded}
                            aria-controls={panelId}
                            className="mt-0.5 rounded-sm text-stone-500 transition hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-emerald-700"
                            title={isFarmerExpanded ? 'Collapse this farmer’s swine' : 'Expand this farmer’s swine'}
                          >
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isFarmerExpanded ? '' : '-rotate-90'}`} />
                          </button>
                        ) : (
                          <span className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            disabled={!farmerKey}
                            onClick={() => {
                              if (!farmerKey) return;
                              if (isFarmerExpanded) {
                                setExpandedFarmerKey(null);
                              } else {
                                setExpandedFarmerKey(farmerKey);
                              }
                            }}
                            aria-expanded={isFarmerExpanded}
                            aria-controls={panelId}
                            className="text-left font-bold text-stone-900 disabled:cursor-default"
                          >
                            <HighlightMatch text={swine.farmerName} query={searchTerm} />
                          </button>
                      {swine.farmName && (
                        <div className="text-[10px] text-emerald-800 font-medium truncate max-w-[180px]">
                          Farm: <HighlightMatch text={swine.farmName} query={searchTerm} />
                        </div>
                      )}
                      {swine.farmerContact && (
                        <div className="text-[10px] text-stone-400 font-mono">
                          <HighlightMatch text={swine.farmerContact} query={searchTerm} />
                        </div>
                      )}
                          {farmerKey && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full bg-stone-100 px-1.5 py-0.5 text-[9px] font-semibold text-stone-600">
                                {farmerSwineCount} swine
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Column 2a: Breed */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      <span className="font-semibold text-stone-800 text-xs">
                        <HighlightMatch text={swine.breed || 'Large White Cross'} query={searchTerm} />
                      </span>
                    </td>

                    {/* Column 2b: Sex */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      <span className="capitalize text-stone-700 text-xs font-medium">
                        {swine.gender === 'male' ? 'Male (Intact)' : swine.gender === 'female' ? 'Female (Gilt/Sow)' : 'Castrated'}
                      </span>
                    </td>

                    {/* Column 3: Barangay */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      <span className="font-semibold text-stone-800">
                        Brgy. <HighlightMatch text={swine.barangay} query={searchTerm} />
                      </span>
                    </td>

                    {/* Column 4: Birth Date */}
                    <td className="py-3 px-4 border-r border-stone-200 text-stone-600">
                      {swine.birthDate ? (
                        <span className="font-medium text-xs text-stone-800">
                          {formatDobDisplay(swine.birthDate)}
                        </span>
                      ) : (
                        <span className="text-amber-800 bg-amber-50 px-2 py-0.5 rounded text-[10px] font-semibold border border-amber-200">
                          DOB not recorded
                        </span>
                      )}
                    </td>

                    {/* Column 5: Age (Automatically Calculated) */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      {swine.computedHasDob ? (
                        <span className="font-bold text-emerald-950 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 text-xs shadow-2xs inline-flex items-center gap-1.5 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          {swine.computedAgeLabel}
                        </span>
                      ) : (
                        <span className="font-medium text-stone-500 bg-stone-100 px-2 py-0.5 rounded text-[11px] italic whitespace-nowrap">
                          Age unavailable — DOB not recorded
                        </span>
                      )}
                    </td>

                    {/* Column 6: Estimated Weight (Automated Range) */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      <span className="font-bold text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 text-[11px]">
                        {swine.computedEstimatedWeight}
                      </span>
                    </td>

                    {/* Column 7: Actual Weight */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      {swine.computedActualWeight ? (
                        <span className="font-bold text-stone-900">
                          {swine.computedActualWeight} kg
                        </span>
                      ) : (
                        <span className="text-stone-400 italic">—</span>
                      )}
                    </td>

                    {/* Column 8: Swine Type */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-100 text-stone-800 border border-stone-200">
                        {getSwineTypeLabel(swine.swineType)}
                      </span>
                    </td>

                    {/* Column 9: Farm Scale */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      {getFarmScaleBadge(swine.computedFarmScale)}
                    </td>

                    {/* Column 10: ASF Zone */}
                    <td className="py-3 px-4 border-r border-stone-200">
                      {getAsfZoneBadge(swine.computedAsfZone)}
                    </td>

                    {/* Column 11: Biosecurity Warning */}
                    <td className="py-3 px-4 border-r border-stone-200 text-center">
                      {swine.computedHasWarning ? (
                        <span
                          className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-100 text-red-900 border border-red-300 inline-flex items-center gap-1 animate-pulse"
                          title={`Breeding Boar in ${swine.computedAsfZone} Zone. Movement restrictions apply.`}
                        >
                          <AlertTriangle className="w-3 h-3 text-red-600" />
                          <span>{t('records_biosecurity_warning', 'BIOSECURITY')}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-stone-400 font-medium">—</span>
                      )}
                    </td>

                    {/* Column 12: Status */}
                    <td className="py-3 px-4 border-r border-stone-200 text-center">
                      {swine.status === 'sold' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-700">
                          {getStatusLabel('sold')}
                        </span>
                      ) : swine.computedIsReady ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                          <Sparkles className="w-2.5 h-2.5 text-amber-600" /> {t('records_ready_to_sell', 'READY')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {getStatusLabel(swine.status || 'active')}
                        </span>
                      )}
                    </td>

                    {/* Column 12.5+: Dynamic Admin-Configured Schema Values */}
                    {customDynamicColumns.map(item => {
                      const rawVal = getFieldValue(swine, item.field);
                      const formattedVal = formatFieldValue(rawVal, item.field);
                      return (
                        <td
                          key={item.field.id}
                          className="py-3 px-4 border-r border-stone-200 text-stone-700"
                        >
                          <span className="font-medium text-xs break-words max-w-[200px] inline-block">
                            {formattedVal}
                          </span>
                        </td>
                      );
                    })}

                    {/* Column 13: Actions */}
                    <td className={`sticky right-0 z-20 min-w-[132px] border-l border-stone-200 px-3 py-3 text-right shadow-2xs ${
                      isSelected ? 'bg-amber-50 group-hover:bg-amber-100' : 'bg-white group-hover:bg-emerald-50'
                    }`}>
                      <select
                        defaultValue=""
                        aria-label={`Actions for ${swine.computedPigId || swine.pigIdTag || swine.earTagNo}`}
                        onChange={event => {
                          const action = event.currentTarget.value;
                          event.currentTarget.selectedIndex = 0;
                          if (action === 'view') setViewingRecord(swine);
                          else if (action === 'farmer') setExpandedFarmerKey(farmerKey);
                          else if (action === 'map' && onViewOnMap) onViewOnMap(swine);
                          else if (action === 'print') setPrintSingleRecord(swine);
                          else if (action === 'certificate') onIssueCertificate(swine);
                          else if (action === 'edit' && currentRole !== 'agent') onEditSwine(swine);
                          else if (action === 'ready' && currentRole !== 'agent' && swine.status !== 'sold') handleToggleSell(swine);
                          else if (action === 'sold' && currentRole !== 'agent' && swine.status !== 'sold') handleMarkSold(swine);
                          else if (action === 'archive' && currentRole !== 'agent') handleToggleArchive(swine.id);
                          else if (action === 'delete' && currentRole === 'admin') setDeleteConfirmRecord(swine);
                        }}
                        className="min-h-11 w-full max-w-36 rounded-lg border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-800 focus-visible:outline-2 focus-visible:outline-emerald-700"
                      >
                        <option value="" disabled>Actions</option>
                        <optgroup label="Record">
                          <option value="view">View details</option>
                          <option value="farmer">View farmer&apos;s swine</option>
                          {currentRole !== 'agent' && <option value="edit">Edit record</option>}
                        </optgroup>
                        {onViewOnMap && <optgroup label="Location"><option value="map">View on GIS map</option></optgroup>}
                        <optgroup label="Documents">
                          <option value="print">Print swine record</option>
                          <option value="certificate">Generate certificate</option>
                        </optgroup>
                        {currentRole !== 'agent' && <optgroup label="Record status">
                          {swine.status !== 'sold' && <>
                            <option value="ready">{swine.readyToSell ? 'Remove ready to sell' : 'Mark ready to sell'}</option>
                            <option value="sold">Mark as sold</option>
                          </>}
                          <option value="archive">{swine.isArchived ? 'Restore record' : 'Archive record'}</option>
                        </optgroup>}
                        {currentRole === 'admin' && <optgroup label="Destructive"><option value="delete">Delete record</option></optgroup>}
                      </select>
                    </td>
                    </tr>
                    {isFarmerExpanded
                      ? renderExpandedFarmerRow(farmerKey, swine.id)
                      : null}
                  </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {totalRecords > 0 && (
          <div className="px-4 py-3 bg-stone-50 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-stone-600 font-medium flex items-center gap-2">
              <span>
                {t('pagination_page', 'Page')} <strong>{validCurrentPage}</strong> {t('pagination_of', 'of')} <strong>{totalPages}</strong> ({totalFarmerGroups} farmers · {totalRecords} {t('records_total_heads', 'records')})
              </span>
              {currentRole === 'admin' && selectedRecordIds.size > 0 && (
                <span className="text-emerald-800 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 text-[11px]">
                  {t('records_selected_count', { count: selectedRecordIds.size }, `${selectedRecordIds.size} selected`)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={t('pagination_first', 'First page')}
                disabled={validCurrentPage <= 1}
                onClick={() => setCurrentPage(1)}
                className="pagination-edge-control min-h-11 px-2.5 py-1 rounded-lg border border-stone-300 bg-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-100 cursor-pointer shadow-2xs"
              >
                {t('pagination_first', 'First')}
              </button>
              <button
                type="button"
                aria-label={t('pagination_prev', 'Previous page')}
                disabled={validCurrentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2 font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-100 cursor-pointer shadow-2xs"
                title={t('pagination_prev', 'Previous')}
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="pagination-button-label">{t('pagination_prev', 'Previous')}</span>
              </button>

              <span className="min-h-11 px-3 py-1 font-bold text-emerald-900 bg-emerald-100 rounded-lg inline-flex items-center" aria-current="page">
                {t('pagination_page', 'Page')} {validCurrentPage} {t('pagination_of', 'of')} {totalPages}
              </span>

              <button
                type="button"
                aria-label={t('pagination_next', 'Next page')}
                disabled={validCurrentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-2 font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-100 cursor-pointer shadow-2xs"
                title={t('pagination_next', 'Next')}
              >
                <ChevronRight className="w-4 h-4" />
                <span className="pagination-button-label">{t('pagination_next', 'Next')}</span>
              </button>
              <button
                type="button"
                aria-label={t('pagination_last', 'Last page')}
                disabled={validCurrentPage >= totalPages}
                onClick={() => setCurrentPage(totalPages)}
                className="pagination-edge-control min-h-11 px-2.5 py-1 rounded-lg border border-stone-300 bg-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-stone-100 cursor-pointer shadow-2xs"
              >
                {t('pagination_last', 'Last')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ===================== VIEW DETAILS MODAL ===================== */}
      {viewingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden my-6 border border-stone-200 animate-fadeIn">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-900 text-white p-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={viewingRecord.photoUrl || '/icon.svg'}
                  alt="Swine"
                  className="w-14 h-14 rounded-2xl object-cover border-2 border-emerald-400/50 shadow-md"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-black text-lg text-emerald-200 flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-emerald-400" />
                      {viewingRecord.pigIdTag || viewingRecord.earTagNo}
                    </span>
                    {getFarmScaleBadge(
                      viewingRecord.farmScale ||
                        classifyFarmScale(viewingRecord.penCapacity || (viewingRecord.farmType === 'commercial' ? 50 : 5))
                    )}
                    {getAsfZoneBadge(getBarangayASFZone(viewingRecord.barangay, barangays))}
                    <span className="bg-emerald-800 text-emerald-100 px-2 py-0.5 rounded-full text-[10px] font-bold">
                      {viewingRecord.readyToSell ? 'READY FOR SALE' : viewingRecord.status.toUpperCase()}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white mt-1">
                    {viewingRecord.farmerName} • Brgy. {viewingRecord.barangay}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingRecord(null)}
                className="text-white/70 hover:text-white p-2 rounded-xl hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto text-xs text-stone-800">
              {/* Biosecurity Warning Banner if applicable */}
              {shouldShowASFWarning(
                viewingRecord.swineType,
                getBarangayASFZone(viewingRecord.barangay, barangays)
              ) && (
                <div className="bg-red-50 border-2 border-red-400 p-4 rounded-2xl space-y-2 animate-fadeIn shadow-2xs">
                  <div className="flex items-center gap-2 text-red-900 font-black text-sm">
                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                    <span>⚠ BIOSECURITY WARNING</span>
                  </div>
                  <p className="text-xs text-red-800 font-semibold leading-relaxed">
                    This swine is classified as a <strong>BREEDING_BOAR</strong> and is currently associated with a{' '}
                    <strong>{getBarangayASFZone(viewingRecord.barangay, barangays)}</strong> ASF zone.
                    Review applicable biosecurity requirements and local veterinary quarantine protocols before movement or transport.
                  </p>
                </div>
              )}

              {/* Core Recalculated Identification Block */}
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3">
                <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
                  <Lock className="w-4 h-4 text-emerald-700" />
                  <h4 className="font-black text-stone-900 text-xs uppercase tracking-wide">
                    Immutable Swine Identification & Core Metrics
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Swine ID / Registry ID</span>
                    <span className="font-mono font-black text-emerald-950 text-sm block mt-0.5">
                      🔒 {viewingRecord.registry_id || viewingRecord.pigIdTag || viewingRecord.earTagNo}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Farmer / Raiser</span>
                    <span className="font-bold text-stone-900 block mt-0.5">{viewingRecord.farmerName}</span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Barangay</span>
                    <span className="font-bold text-stone-900 block mt-0.5">Brgy. {viewingRecord.barangay}</span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Date of Birth</span>
                    <span className="font-bold text-stone-900 block mt-0.5">
                      {formatDobDisplay(viewingRecord.birthDate || viewingRecord.dateOfBirth || viewingRecord.date_of_birth || viewingRecord.dob)}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Breed</span>
                    <span className="font-bold text-stone-900 block mt-0.5">{viewingRecord.breed || 'Standard Commercial'}</span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Sex</span>
                    <span className="font-bold text-stone-900 block mt-0.5">
                      {viewingRecord.gender ? viewingRecord.gender.toUpperCase() : (viewingRecord.sex ? viewingRecord.sex.toUpperCase() : 'Not recorded')}
                    </span>
                  </div>

                  {/* Visually Distinct Auto-Aging CURRENT AGE Card */}
                  <div className="bg-gradient-to-br from-emerald-50 via-teal-50/50 to-emerald-100/60 p-4 rounded-xl border-2 border-emerald-500/80 shadow-xs sm:col-span-2 md:col-span-3">
                    {(() => {
                      const dobVal = viewingRecord.birthDate || viewingRecord.dateOfBirth || viewingRecord.date_of_birth || viewingRecord.dob;
                      const age = calculateSwineAge(dobVal);
                      return (
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200/80 pb-2 mb-2">
                            <span className="text-[11px] font-black text-emerald-950 uppercase tracking-wider">
                              CURRENT AGE
                            </span>
                            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 px-2.5 py-0.5 rounded-full shadow-2xs">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                              Automatically updated
                            </span>
                          </div>
                          <div className="flex flex-wrap items-baseline gap-3">
                            <span className="text-xl sm:text-2xl font-black text-emerald-950 tracking-tight">
                              {age.display}
                            </span>
                            {age.hasDob && (
                              <span className="text-xs font-semibold text-emerald-800/90">
                                ({age.totalDays.toLocaleString()} calendar days • continuously aging based on today's date)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Estimated Weight (Auto)</span>
                    <span className="font-bold text-emerald-900 block mt-0.5">
                      {(() => {
                        const dobVal = viewingRecord.birthDate || viewingRecord.dateOfBirth || viewingRecord.date_of_birth || viewingRecord.dob;
                        const age = calculateSwineAge(dobVal);
                        return getEstimatedWeightRange(age.hasDob ? age.totalDays : (viewingRecord.ageDays || 0));
                      })()}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Actual Weight</span>
                    <span className="font-bold text-stone-900 block mt-0.5">
                      {viewingRecord.actualWeightKg ? `${viewingRecord.actualWeightKg} kg` : viewingRecord.weightKg ? `${viewingRecord.weightKg} kg` : 'Not recorded'}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Swine Classification</span>
                    <span className="font-bold text-stone-900 block mt-0.5 uppercase">
                      {viewingRecord.swineType}
                    </span>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-stone-200/80 shadow-2xs sm:col-span-2 md:col-span-3">
                    <span className="text-[10px] text-stone-500 font-bold block uppercase tracking-wider">Market Status</span>
                    <span className="font-bold text-amber-900 block mt-0.5">
                      {viewingRecord.readyToSell ? '🌟 Ready for Market Sale' : viewingRecord.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dynamic Form Sections from Schema */}
              {formSchema.sections
                .filter(sec => sec.visible !== false)
                .map(section => {
                  const secFields = (section.fields || []).filter(f => f.visible !== false);
                  if (secFields.length === 0) return null;

                  return (
                    <div key={section.id} className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3">
                      <div className="flex items-center gap-2 border-b border-stone-200 pb-2">
                        <Layers className="w-4 h-4 text-emerald-700" />
                        <h4 className="font-black text-stone-900 text-xs uppercase tracking-wide">
                          {section.title}
                        </h4>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {secFields.map(field => {
                          const val = getFieldValue(viewingRecord, field);
                          const formatted = formatFieldValue(val, field);

                          return (
                            <div key={field.id} className="bg-white p-2.5 rounded-xl border border-stone-200/80 shadow-2xs">
                              <span className="text-[10px] text-stone-500 font-bold block">
                                {field.label}
                              </span>
                              <span className="font-semibold text-stone-900 block mt-0.5 break-words">
                                {formatted}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Modal Footer Actions */}
            <div className="bg-stone-100 px-6 py-3.5 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] text-stone-500">
                Registered on {new Date(viewingRecord.registeredAt).toLocaleString()} by {viewingRecord.registeredBy || 'DA Extension Worker'}
              </span>

              <div className="flex items-center gap-2 flex-wrap">
                {onViewOnMap && (
                  <button
                    type="button"
                    onClick={() => {
                      const rec = viewingRecord;
                      setViewingRecord(null);
                      onViewOnMap(rec);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-600 text-white font-bold flex items-center gap-1.5 transition cursor-pointer text-xs shadow-2xs"
                  >
                    <MapPin className="w-3.5 h-3.5" /> View on Map
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const rec = viewingRecord;
                    setViewingRecord(null);
                    setPrintSingleRecord(rec);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold flex items-center gap-1.5 transition cursor-pointer text-xs"
                >
                  <Printer className="w-3.5 h-3.5" /> Print Record
                </button>

                {currentRole !== 'agent' && (
                  <button
                    type="button"
                    onClick={() => {
                      const rec = viewingRecord;
                      setViewingRecord(null);
                      onEditSwine(rec);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-bold flex items-center gap-1.5 transition cursor-pointer text-xs"
                  >
                    <Edit className="w-3.5 h-3.5" /> Edit Record
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const rec = viewingRecord;
                    setViewingRecord(null);
                    onIssueCertificate(rec);
                  }}
                  className="px-4 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer text-xs"
                >
                  <FileText className="w-3.5 h-3.5" /> Issue Certificate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== DELETE CONFIRMATION MODAL ===================== */}
      {deleteConfirmRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-base font-black text-stone-900">Delete Swine Record?</h3>
              <p className="text-xs text-stone-500 font-medium">
                This action is permanent and cannot be undone.
              </p>
            </div>

            <div className="bg-stone-50 p-3.5 rounded-2xl border border-stone-200 text-center space-y-1">
              <div className="font-mono font-black text-sm text-stone-900">
                🔒 {deleteConfirmRecord.pigIdTag || deleteConfirmRecord.earTagNo}
              </div>
              <div className="text-xs font-bold text-stone-700">
                {deleteConfirmRecord.farmerName}
              </div>
              <div className="text-[11px] text-stone-500">
                Brgy. {deleteConfirmRecord.barangay}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmRecord(null)}
                className="flex-1 py-2 rounded-xl border border-stone-300 text-stone-700 font-bold hover:bg-stone-50 transition cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold transition cursor-pointer text-xs shadow-sm"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== BULK DELETE CONFIRMATION MODAL ===================== */}
      {showBulkDeleteModal && selectedRecordIds.size > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-stone-200 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center text-red-600 mx-auto shadow-2xs">
              <Trash2 className="w-7 h-7" />
            </div>

            <div className="text-center space-y-1">
              <h3 className="text-lg font-black text-stone-900">
                Bulk Delete Swine Records?
              </h3>
              <p className="text-xs text-stone-500 font-medium">
                You are about to permanently remove{' '}
                <strong className="text-red-700 font-bold">
                  {selectedRecordIds.size} swine {selectedRecordIds.size === 1 ? 'record' : 'records'}
                </strong>{' '}
                from the Hinunangan database.
              </p>
            </div>

            {/* Warning Callout Box */}
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3.5 text-xs space-y-1 text-red-900">
              <div className="flex items-center gap-1.5 font-bold text-red-800">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
                <span>Permanent Irreversible Action</span>
              </div>
              <p className="text-[11px] text-red-700 leading-relaxed">
                This action cannot be undone. All selected swine registrations, ear tags, computed metrics, and audit entries will be permanently erased.
              </p>
            </div>

            {/* Selected Swine Summary & Preview */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-stone-600 px-1 font-semibold">
                <span>Selected Records ({selectedRecordIds.size}):</span>
                <span className="text-[10px] text-stone-400">
                  {new Set(selectedRecordsList.map(s => s.barangay)).size} barangay(s) affected
                </span>
              </div>
              <div className="bg-stone-50 rounded-2xl border border-stone-200 max-h-48 overflow-y-auto divide-y divide-stone-200/70 p-2">
                {selectedRecordsList.slice(0, 8).map(record => (
                  <div key={record.id} className="py-2 px-2 flex items-center justify-between text-xs">
                    <div className="min-w-0 pr-2">
                      <span className="font-mono font-black text-stone-900 text-[11px] block truncate">
                        🔒 {record.computedPigId || record.pigIdTag || record.earTagNo}
                      </span>
                      <span className="text-[10px] text-stone-500 block truncate">
                        {record.farmerName} &bull; Brgy. {record.barangay}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-stone-200 text-stone-700 shrink-0">
                      {record.swineType || 'Swine'}
                    </span>
                  </div>
                ))}
                {selectedRecordIds.size > 8 && (
                  <div className="py-2 text-center text-[11px] text-stone-500 font-semibold bg-stone-100/60 rounded-xl mt-1">
                    + {selectedRecordIds.size - 8} more selected records
                  </div>
                )}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-stone-300 text-stone-700 font-bold hover:bg-stone-50 transition cursor-pointer text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmBulkDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold transition cursor-pointer text-xs shadow-sm flex items-center justify-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete {selectedRecordIds.size} Records</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== PRINT SINGLE SWINE RECORD MODAL ===================== */}
      {printSingleRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-stone-200 overflow-hidden my-6 animate-fadeIn">
            {/* Action Bar */}
            <div className="bg-stone-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-xs">Official Individual Swine Record Sheet</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => triggerScopedPrint('swine-record')}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" /> Print Now
                </button>
                <button
                  type="button"
                  onClick={() => setPrintSingleRecord(null)}
                  className="text-stone-400 hover:text-white p-1 rounded cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Document Body */}
            <div data-print-document="swine-record" className="p-8 space-y-6 text-xs text-stone-800 printable-document bg-white">
              {/* Header */}
              <div className="text-center border-b-2 border-emerald-800 pb-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <img src={reportLeftLogo} alt="Left Seal" className="w-16 h-16 object-contain" />
                  <div className="flex-1">
                    <p className="text-[11px] uppercase tracking-wider text-stone-600 font-medium">
                      Republic of the Philippines • Province of Southern Leyte
                    </p>
                    <h2 className="text-base font-black text-emerald-950 tracking-tight">
                      MUNICIPALITY OF HINUNANGAN
                    </h2>
                    <h3 className="text-xs font-bold text-emerald-800">
                      OFFICE OF THE MUNICIPAL AGRICULTURIST
                    </h3>
                  </div>
                  <img src={reportRightLogo} alt="Right Seal" className="w-16 h-16 object-contain" />
                </div>
                <h4 className="text-sm font-black uppercase text-stone-900 mt-3 tracking-wide">
                  HINUNANGAN SWINE REGISTRY - OFFICIAL SWINE RECORD
                </h4>
              </div>

              {/* Warning box if applicable */}
              {shouldShowASFWarning(
                printSingleRecord.swineType,
                getBarangayASFZone(printSingleRecord.barangay, barangays)
              ) && (
                <div className="border-2 border-red-600 bg-red-50 p-3.5 rounded-xl text-red-900 font-bold space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-red-700">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>⚠ BIOSECURITY WARNING</span>
                  </div>
                  <p className="text-[11px] font-normal leading-tight">
                    This swine is classified as a <strong>BREEDING_BOAR</strong> and is currently associated with a{' '}
                    <strong>{getBarangayASFZone(printSingleRecord.barangay, barangays)}</strong> ASF zone.
                    Review applicable biosecurity requirements before movement or transport.
                  </p>
                </div>
              )}

              {/* Data Grid matching Official Swine Record format */}
              <div className="grid grid-cols-2 gap-4 border border-stone-300 p-4 rounded-xl bg-stone-50/50">
                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Swine ID / Tag</span>
                  <span className="font-mono font-black text-sm text-emerald-950 block mt-0.5">
                    {printSingleRecord.registry_id || printSingleRecord.pigIdTag || printSingleRecord.earTagNo}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Farmer / Hog Raiser</span>
                  <span className="font-bold text-stone-900 block mt-0.5">{printSingleRecord.farmerName}</span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Barangay</span>
                  <span className="font-bold text-stone-900 block mt-0.5">Brgy. {printSingleRecord.barangay}</span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Date of Birth</span>
                  <span className="font-bold text-stone-900 block mt-0.5">
                    {formatDobDisplay(printSingleRecord.birthDate || printSingleRecord.dateOfBirth || printSingleRecord.date_of_birth || printSingleRecord.dob)}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Breed</span>
                  <span className="font-bold text-stone-900 block mt-0.5">
                    {printSingleRecord.breed || 'Standard Commercial'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Sex</span>
                  <span className="font-bold text-stone-900 block mt-0.5">
                    {printSingleRecord.gender ? printSingleRecord.gender.toUpperCase() : (printSingleRecord.sex ? printSingleRecord.sex.toUpperCase() : 'Not recorded')}
                  </span>
                </div>

                <div className="col-span-2 bg-emerald-50/60 p-3 rounded-xl border border-emerald-300/80">
                  <span className="text-[10px] text-emerald-900 font-extrabold block uppercase tracking-wider">
                    Age at Time of Report
                  </span>
                  <span className="font-black text-emerald-950 text-sm block mt-0.5">
                    {calculateSwineAge(printSingleRecord.birthDate || printSingleRecord.dateOfBirth || printSingleRecord.date_of_birth || printSingleRecord.dob).display}
                  </span>
                  <span className="text-[10px] text-emerald-800 font-medium">
                    Calculated dynamically as of {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Swine Type</span>
                  <span className="font-bold text-stone-900 block mt-0.5 uppercase">
                    {printSingleRecord.swineType === 'boar' ? 'BREEDING_BOAR' : printSingleRecord.swineType.toUpperCase()}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Estimated Weight (Automated)</span>
                  <span className="font-bold text-emerald-900 block mt-0.5">
                    {(() => {
                      const dobVal = printSingleRecord.birthDate || printSingleRecord.dateOfBirth || printSingleRecord.date_of_birth || printSingleRecord.dob;
                      const age = calculateSwineAge(dobVal);
                      return getEstimatedWeightRange(age.hasDob ? age.totalDays : (printSingleRecord.ageDays || 0));
                    })()}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Actual Measured Weight</span>
                  <span className="font-bold text-stone-900 block mt-0.5">
                    {printSingleRecord.actualWeightKg ? `${printSingleRecord.actualWeightKg} kg` : printSingleRecord.weightKg ? `${printSingleRecord.weightKg} kg` : 'Not recorded'}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Farm Classification</span>
                  <span className="font-bold text-stone-900 block mt-0.5">
                    {printSingleRecord.farmScale || classifyFarmScale(printSingleRecord.penCapacity || (printSingleRecord.farmType === 'commercial' ? 50 : 5))}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Current ASF Zone</span>
                  <span className="font-bold text-stone-900 block mt-0.5">
                    {getBarangayASFZone(printSingleRecord.barangay, barangays)} ZONE
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Registry Status</span>
                  <span className="font-bold text-stone-900 block mt-0.5 uppercase">
                    {printSingleRecord.status}
                  </span>
                </div>

                <div>
                  <span className="text-[10px] text-stone-500 font-bold block uppercase">Market Readiness</span>
                  <span className="font-bold text-emerald-900 block mt-0.5">
                    {printSingleRecord.readyToSell ? 'READY FOR SALE' : 'GROWING HERD'}
                  </span>
                </div>
              </div>

              {/* Signatures Footer */}
              <div className="pt-8 grid grid-cols-2 gap-8 text-center">
                <div>
                  <p className="text-stone-500 mb-8">Prepared & Inspected by:</p>
                  <p className="font-bold border-t border-stone-400 pt-1 text-stone-900 uppercase">
                    {currentUser?.name || '—'}
                  </p>
                  <p className="text-[10px] text-stone-500">Barangay Agricultural Extension Worker</p>
                </div>
                <div>
                  <p className="text-stone-500 mb-8">Attested & Approved by:</p>
                  <p className="font-bold border-t border-stone-400 pt-1 text-stone-900 uppercase">
                    ENGR. ARNEL M. VASQUEZ
                  </p>
                  <p className="text-[10px] text-stone-500">
                    Municipal Agricultural Officer (MAO) - Hinunangan
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== TABLE PRINT REPORT MODAL ===================== */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative bg-white w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden my-6 border border-stone-200">
            <button
              type="button"
              onClick={() => setShowPrintModal(false)}
              aria-label="Close"
              title="Close"
              className="absolute right-4 top-4 z-10 inline-flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition focus:outline-hidden focus:ring-2 focus:ring-emerald-400/70"
            >
              <X className="w-5 h-5" />
            </button>
            {/* Top Bar */}
            <div className="bg-stone-900 text-white px-6 py-4 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="font-bold text-sm">Print Official Swine Registry Summary Report</h3>
                  <p className="text-[10px] text-stone-400">
                    Official Municipal Agriculture Document with Customizable Logos & Recalculated Business Rules
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLogoCustomizer(!showLogoCustomizer)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition cursor-pointer ${
                    showLogoCustomizer
                      ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                      : 'border-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700'
                  }`}
                  title="Change Official Logos & Seals"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                  <span>{showLogoCustomizer ? 'Close Logos' : 'Change Logos'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (registryPrintRecords.length === 0) {
                      setPrintValidationError('No records match this print selection. Select records or change the filters.');
                      return;
                    }
                    setPrintValidationError(null);
                    triggerScopedPrint('registry-report');
                  }}
                  disabled={registryPrintRecords.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                >
                  <Printer className="w-3.5 h-3.5" /> Print Now
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintModal(false)}
                  className="text-stone-400 hover:text-white px-2 py-1 text-sm font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-6 py-3 text-xs">
              <fieldset className="flex flex-wrap items-center gap-4">
                <legend className="sr-only">Records to print</legend>
                <label className="inline-flex min-h-11 items-center gap-2 font-semibold text-stone-800">
                  <input
                    type="radio"
                    name="registry-print-scope"
                    checked={printRecordScope === 'all'}
                    onChange={() => setPrintRecordScope('all')}
                  />
                  All {sortedRecords.length} filtered records
                </label>
                <label className={`inline-flex min-h-11 items-center gap-2 font-semibold ${
                  selectedFilteredRecords.length ? 'text-stone-800' : 'text-stone-400'
                }`}>
                  <input
                    type="radio"
                    name="registry-print-scope"
                    checked={printRecordScope === 'selected'}
                    onChange={() => setPrintRecordScope('selected')}
                    disabled={selectedFilteredRecords.length === 0}
                  />
                  Selected {selectedFilteredRecords.length} filtered records
                </label>
              </fieldset>
              <p className="font-semibold text-stone-700" role="status">
                Print preview: {registryPrintRecords.length} record{registryPrintRecords.length === 1 ? '' : 's'}
              </p>
            </div>

            {printValidationError && (
              <p role="alert" className="border-b border-rose-200 bg-rose-50 px-6 py-3 text-xs font-semibold text-rose-800">
                {printValidationError}
              </p>
            )}

            {/* Expandable Logo Customizer Panel */}
            {showLogoCustomizer && (
              <div className="bg-amber-50/70 border-b border-amber-200 p-4 space-y-3 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-950 text-xs flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-amber-700" />
                    Customize & Save Official Report Logos
                  </span>
                  {logoSaveSuccess && (
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Logos Saved!
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="bg-white p-3 rounded-xl border border-amber-200 space-y-2">
                    <span className="font-bold text-stone-800 block text-[11px]">
                      Left Header Logo (e.g. DA Emblem)
                    </span>
                    <div className="flex items-center gap-3">
                      <img
                        src={reportLeftLogo}
                        alt="Left Logo"
                        className="w-10 h-10 object-contain border p-1 rounded bg-stone-50"
                      />
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={reportLeftLogo}
                          onChange={e => setReportLeftLogo(e.target.value)}
                          placeholder="/icon.svg or https://..."
                          className="w-full px-2 py-1 border border-stone-300 rounded font-mono text-[10px]"
                        />
                        <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:underline cursor-pointer">
                          <Upload className="w-3 h-3" /> Upload Local Image
                          <input
                            type="file"
                            accept="image/*"
                            onChange={e => handleLogoFileUpload(e, 'left')}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-amber-200 space-y-2">
                    <span className="font-bold text-stone-800 block text-[11px]">
                      Right Header Logo (e.g. Municipal Seal)
                    </span>
                    <div className="flex items-center gap-3">
                      <img
                        src={reportRightLogo}
                        alt="Right Logo"
                        className="w-10 h-10 object-contain border p-1 rounded bg-stone-50"
                      />
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          value={reportRightLogo}
                          onChange={e => setReportRightLogo(e.target.value)}
                          placeholder="/icon.svg or https://..."
                          className="w-full px-2 py-1 border border-stone-300 rounded font-mono text-[10px]"
                        />
                        <label className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 hover:underline cursor-pointer">
                          <Upload className="w-3 h-3" /> Upload Local Image
                          <input
                            type="file"
                            accept="image/*"
                            onChange={e => handleLogoFileUpload(e, 'right')}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setReportLeftLogo('/icon.svg');
                      setReportRightLogo('/icon.svg');
                    }}
                    className="px-3 py-1 text-[11px] rounded-lg border border-stone-300 bg-white hover:bg-stone-50 text-stone-600 font-semibold cursor-pointer"
                  >
                    Reset Defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveReportLogos}
                    className="px-4 py-1 text-[11px] rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold flex items-center gap-1 cursor-pointer shadow-xs"
                  >
                    <Save className="w-3 h-3" /> Save Logos
                  </button>
                </div>
              </div>
            )}

            {/* Printable Content Area */}
            <div data-print-document="registry-report" className="p-8 space-y-6 text-xs text-stone-800 printable-document bg-white">
              {/* Official Header */}
              <div className="text-center border-b-2 border-emerald-800 pb-4">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <img src={reportLeftLogo} alt="Left Seal" className="w-16 h-16 object-contain" />
                  <div className="flex-1">
                    <p className="text-[11px] uppercase tracking-wider text-stone-600 font-medium">
                      Republic of the Philippines • Province of Southern Leyte
                    </p>
                    <h2 className="text-base font-black text-emerald-950 tracking-tight">
                      MUNICIPALITY OF HINUNANGAN
                    </h2>
                    <h3 className="text-xs font-bold text-emerald-800">
                      OFFICE OF THE MUNICIPAL AGRICULTURIST
                    </h3>
                  </div>
                  <img src={reportRightLogo} alt="Right Seal" className="w-16 h-16 object-contain" />
                </div>
                <h4 className="text-sm font-black uppercase text-stone-900 mt-3 tracking-wide">
                  OFFICIAL SWINE REGISTRY & MONITORING SUMMARY REPORT
                </h4>
                <p className="text-[10px] text-stone-500">
                  Report Generated on: {new Date().toLocaleDateString()} • Hinunangan, Southern Leyte
                  {' • '}Barangay: {selectedBarangay === 'all' ? 'All authorized barangays' : selectedBarangay}
                </p>
              </div>

              {/* Summary Metrics */}
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-stone-50 p-2.5 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[10px] block">Total Listed Swine</span>
                  <span className="font-bold text-base text-stone-900">{registryPrintRecords.length} Heads</span>
                </div>
                <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                  <span className="text-amber-700 text-[10px] block">Ready for Market</span>
                  <span className="font-bold text-base text-amber-900">
                    {registryPrintRecords.filter(s => s.computedIsReady).length} Heads
                  </span>
                </div>
                <div className="bg-red-50 p-2.5 rounded-xl border border-red-200">
                  <span className="text-red-700 text-[10px] block">Biosecurity Alerts</span>
                  <span className="font-bold text-base text-red-900">
                    {registryPrintRecords.filter(s => s.computedHasWarning).length} Boars
                  </span>
                </div>
                <div className="bg-stone-50 p-2.5 rounded-xl border border-stone-200">
                  <span className="text-stone-500 text-[10px] block">Est. Market Value</span>
                  <span className="font-bold text-base text-emerald-800">
                    ₱{registryPrintRecords.reduce((acc, s) => acc + (Number(s.estimatedPricePhp) || 0), 0).toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Report Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse border border-stone-300 text-[9.5px]">
                  <thead className="bg-stone-100 font-bold text-stone-800 border-b border-stone-300">
                    <tr>
                      <th className="p-1.5 border border-stone-300 text-center w-8">#</th>
                      <th className="p-1.5 border border-stone-300">Pig ID Tag</th>
                      {activePrintColumns.map(item => (
                        <th key={item.field.id} className="p-1.5 border border-stone-300">{item.field.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200">
                    {registryPrintRecords.length === 0 ? (
                      <tr>
                        <td colSpan={activePrintColumns.length + 2} className="p-6 text-center text-stone-600">
                          No records match the selected print options.
                        </td>
                      </tr>
                    ) : registryPrintRecords.map((s, idx) => (
                      <tr key={s.id} className="hover:bg-stone-50">
                        <td className="p-1.5 border border-stone-300 text-center font-mono text-stone-500">
                          {idx + 1}
                        </td>
                        <td className="p-1.5 border border-stone-300 font-mono font-bold text-emerald-950">
                          {s.computedPigId}
                        </td>
                        {activePrintColumns.map(item => (
                          <td key={item.field.id} className="break-words p-1.5 border border-stone-300">
                            {formatFieldValue(getFieldValue(s, item.field), item.field)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Signatories Footer */}
              <div className="pt-8 grid grid-cols-2 gap-8 text-center">
                <div>
                  <p className="text-stone-500 mb-8">Prepared & Inspected by:</p>
                  <p className="font-bold border-t border-stone-400 pt-1 text-stone-900 uppercase">
                    {currentUser?.name || 'Authorized DA Inspector'}
                  </p>
                  <p className="text-[10px] text-stone-500">Barangay Agricultural Focal Officer</p>
                </div>
                <div>
                  <p className="text-stone-500 mb-8">Attested & Approved by:</p>
                  <p className="font-bold border-t border-stone-400 pt-1 text-stone-900 uppercase">
                    ENGR. ARNEL M. VASQUEZ
                  </p>
                  <p className="text-[10px] text-stone-500">
                    Municipal Agricultural Officer (MAO) - Hinunangan
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== SELECT COLUMNS TO PRINT MODAL ===================== */}
      {showPrintSelectModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="relative bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
            <button
              type="button"
              onClick={() => setShowPrintSelectModal(false)}
              aria-label="Close"
              title="Close"
              className="absolute right-4 top-4 z-10 inline-flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition focus:outline-hidden focus:ring-2 focus:ring-emerald-400/70"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-5 bg-gradient-to-r from-emerald-900 to-teal-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Printer className="w-5 h-5 text-emerald-300" />
                <div>
                  <h3 className="font-bold text-sm">Select Columns to Print</h3>
                  <p className="text-[11px] text-emerald-200/80">
                    Choose which fields appear on the printed official summary report
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintSelectModal(false)}
                className="text-white/70 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {printValidationError && (
              <div className="mx-6 mt-4 p-3 rounded-2xl bg-red-50 border border-red-200 flex items-center gap-2 text-red-800 text-xs font-bold">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{printValidationError}</span>
              </div>
            )}

            <div className="px-6 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between text-xs">
              <span className="font-bold text-stone-700">
                Selected Columns:{' '}
                <span className="text-emerald-700 font-extrabold">
                  {activeFields.filter(f => printSelectedColumnIds[f.field.id]).length} of {activeFields.length}
                </span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const all: Record<string, boolean> = {};
                    activeFields.forEach(f => {
                      all[f.field.id] = true;
                    });
                    setPrintSelectedColumnIds(all);
                    setPrintValidationError(null);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white border border-stone-300 hover:bg-stone-100 text-stone-700 font-semibold cursor-pointer text-xs transition"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={() => setPrintSelectedColumnIds({})}
                  className="px-2.5 py-1 rounded-lg bg-white border border-stone-300 hover:bg-stone-100 text-stone-700 font-semibold cursor-pointer text-xs transition"
                >
                  Clear All
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {formSchema.sections
                .filter(sec => sec.isActive)
                .map(sec => {
                  const secFields = activeFields.filter(f => f.section.id === sec.id);
                  if (secFields.length === 0) return null;
                  return (
                    <div key={sec.id} className="space-y-2">
                      <div className="text-[11px] font-extrabold uppercase tracking-wider text-stone-500 flex items-center gap-1.5 pb-1 border-b border-stone-100">
                        <Layers className="w-3.5 h-3.5 text-emerald-700" />
                        <span>{sec.title}</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {secFields.map(item => {
                          const isChecked = !!printSelectedColumnIds[item.field.id];
                          return (
                            <label
                              key={item.field.id}
                              className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition ${
                                isChecked
                                  ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 font-semibold'
                                  : 'bg-stone-50/50 border-stone-200 text-stone-600 hover:bg-stone-100'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={e => {
                                  setPrintSelectedColumnIds(prev => ({
                                    ...prev,
                                    [item.field.id]: e.target.checked,
                                  }));
                                  if (e.target.checked) setPrintValidationError(null);
                                }}
                                className="w-4 h-4 text-emerald-600 rounded border-stone-300 focus:ring-emerald-500"
                              />
                              <span className="flex-1 truncate">{item.field.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="p-4 bg-stone-50 border-t border-stone-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowPrintSelectModal(false)}
                className="px-4 py-2 rounded-xl border border-stone-300 hover:bg-stone-100 text-stone-700 text-xs font-bold cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const selected = activeFields.filter(f => printSelectedColumnIds[f.field.id]);
                  if (selected.length === 0) {
                    setPrintValidationError('Please select at least one column to print.');
                    return;
                  }
                  setActivePrintColumns(selected);
                  setShowPrintSelectModal(false);
                  setShowPrintModal(true);
                }}
                className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer transition"
              >
                <Printer className="w-4 h-4" />
                <span>
                  Print Selected ({activeFields.filter(f => printSelectedColumnIds[f.field.id]).length})
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== IMPORT MODAL ===================== */}
      <ImportSwineModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        initialFileType={importFileType}
        onSuccess={count => {
          setImportSuccessMsg(`Successfully imported ${count} swine record${count > 1 ? 's' : ''}!`);
          onRefresh();
          setTimeout(() => setImportSuccessMsg(''), 5000);
        }}
        barangays={barangays}
        currentUser={currentUser}
        existingRecords={swineList}
      />
    </div>
  );
};
