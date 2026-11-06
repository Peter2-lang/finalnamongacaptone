import { LocalizedFeedback } from '../../i18n/LocalizedFeedback';
import { InterfaceText, translateInterfaceText } from '../../i18n/interfaceText';
import { IMPORT_LIMITS, normalizeImportDataset, stableImportFingerprint } from '../../utils/swineImportData';
import { HINUNANGAN_BARANGAYS } from '../../data/barangays';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Upload,
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  AlertTriangle,
  X,
  Download,
  RefreshCw,
  Search,
  Database,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  SlidersHorizontal,
  Languages,
  Check,
  HelpCircle,
  Eye,
  Columns,
  History,
  Info,
  ShieldCheck,
  Tag,
  MapPin,
  Calendar,
  Layers,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  Barangay,
  ImportColumnMapping,
  ImportMatchStatus,
  ImportRowValidationError,
  ImportRowValidationResult,
  RegistryFormField,
  RegistryFormSchema,
  RegistryFieldType,
  SwineImportHistoryRecord,
  SwineRecord,
  UserAccount,
} from '../../types';
import { storageService } from '../../services/storageService';
import { languageService } from '../../services/languageService';
import {
  analyzeImportColumns,
  CORE_SWINE_FIELDS,
  generateDynamicImportWorkbook,
  generateSafeFieldKey,
  generateTranslatedLabels,
  normalizeHeader,
  validateImportRow,
} from '../../utils/columnMatcher';
import { getFieldKey } from '../../utils/registryFieldUtils';
import { isValidPigIdTag } from '../../utils/swineRegistryLogic';

interface ImportSwineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
  barangays: Barangay[];
  currentUser: UserAccount | null;
  existingRecords: SwineRecord[];
  initialFileType?: 'csv' | 'xlsx' | 'all';
}

type ImportStep = 'upload' | 'mapping' | 'validation' | 'importing' | 'completed';

export const ImportSwineModal: React.FC<ImportSwineModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  barangays,
  currentUser,
  existingRecords,
  initialFileType = 'all',
}) => {
  const currentLang = languageService.getLanguage();
  const t = (key: any, fallbackOrParams?: any, fallback?: string) =>
    languageService.t(key, fallbackOrParams, fallback);

  // Active Wizard Step
  const [currentStep, setCurrentStep] = useState<ImportStep>('upload');

  // File & Raw Data State
  const [file, setFile] = useState<File | null>(null);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);
  const [fileReadError, setFileReadError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState<boolean>(false);

  // Active Form Schema (core + dynamic fields)
  const [formSchema, setFormSchema] = useState<RegistryFormSchema>(() => storageService.getRegistryFormSchema());

  // Column Mappings
  const [mappings, setMappings] = useState<ImportColumnMapping[]>([]);
  const [editingMappingIndex, setEditingMappingIndex] = useState<number | null>(null);

  // Validation States
  const [validationResults, setValidationResults] = useState<ImportRowValidationResult[]>([]);
  const [validationFilter, setValidationFilter] = useState<'all' | 'valid' | 'errors' | 'warnings'>('all');
  const [duplicateHandling, setDuplicateHandling] = useState<'update' | 'skip' | 'rename'>('skip');
  const [searchFilter, setSearchFilter] = useState<string>('');

  // Execution & Progress State
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [importStatusMsg, setImportStatusMsg] = useState<string>('');
  const [importSummary, setImportSummary] = useState<{
    total: number;
    created: number;
    updated: number;
    skipped: number;
    newFieldsCount: number;
  }>({ total: 0, created: 0, updated: 0, skipped: 0, newFieldsCount: 0 });

  // Missing Fields State
  const [showMissingFieldsAlert, setShowMissingFieldsAlert] = useState<boolean>(true);

  // Custom Target Section for New Fields
  const [targetSectionId, setTargetSectionId] = useState<string>('sec_swine_info');

  const [importFailures, setImportFailures] = useState<{row: number; reason: string}[]>([]);
  const [resultStatus, setResultStatus] = useState('');
  const importBatchIdRef = useRef('');
  const importRequestsRef = useRef<any[] | null>(null);
  const canCreateFields = currentUser?.role === 'admin' || currentUser?.role === 'super_admin';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importSubmissionInProgressRef = useRef(false);

  // Synchronize with latest schema
  useEffect(() => {
    setFormSchema(storageService.getRegistryFormSchema());
  }, [isOpen]);

  // Reset modal state when closed
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep('upload');
      setFile(null);
      setRawHeaders([]);
      setRawRows([]);
      setMappings([]);
      setValidationResults([]);
      setFileReadError(null);
      setEditingMappingIndex(null);
      setImportProgress(0);
    }
  }, [isOpen]);


  // Existing ear tags set for fast lookup
  const existingEarTags = new Set<string>(
    existingRecords.map(r => (r.pigIdTag || r.earTagNo || '').trim().toUpperCase()).filter(Boolean)
  );

  // List of all existing system fields (Core + Custom Schema)
  const availableTargetFields = [
    { key: '__ignore__', label: '— Ignore Column (Do Not Import) —', group: 'Actions' },
    ...CORE_SWINE_FIELDS.map(cf => ({
      key: cf.key,
      label: `${cf.label} (${cf.required ? 'Required Core' : 'Core'})`,
      group: 'Core Swine Registry Fields',
      type: cf.type,
      required: cf.required,
    })),
    ...(formSchema.sections || []).flatMap(sec =>
      (sec.fields || [])
        .filter(f => !CORE_SWINE_FIELDS.some(c => c.key === getFieldKey(f)))
        .map(fld => ({
          key: getFieldKey(fld),
          label: `${fld.label} (${sec.title})`,
          group: `Custom: ${sec.title}`,
          type: fld.type,
          required: Boolean(fld.required),
        }))
    ),
  ];

  // Identify missing system fields
  const mappedTargetKeys = new Set(
    mappings.filter(m => m.matchStatus !== 'ignored' && m.matchStatus !== 'new_field').map(m => m.targetFieldKey)
  );

  const missingRequiredFields = CORE_SWINE_FIELDS.filter(
    cf => cf.required && !mappedTargetKeys.has(cf.key)
  );

  const missingOptionalFields = CORE_SWINE_FIELDS.filter(
    cf => !cf.required && !mappedTargetKeys.has(cf.key)
  );

  // Handle File Upload & Parsing (JSON, XLSX, XLS, CSV)
  const handleFileUpload = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsReadingFile(true);
    setFileReadError(null);
    setImportFailures([]);
    setResultStatus('');
    importBatchIdRef.current = crypto.randomUUID();
    importRequestsRef.current = null;

    try {
      if (!/\.(json|csv|xlsx|xls)$/i.test(selectedFile.name)) throw new Error('Supported formats (up to 10 MB / 10,000 rows): .json, .csv, .xlsx, .xls.');
      if (selectedFile.size > IMPORT_LIMITS.bytes) throw new Error('File exceeds the supported 10 MB limit.');
      let jsonData: Record<string, any>[];
      if (selectedFile.name.toLowerCase().endsWith('.json')) {
        jsonData = normalizeImportDataset(JSON.parse((await selectedFile.text()).replace(/^\uFEFF/, ''))).rows;
      } else {
        const data = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false, cellText: false });

        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          throw new Error('Spreadsheet does not contain any readable sheets.');
        }

        const worksheet = workbook.Sheets[firstSheetName];
        jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, {
          raw: true,
          defval: '',
          dateNF: 'yyyy-mm-dd',
          blankrows: false,
        });
      }

      const dataset = normalizeImportDataset(jsonData);
      jsonData = dataset.rows;
      const headers = dataset.headers;
      setRawHeaders(headers);
      setRawRows(jsonData);

      // Perform Intelligent Column Analysis
      const analyzedMappings = analyzeImportColumns(headers, jsonData, formSchema);
      setMappings(analyzedMappings.map(mapping => !canCreateFields && mapping.isNewField ? {...mapping, createField: false} : mapping));

      // Transition to mapping step
      setCurrentStep('mapping');
    } catch (err: any) {
      console.error('File reading failed:', err);
      setFileReadError(err.message || 'Failed to read file. Please ensure it is a valid .json, .xlsx, .xls, or .csv file.');
    } finally {
      setIsReadingFile(false);
    }
  };

  // Drag and drop handlers
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Update a single column mapping
  const handleUpdateMapping = (index: number, updates: Partial<ImportColumnMapping>) => {
    setMappings(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
  };

  // Re-map column to another field or ignore
  const handleTargetChange = (index: number, newTargetKey: string) => {
    if (newTargetKey === '__ignore__') {
      handleUpdateMapping(index, {
        matchStatus: 'ignored',
        createField: false,
      });
      return;
    }

    const matchedCore = CORE_SWINE_FIELDS.find(c => c.key === newTargetKey);
    if (matchedCore) {
      handleUpdateMapping(index, {
        targetFieldKey: matchedCore.key,
        targetFieldLabel: matchedCore.label,
        matchStatus: 'matched_core',
        isNewField: false,
        createField: false,
        isRequired: matchedCore.required,
        detectedDataType: matchedCore.type,
      });
      return;
    }

    let matchedCustom: RegistryFormField | undefined;
    (formSchema.sections || []).forEach(sec => {
      (sec.fields || []).forEach(fld => {
        if (getFieldKey(fld) === newTargetKey) {
          matchedCustom = fld;
        }
      });
    });

    if (matchedCustom) {
      handleUpdateMapping(index, {
        targetFieldKey: getFieldKey(matchedCustom),
        targetFieldLabel: (matchedCustom as RegistryFormField).label,
        matchStatus: 'matched_custom',
        isNewField: false,
        createField: false,
        isRequired: Boolean((matchedCustom as RegistryFormField).required),
        detectedDataType: (matchedCustom as RegistryFormField).type,
      });
      return;
    }

    // Custom new field target
    handleUpdateMapping(index, {
      targetFieldKey: newTargetKey,
      matchStatus: 'new_field',
      isNewField: true,
      createField: true,
    });
  };

  // Trigger Full Row Validation
  const validateRows = () => {
    const seenTags = new Set<string>(), seenRows = new Set<string>();
    return rawRows.map((row, index) => {
      const result = validateImportRow(index + 1, row, mappings, barangays.length ? barangays : HINUNANGAN_BARANGAYS, existingEarTags, seenTags, duplicateHandling);
      const fingerprint = stableImportFingerprint({...result.mappedRecord,id:undefined,registeredAt:undefined});
      if (seenRows.has(fingerprint)) {
        result.isValid = false; result.isDuplicate = true;
        result.errors.push({row:index + 1, message:'Duplicate record within this file. Row rejected.', severity:'error'});
      }
      seenRows.add(fingerprint);
      return result;
    });
  };
  const handleProceedToValidation = () => {
    importRequestsRef.current = null;
    importBatchIdRef.current = crypto.randomUUID();
    setValidationResults(validateRows());
    setCurrentStep('validation');
  };
  useEffect(() => {
    if (currentStep === 'validation') {
      importRequestsRef.current = null;
      importBatchIdRef.current = crypto.randomUUID();
      setValidationResults(validateRows());
    }
  }, [duplicateHandling]);

  // Validation Summary Stats
  const validationStats = useMemo(() => {
    const total = validationResults.length;
    const valid = validationResults.filter(r => r.isValid && r.warnings.length === 0).length;
    const warnings = validationResults.filter(r => r.isValid && r.warnings.length > 0).length;
    const errors = validationResults.filter(r => !r.isValid).length;
    const duplicates = validationResults.filter(r => r.isDuplicate).length;
    const newFieldsCount = mappings.filter(m => m.isNewField && m.createField).length;

    return { total, valid, warnings, errors, duplicates, newFieldsCount };
  }, [validationResults, mappings]);

  // Filtered validation rows for review
  const filteredValidationResults = useMemo(() => {
    return validationResults.filter(res => {
      if (validationFilter === 'valid' && (!res.isValid || res.warnings.length > 0)) return false;
      if (validationFilter === 'warnings' && (res.warnings.length === 0 || !res.isValid)) return false;
      if (validationFilter === 'errors' && res.isValid) return false;

      if (searchFilter.trim()) {
        const q = searchFilter.toLowerCase().trim();
        const tag = (res.mappedRecord.pigIdTag || '').toLowerCase();
        const farmer = (res.mappedRecord.farmerName || '').toLowerCase();
        const brgy = (res.mappedRecord.barangay || '').toLowerCase();
        return tag.includes(q) || farmer.includes(q) || brgy.includes(q);
      }
      return true;
    });
  }, [validationResults, validationFilter, searchFilter]);

  // Download Dynamic Template
  const handleDownloadTemplate = (format: 'xlsx' | 'csv' = 'xlsx') => {
    const { blob, fileName } = generateDynamicImportWorkbook(formSchema, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download Error & Warning Report
  const handleDownloadErrorReport = () => {
    const errorRows: Record<string, any>[] = [];
    validationResults.forEach(res => {
      if (!res.isValid || res.warnings.length > 0) {
        const issues = [...res.errors, ...res.warnings].map(i => `[${i.severity.toUpperCase()}] ${i.message}`).join(' | ');
        errorRows.push({
          'Row Number': res.rowNumber,
          'Pig ID Tag': res.mappedRecord.pigIdTag || 'N/A',
          'Farmer Name': res.mappedRecord.farmerName || 'N/A',
          'Barangay': res.mappedRecord.barangay || 'N/A',
          'Status': res.isValid ? 'Valid with Warnings' : 'Fatal Error (Skipped)',
          'Issues Detected': issues,
          ...res.rawData,
        });
      }
    });

    if (errorRows.length === 0) return;

    const worksheet = XLSX.utils.json_to_sheet(errorRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Validation Errors');
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DA_Hinunangan_Import_Validation_Issues_${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // The backend confirms each bounded batch and atomically adds authorized fields.
  const handleExecuteImport = async () => {
    if (importSubmissionInProgressRef.current) return;
    if (storageService.isEffectiveOffline()) {
      setFileReadError('Connect to the registry database to confirm an import. Offline registration and queued record editing remain available.');
      return;
    }
    importSubmissionInProgressRef.current = true;
    setIsImporting(true); setCurrentStep('importing'); setFileReadError(null);
    setImportProgress(0); setImportStatusMsg('Preparing validated records…');
    let savedCount = 0, created = 0, updated = 0, skipped = validationResults.filter(row => !row.isValid).length;
    const createdFields = new Set<string>();
    const failures: {row:number; reason:string}[] = validationResults.filter(row => !row.isValid).map(row => ({row:row.rowNumber,reason:row.errors.map(error => error.message).join(' ')}));
    try {
      const fieldMappings = mappings.filter(mapping => mapping.isNewField && mapping.createField && mapping.matchStatus !== 'ignored');
      if (fieldMappings.length && !canCreateFields) throw new Error('Only administrators can create new custom fields.');
      const fields: RegistryFormField[] = fieldMappings.map(mapping => ({
        id: `fld_import_${mapping.targetFieldKey}`, fieldKey: mapping.targetFieldKey,
        label: mapping.labelEn || mapping.targetFieldLabel,
        type: mapping.detectedDataType, required:mapping.isRequired, visible:true, isCustom:true,
        ...(mapping.detectedOptions ? {options:mapping.detectedOptions} : {}),
        searchable:mapping.searchable !== false, filterable:mapping.filterable !== false, sortable:mapping.sortable !== false, exportable:mapping.exportable !== false, printable:mapping.printable !== false,
      }));
      if (!importRequestsRef.current) {
        const validRows = validationResults.filter(row => row.isValid);
        importRequestsRef.current = [];
        for (let offset = 0; offset < validRows.length;) {
          const rows: ImportRowValidationResult[] = [];
          let bytes = 0;
          while (offset < validRows.length && rows.length < IMPORT_LIMITS.batch) {
            const next = validRows[offset];
            const rowBytes = new Blob([JSON.stringify(next.mappedRecord)]).size;
            if (rowBytes > 2 * 1024 * 1024) throw new Error(`Row ${next.rowNumber} exceeds the 2 MB per-record import limit.`);
            if (rows.length && bytes + rowBytes > 2 * 1024 * 1024) break;
            rows.push(next); bytes += rowBytes; offset++;
          }
          const records = rows.map(row => {
            const existing = existingRecords.find(record => (record.pigIdTag || record.earTagNo || '').toUpperCase() === row.mappedRecord.pigIdTag?.toUpperCase() || record.id === row.mappedRecord.id);
            if (!existing || duplicateHandling !== 'update') return row.mappedRecord;
            const patch: Record<string,any> = {id:existing.id,pigIdTag:existing.pigIdTag,earTagNo:existing.earTagNo,farmerName:existing.farmerName,barangay:existing.barangay,customFields:row.mappedRecord.customFields};
            const properties: Record<string,string[]> = {
              farmer_name:['farmerName'],farmer_contact:['farmerContact'],farmer_id:['farmerId'],barangay:['barangay','barangay_id'],
              farm_name:['farmName'],birth_date:['birthDate','ageDays','ageMonths'],age_months:['ageMonths','ageDays'],
              actual_weight_kg:['actualWeightKg','weightKg'],swine_type:['swineType'],farm_scale:['farmScale'],asf_zone:['asfZone'],
              ready_to_sell:['readyToSell'],price_estimate:['estimatedPricePhp'],latitude:['latitude'],longitude:['longitude'],
              pen_capacity:['penCapacity'],rsbsa_id:['rsbsaId'],breed:['breed'],gender:['gender'],notes:['notes'],status:['status'],
            };
            mappings.filter(mapping => mapping.matchStatus === 'matched_core' && row.rawData[mapping.fileHeader] !== undefined && row.rawData[mapping.fileHeader] !== null && row.rawData[mapping.fileHeader] !== '').forEach(mapping => {
              for (const property of properties[mapping.targetFieldKey] || []) patch[property] = (row.mappedRecord as any)[property];
            });
            return patch;
          });
          importRequestsRef.current.push({records,newFields:fields,sectionId:targetSectionId,duplicateHandling,fileName:file?.name || 'Import',batchId:`${importBatchIdRef.current}_${importRequestsRef.current.length}`,rowNumbers:rows.map(row => row.rowNumber)});
        }
      }
      const requests = importRequestsRef.current;
      for (let index = 0; index < requests.length; index++) {
        const {rowNumbers, ...payload} = requests[index];
        setImportStatusMsg(`Saving batch ${index + 1} of ${requests.length} (${payload.records.length} records)…`);
        const response = await fetch('/api/swine-records/import', {
          method:'POST', headers:{'Content-Type':'application/json',...(storageService.getSessionToken() ? {Authorization:`Bearer ${storageService.getSessionToken()}`} : {})},
          body:JSON.stringify(payload),
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success || !Array.isArray(result.data)) throw new Error(result?.error || `Import batch ${index + 1} failed (HTTP ${response.status}). Retry uses the same batch ID to prevent duplicate inserts.`);
        const cache = new Map(storageService.getSwineRecords().map(record => [record.id,record]));
        result.data.forEach((record:SwineRecord) => {
          cache.set(record.id,{...record,isSynced:true});
          if (existingRecords.some(existing => existing.id === record.id)) updated++; else created++;
        });
        savedCount += result.data.length;
        storageService.saveSwineRecords([...cache.values()]);
        if (result.schema?.sections) {
          storageService.cacheRegistryFormSchema(result.schema);
          setFormSchema(result.schema);
        }
        (result.newFieldsCreated || []).forEach((key:string) => createdFields.add(key));
        for (const failure of result.failures || []) failures.push({row:rowNumbers[failure.index],reason:failure.reason});
        skipped += (result.failures?.length || 0) + (result.skipped?.length || 0);
        for (const skipIndex of result.skipped || []) failures.push({row:rowNumbers[skipIndex],reason:'Existing record skipped by duplicate policy.'});
        setImportProgress(Math.round(((index + 1) / requests.length) * 100));
      }
      setImportFailures(failures);
      setImportSummary({total:rawRows.length,created,updated,skipped,newFieldsCount:createdFields.size});
      setResultStatus(savedCount ? `${rawRows.length} records detected. ${savedCount} confirmed saved. ${skipped} rejected or skipped.` : 'No records were saved. Review the error report.');
      setCurrentStep('completed');
      const history: SwineImportHistoryRecord = {
        id:importBatchIdRef.current,batchId:importBatchIdRef.current,fileName:file?.name || 'Import',
        fileType:file?.name.endsWith('.json') ? 'json' : file?.name.endsWith('.csv') ? 'csv' : 'xlsx',fileSize:file?.size || 0,
        importedBy:currentUser?.name || 'Administrator',importedByRole:currentUser?.role || 'admin',importedAt:new Date().toISOString(),
        totalRows:rawRows.length,successfulCount:savedCount,failedCount:failures.length,updatedCount:updated,createdCount:created,skippedCount:skipped,
        newFieldsCreated:[...createdFields],createdFieldKeys:[...createdFields],recordIds:[],status:failures.length ? 'partial' : 'completed',duplicateHandling,
      };
      try { const key='da_hinunangan_swine_import_history_v1'; const previous=JSON.parse(localStorage.getItem(key) || '[]'); localStorage.setItem(key,JSON.stringify([history,...(Array.isArray(previous)?previous:[]).filter((item:any)=>item.id!==history.id)].slice(0,50))); } catch { /* Audit cache is optional; persistence was confirmed by backend. */ }
    } catch (error) {
      setFileReadError(`${(error as Error).message}${savedCount ? ` ${savedCount} records from earlier batches were saved. Retry safely to finish the import.` : ''}`);
      setImportFailures(failures); setCurrentStep('validation');
    } finally {
      if (savedCount) onSuccess(savedCount);
      importSubmissionInProgressRef.current = false; setIsImporting(false);
    }
  };

  const downloadImportFailures = () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(importFailures.map(item => ({Row:item.row,Reason:item.reason,...rawRows[item.row - 1]}))), 'Rejected Rows');
    XLSX.writeFile(workbook, 'swine-import-errors.xlsx');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs overflow-y-auto animate-fadeIn">
      <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-emerald-900 via-emerald-800 to-teal-900 text-white p-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-white/10 rounded-2xl border border-white/20 shadow-inner">
              <FileSpreadsheet className="w-6 h-6 text-emerald-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight">
                  {t('import_title', 'Smart Swine Registry Importer')}
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">
                  XLSX / XLS / CSV
                </span>
              </div>
              <p className="text-xs text-emerald-200/80">
                {t('import_subtitle', 'Intelligent column matching, auto-translation for Bisaya & Filipino, and custom schema expansion.')}
              </p>
            </div>
          </div>

          <button
            disabled={isImporting || isReadingFile}
            onClick={onClose}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-xl transition cursor-pointer"
            title={translateInterfaceText("Close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Stepper Progress Bar */}
        <div className="bg-stone-50 border-b border-stone-200 px-6 py-3 flex items-center justify-between text-xs font-semibold shrink-0">
          <div className="flex items-center gap-6">
            <div
              className={`flex items-center gap-2 ${
                currentStep === 'upload' ? 'text-emerald-800 font-bold' : 'text-stone-400'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  currentStep === 'upload'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : file
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-stone-200 text-stone-600'
                }`}
              >
                1
              </span>
              <span>1. Upload File</span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-stone-300" />

            <div
              className={`flex items-center gap-2 ${
                currentStep === 'mapping' ? 'text-emerald-800 font-bold' : 'text-stone-400'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  currentStep === 'mapping'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : currentStep === 'validation' || currentStep === 'completed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-stone-200 text-stone-600'
                }`}
              >
                2
              </span>
              <span>2. Column Matching & New Fields</span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-stone-300" />

            <div
              className={`flex items-center gap-2 ${
                currentStep === 'validation' ? 'text-emerald-800 font-bold' : 'text-stone-400'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  currentStep === 'validation'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : currentStep === 'completed'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-stone-200 text-stone-600'
                }`}
              >
                3
              </span>
              <span>3. Validate & Preview</span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-stone-300" />

            <div
              className={`flex items-center gap-2 ${
                currentStep === 'completed' ? 'text-emerald-800 font-bold' : 'text-stone-400'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  currentStep === 'completed'
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-stone-200 text-stone-600'
                }`}
              >
                4
              </span>
              <span>4. Database Commit</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleDownloadTemplate('xlsx')}
              className="px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-300 flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              title="Download official XLSX template with all core and custom columns"
            >
              <Download className="w-3 h-3 text-emerald-700" />
              <span>Download Excel Template</span>
            </button>
          </div>
        </div>

        {/* Modal Body Area */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {fileReadError && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 text-xs flex items-start gap-3 animate-fadeIn">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">File Parsing Notice</p>
                <p className="text-rose-700 mt-0.5">{<LocalizedFeedback value={fileReadError} />}</p>
              </div>
              <button
                type="button"
                onClick={() => setFileReadError(null)}
                className="text-rose-500 hover:text-rose-800 text-xs font-bold"
              >
                ✕
              </button>
            </div>
          )}

          {!canCreateFields && <p className="text-xs text-amber-800">New field creation requires an administrator. Existing fields can be mapped and imported; unconfirmed new fields are excluded.</p>}
          {mappings.some(mapping => mapping.typeWarning) && <div role="status" className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3">{mappings.filter(mapping => mapping.typeWarning).map(mapping => <p key={mapping.fileHeader}>{mapping.fileHeader}: {mapping.typeWarning}</p>)}</div>}
          {/* STEP 1: UPLOAD SPREADSHEET */}
          {currentStep === 'upload' && (
            <div className="space-y-6">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/40 hover:bg-emerald-50/70 p-10 rounded-3xl text-center cursor-pointer transition flex flex-col items-center justify-center gap-4 group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={event => { const selected=event.target.files?.[0]; event.target.value=''; if (selected) void handleFileUpload(selected); }}
                  accept={
                    initialFileType === 'csv'
                      ? '.csv'
                      : initialFileType === 'xlsx'
                      ? '.xlsx,.xls'
                      : '.xlsx,.xls,.csv,.json'
                  }
                  className="hidden"
                />

                <div className="w-16 h-16 rounded-2xl bg-emerald-100 group-hover:bg-emerald-200 text-emerald-800 flex items-center justify-center shadow-inner transition">
                  <Upload className="w-8 h-8" />
                </div>

                <div>
                  <h3 className="text-base font-bold text-stone-900">
                    Drag and drop your {initialFileType === 'csv' ? 'CSV file' : initialFileType === 'xlsx' ? 'Excel spreadsheet' : 'records file'} here, or{' '}
                    <span className="text-emerald-700 underline underline-offset-2"><InterfaceText source="Browse Files" /></span>
                  </h3>
                  <p className="text-xs text-stone-500 mt-1">
                    {initialFileType === 'csv'
                      ? 'Supports Comma-Separated Values (.csv).'
                      : initialFileType === 'xlsx'
                      ? 'Supports Microsoft Excel (.xlsx, .xls).'
                      : 'Supports JSON (.json), Excel (.xlsx, .xls), and CSV (.csv). Limit: 10 MB / 10,000 rows.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <span className="px-3 py-1 rounded-full bg-white border border-stone-200 text-[11px] font-bold text-stone-600 shadow-2xs">
                    ✓ Automatic Header Inspection
                  </span>
                  <span className="px-3 py-1 rounded-full bg-white border border-stone-200 text-[11px] font-bold text-stone-600 shadow-2xs">
                    ✓ New Field Detection
                  </span>
                  <span className="px-3 py-1 rounded-full bg-white border border-stone-200 text-[11px] font-bold text-stone-600 shadow-2xs">
                    ✓ Multi-Language Bisaya & Tagalog
                  </span>
                </div>
              </div>

              {/* Template Recommendation Box */}
              <div className="p-4 bg-stone-50 border border-stone-200 rounded-2xl flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Info className="w-5 h-5 text-emerald-700 shrink-0" />
                  <div>
                    <h4 className="text-xs font-bold text-stone-900">Need the official DA Hinunangan registry template?</h4>
                    <p className="text-[11px] text-stone-500">
                      Download a pre-formatted Excel or CSV template generated from your active registry schema, including all required indicators (*).
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownloadTemplate('xlsx')}
                    className="px-3 py-1.5 rounded-xl bg-white border border-stone-300 hover:bg-stone-100 text-stone-800 text-xs font-bold flex items-center gap-1.5 transition shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-700" />
                    <span>.XLSX Template</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadTemplate('csv')}
                    className="px-3 py-1.5 rounded-xl bg-white border border-stone-300 hover:bg-stone-100 text-stone-800 text-xs font-bold flex items-center gap-1.5 transition shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5 text-stone-600" />
                    <span>.CSV Template</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: COLUMN MATCHING & NEW FIELD DISCOVERY */}
          {currentStep === 'mapping' && (
            <div className="space-y-6">
              {/* Missing Fields Banner */}
              {showMissingFieldsAlert && (missingRequiredFields.length > 0 || missingOptionalFields.length > 0) && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3 animate-fadeIn">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-xs">
                      <AlertTriangle className="w-4 h-4 text-amber-700" />
                      <span>Registry Schema Column Comparison</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowMissingFieldsAlert(false)}
                      className="text-amber-700 hover:text-amber-900 text-xs cursor-pointer font-bold"
                    >
                      ✕
                    </button>
                  </div>

                  {missingRequiredFields.length > 0 && (
                    <div className="text-xs text-rose-900 bg-rose-100/60 p-3 rounded-xl border border-rose-200 space-y-1">
                      <p className="font-bold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-700" />
                        Missing Required System Fields ({missingRequiredFields.length}):
                      </p>
                      <p className="text-[11px] text-rose-800">
                        {missingRequiredFields.map(f => f.label).join(', ')}. Please map a column to these fields before importing; rows with missing required values will be rejected.
                      </p>
                    </div>
                  )}

                  {missingOptionalFields.length > 0 && (
                    <div className="text-xs text-stone-700">
                      <p className="font-semibold text-stone-800">
                        Optional unmapped fields ({missingOptionalFields.length}):
                      </p>
                      <p className="text-[11px] text-stone-500 mt-0.5">
                        {missingOptionalFields.map(f => f.label).join(', ')}. These can be left unmapped or populated later.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Column Mapping Table */}
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-stone-900 flex items-center gap-2">
                      <Columns className="w-4 h-4 text-emerald-700" />
                      Detected Columns in Spreadsheet ({mappings.length})
                    </h3>
                    <p className="text-[11px] text-stone-500">
                      Review column matches, configure new custom fields, and customize translations for Bisaya & Filipino.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-lg font-bold text-[11px]">
                      {mappings.filter(m => m.matchStatus === 'matched_core').length} Core Matched
                    </span>
                    <span className="px-2.5 py-1 bg-purple-100 text-purple-800 rounded-lg font-bold text-[11px]">
                      {mappings.filter(m => m.isNewField).length} New Fields
                    </span>
                    <span className="px-2.5 py-1 bg-stone-100 text-stone-600 rounded-lg font-bold text-[11px]">
                      {mappings.filter(m => m.matchStatus === 'ignored').length} Ignored
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-stone-100">
                  {mappings.map((mapping, idx) => {
                    const isNew = mapping.isNewField;
                    const isCore = mapping.matchStatus === 'matched_core';
                    const isIgnored = mapping.matchStatus === 'ignored';

                    return (
                      <div
                        key={idx}
                        className={`p-4 transition ${
                          isNew
                            ? 'bg-purple-50/40 border-l-4 border-l-purple-500'
                            : isCore
                            ? 'bg-emerald-50/20 border-l-4 border-l-emerald-600'
                            : isIgnored
                            ? 'bg-stone-50/60 opacity-60 border-l-4 border-l-stone-300'
                            : 'bg-white border-l-4 border-l-blue-500'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          {/* File Column Header & Samples */}
                          <div className="min-w-[200px] flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-xs text-stone-900 bg-stone-100 px-2.5 py-1 rounded-lg border border-stone-200">
                                {mapping.fileHeader}
                              </span>

                              {isCore && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  ✓ Matched Core
                                </span>
                              )}

                              {mapping.matchStatus === 'matched_custom' && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-300">
                                  ✓ Matched Custom
                                </span>
                              )}

                              {isNew && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-800 border border-purple-300 animate-pulse">
                                  + New Field Detected
                                </span>
                              )}

                              {isIgnored && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-stone-200 text-stone-600">
                                  ⊘ Ignored
                                </span>
                              )}
                            </div>

                            {/* Sample Values Preview */}
                            <p className="text-[11px] text-stone-500 mt-1 truncate max-w-md">
                              <span className="font-semibold text-stone-600">Samples: </span>
                              {mapping.sampleValues.filter(Boolean).slice(0, 3).join(', ') || '—'}
                            </p>
                          </div>

                          {/* Target Field Selector */}
                          <div className="min-w-[240px]">
                            <label className="block text-[10px] font-bold text-stone-500 uppercase tracking-wider mb-1">
                              Map to Registry Field
                            </label>
                            <select
                              value={isIgnored ? '__ignore__' : mapping.targetFieldKey}
                              onChange={e => handleTargetChange(idx, e.target.value)}
                              className="w-full text-xs font-semibold bg-white border border-stone-300 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden shadow-2xs"
                            >
                              {isNew && (
                                <option value={mapping.targetFieldKey}>
                                  + Create as New Field ({mapping.targetFieldKey})
                                </option>
                              )}
                              {availableTargetFields.map(opt => (
                                <option key={opt.key} value={opt.key}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Actions / Configure */}
                          <div className="flex items-center gap-2">
                            {isNew && (
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingMappingIndex(editingMappingIndex === idx ? null : idx)
                                }
                                className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                                  editingMappingIndex === idx
                                    ? 'bg-purple-700 text-white shadow-xs'
                                    : 'bg-purple-100 text-purple-900 hover:bg-purple-200'
                                }`}
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                <span>{editingMappingIndex === idx ? 'Close Config' : 'Configure Field'}</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateMapping(idx, {
                                  matchStatus: isIgnored ? mapping.isNewField ? 'new_field' : CORE_SWINE_FIELDS.some(field => field.key === mapping.targetFieldKey) ? 'matched_core' : 'matched_custom' : 'ignored',
                                  createField: isIgnored && mapping.isNewField && canCreateFields,
                                })
                              }
                              className={`p-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                                isIgnored
                                  ? 'text-emerald-700 hover:bg-emerald-50'
                                  : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100'
                              }`}
                              title={isIgnored ? 'Include Column' : 'Ignore Column'}
                            >
                              {isIgnored ? <Plus className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {/* Expandable New Field Configuration Panel */}
                        {isNew && editingMappingIndex === idx && (
                          <div className="mt-4 pt-4 border-t border-purple-200/60 bg-white p-4 rounded-2xl shadow-inner space-y-4 animate-fadeIn">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                                <Sparkles className="w-4 h-4 text-purple-600" />
                                Configure New Custom Field: {mapping.fileHeader}
                              </h4>
                              <span className="text-[10px] text-purple-700 font-bold bg-purple-100 px-2 py-0.5 rounded-full">
                                Key: {mapping.targetFieldKey}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              {/* Field Key */}
                              <div>
                                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                                  Safe System Key (field_key)
                                </label>
                                <input
                                  type="text"
                                  value={mapping.targetFieldKey}
                                  onChange={e =>
                                    handleUpdateMapping(idx, {
                                      targetFieldKey: generateSafeFieldKey(e.target.value, new Set()),
                                    })
                                  }
                                  className="w-full text-xs font-mono bg-stone-50 border border-stone-300 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                                />
                                <p className="text-[10px] text-stone-400 mt-0.5">Alphanumeric & underscores only.</p>
                              </div>

                              {/* Data Type */}
                              <div>
                                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                                  Data Type
                                </label>
                                <select
                                  value={mapping.detectedDataType}
                                  onChange={e =>
                                    handleUpdateMapping(idx, {
                                      detectedDataType: e.target.value as RegistryFieldType,
                                    })
                                  }
                                  className="w-full text-xs font-bold bg-white border border-stone-300 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                                >
                                  <option value="text">Text (String)</option>
                                  <option value="number">Number (Integer/Decimal)</option>
                                  <option value="date">Date Picker (YYYY-MM-DD)</option>
                                  <option value="dropdown">Dropdown (Single Choice)</option>
                                  <option value="yes_no">Yes / No Toggle (Boolean)</option>
                                  <option value="checkbox">Checkbox (Boolean)</option>
                                  <option value="textarea">Textarea (Long Paragraph)</option>
                                  <option value="phone">Phone Number (PH +63)</option>
                                </select>
                              </div>

                              {/* Target Section */}
                              <div>
                                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                                  Form Section Placement
                                </label>
                                <select
                                  value={targetSectionId}
                                  onChange={e => setTargetSectionId(e.target.value)}
                                  className="w-full text-xs font-semibold bg-white border border-stone-300 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                                >
                                  {(formSchema.sections || []).map(s => (
                                    <option key={s.id} value={s.id}>
                                      {s.title}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {/* Multi-Language Labels (EN, CEB, FIL) */}
                            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200 space-y-2">
                              <p className="text-[11px] font-bold text-stone-800 flex items-center gap-1.5">
                                <Languages className="w-3.5 h-3.5 text-emerald-700" />
                                Multi-Language Field Display Labels
                              </p>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-stone-500 uppercase">
                                    English (EN)
                                  </label>
                                  <input
                                    type="text"
                                    value={mapping.labelEn}
                                    onChange={e =>
                                      handleUpdateMapping(idx, { labelEn: e.target.value, targetFieldLabel: e.target.value })
                                    }
                                    className="w-full text-xs bg-white border border-stone-300 rounded-lg px-2.5 py-1 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden font-medium"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-stone-500 uppercase">
                                    Cebuano / Bisaya (CEB)
                                  </label>
                                  <input
                                    type="text"
                                    value={mapping.labelCeb}
                                    onChange={e =>
                                      handleUpdateMapping(idx, { labelCeb: e.target.value })
                                    }
                                    className="w-full text-xs bg-white border border-stone-300 rounded-lg px-2.5 py-1 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden font-medium"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-stone-500 uppercase">
                                    Filipino / Tagalog (FIL)
                                  </label>
                                  <input
                                    type="text"
                                    value={mapping.labelFil}
                                    onChange={e =>
                                      handleUpdateMapping(idx, { labelFil: e.target.value })
                                    }
                                    className="w-full text-xs bg-white border border-stone-300 rounded-lg px-2.5 py-1 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden font-medium"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Dropdown Options (if applicable) */}
                            {mapping.detectedDataType === 'dropdown' && (
                              <div>
                                <label className="block text-[11px] font-bold text-stone-700 mb-1">
                                  Dropdown Options (Comma separated)
                                </label>
                                <input
                                  type="text"
                                  value={(mapping.detectedOptions || []).join(', ')}
                                  onChange={e =>
                                    handleUpdateMapping(idx, {
                                      detectedOptions: e.target.value
                                        .split(',')
                                        .map(s => s.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                  placeholder="e.g. Option 1, Option 2, Option 3"
                                  className="w-full text-xs bg-white border border-stone-300 rounded-xl px-3 py-1.5 focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                                />
                              </div>
                            )}

                            {/* Capability Toggles */}
                            <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-stone-700">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={mapping.isRequired}
                                  onChange={e => handleUpdateMapping(idx, { isRequired: e.target.checked })}
                                  className="w-3.5 h-3.5 text-purple-600 rounded border-stone-300 focus:ring-purple-500"
                                />
                                <span><InterfaceText source="Required Field" /></span>
                              </label>

                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={mapping.searchable !== false}
                                  onChange={e => handleUpdateMapping(idx, { searchable: e.target.checked })}
                                  className="w-3.5 h-3.5 text-purple-600 rounded border-stone-300 focus:ring-purple-500"
                                />
                                <span>Searchable</span>
                              </label>

                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={mapping.filterable !== false}
                                  onChange={e => handleUpdateMapping(idx, { filterable: e.target.checked })}
                                  className="w-3.5 h-3.5 text-purple-600 rounded border-stone-300 focus:ring-purple-500"
                                />
                                <span>Filterable</span>
                              </label>

                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={mapping.sortable !== false}
                                  onChange={e => handleUpdateMapping(idx, { sortable: e.target.checked })}
                                  className="w-3.5 h-3.5 text-purple-600 rounded border-stone-300 focus:ring-purple-500"
                                />
                                <span>Sortable</span>
                              </label>

                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={mapping.exportable !== false}
                                  onChange={e => handleUpdateMapping(idx, { exportable: e.target.checked })}
                                  className="w-3.5 h-3.5 text-purple-600 rounded border-stone-300 focus:ring-purple-500"
                                />
                                <span>Exportable</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: ROW VALIDATION & BATCH PREVIEW */}
          {currentStep === 'validation' && (
            <div className="space-y-6">
              {/* Validation Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-stone-50 border border-stone-200 p-3.5 rounded-2xl">
                  <p className="text-[10px] font-bold text-stone-500 uppercase">Total Rows</p>
                  <p className="text-xl font-black text-stone-900 mt-1">{validationStats.total}</p>
                </div>

                <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-2xl">
                  <p className="text-[10px] font-bold text-emerald-700 uppercase">Valid Rows</p>
                  <p className="text-xl font-black text-emerald-900 mt-1">{validationStats.valid}</p>
                </div>

                <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-2xl">
                  <p className="text-[10px] font-bold text-amber-700 uppercase">Warnings (Review)</p>
                  <p className="text-xl font-black text-amber-900 mt-1">{validationStats.warnings}</p>
                </div>

                <div className="bg-rose-50 border border-rose-200 p-3.5 rounded-2xl">
                  <p className="text-[10px] font-bold text-rose-700 uppercase">Fatal Errors</p>
                  <p className="text-xl font-black text-rose-900 mt-1">{validationStats.errors}</p>
                </div>

                <div className="bg-purple-50 border border-purple-200 p-3.5 rounded-2xl col-span-2 sm:col-span-1">
                  <p className="text-[10px] font-bold text-purple-700 uppercase">New Custom Fields</p>
                  <p className="text-xl font-black text-purple-900 mt-1">{validationStats.newFieldsCount}</p>
                </div>
              </div>

              {/* Duplicate Handling Policy Bar */}
              <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-2xs flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-bold text-stone-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    Duplicate Pig ID Tag Resolution Policy ({validationStats.duplicates} detected)
                  </h4>
                  <p className="text-[11px] text-stone-500">
                    How should the system treat records whose Pig ID Tag already exists in the database?
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition ${
                      duplicateHandling === 'update'
                        ? 'bg-emerald-100 text-emerald-900 border-emerald-400 ring-2 ring-emerald-300'
                        : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="dupPolicy"
                      value="update"
                      checked={duplicateHandling === 'update'}
                      onChange={() => setDuplicateHandling('update')}
                      className="hidden"
                    />
                    <span>Update / Overwrite Existing</span>
                  </label>

                  <label
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition ${
                      duplicateHandling === 'skip'
                        ? 'bg-amber-100 text-amber-900 border-amber-400 ring-2 ring-amber-300'
                        : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="dupPolicy"
                      value="skip"
                      checked={duplicateHandling === 'skip'}
                      onChange={() => setDuplicateHandling('skip')}
                      className="hidden"
                    />
                    <span>Skip Existing</span>
                  </label>

                  <label
                    className={`px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition ${
                      duplicateHandling === 'rename'
                        ? 'bg-blue-100 text-blue-900 border-blue-400 ring-2 ring-blue-300'
                        : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="dupPolicy"
                      value="rename"
                      checked={duplicateHandling === 'rename'}
                      onChange={() => setDuplicateHandling('rename')}
                      className="hidden"
                    />
                    <span>Auto-assign New Tag</span>
                  </label>
                </div>
              </div>

              {/* Data Preview Table with Filter Tabs */}
              <div className="bg-white border border-stone-200 rounded-2xl overflow-hidden shadow-2xs">
                <div className="p-3 bg-stone-50 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setValidationFilter('all')}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                        validationFilter === 'all'
                          ? 'bg-stone-800 text-white shadow-xs'
                          : 'bg-white text-stone-600 hover:bg-stone-200 border border-stone-300'
                      }`}
                    >
                      All Rows ({validationResults.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setValidationFilter('valid')}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                        validationFilter === 'valid'
                          ? 'bg-emerald-700 text-white shadow-xs'
                          : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300'
                      }`}
                    >
                      Valid ({validationStats.valid})
                    </button>

                    <button
                      type="button"
                      onClick={() => setValidationFilter('warnings')}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                        validationFilter === 'warnings'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-300'
                      }`}
                    >
                      Warnings ({validationStats.warnings})
                    </button>

                    <button
                      type="button"
                      onClick={() => setValidationFilter('errors')}
                      className={`px-3 py-1 rounded-xl text-xs font-bold transition cursor-pointer ${
                        validationFilter === 'errors'
                          ? 'bg-rose-700 text-white shadow-xs'
                          : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-300'
                      }`}
                    >
                      Errors ({validationStats.errors})
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        value={searchFilter}
                        onChange={e => setSearchFilter(e.target.value)}
                        placeholder="Search rows..."
                        className="text-xs pl-8 pr-3 py-1 bg-white border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:outline-hidden w-44"
                      />
                    </div>

                    {(validationStats.errors > 0 || validationStats.warnings > 0) && (
                      <button
                        type="button"
                        onClick={handleDownloadErrorReport}
                        className="px-2.5 py-1 text-[11px] font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 rounded-xl border border-rose-300 flex items-center gap-1 transition cursor-pointer"
                        title="Download spreadsheet report of all errors and warnings"
                      >
                        <Download className="w-3 h-3 text-rose-600" />
                        <span>Download Issues Log</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto max-h-80">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-stone-100 text-stone-700 font-bold border-b border-stone-200 sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3">Row</th>
                        <th className="py-2.5 px-3"><InterfaceText source="Status" /></th>
                        <th className="py-2.5 px-3"><InterfaceText source="Pig ID Tag" /></th>
                        <th className="py-2.5 px-3"><InterfaceText source="Farmer Name" /></th>
                        <th className="py-2.5 px-3"><InterfaceText source="Barangay" /></th>
                        <th className="py-2.5 px-3">Birth Date / Age</th>
                        <th className="py-2.5 px-3">Weight (kg)</th>
                        <th className="py-2.5 px-3">Custom Fields</th>
                        <th className="py-2.5 px-3">Validation Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 font-medium text-stone-800">
                      {filteredValidationResults.slice(0, 100).map(res => {
                        const rec = res.mappedRecord;
                        const hasErrors = !res.isValid;
                        const hasWarnings = res.warnings.length > 0;

                        return (
                          <tr
                            key={res.rowNumber}
                            className={`hover:bg-stone-50 transition ${
                              hasErrors
                                ? 'bg-rose-50/50'
                                : hasWarnings
                                ? 'bg-amber-50/30'
                                : ''
                            }`}
                          >
                            <td className="py-2 px-3 font-mono text-[11px] text-stone-500">
                              #{res.rowNumber}
                            </td>

                            <td className="py-2 px-3">
                              {hasErrors ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-900 border border-rose-300 inline-flex items-center gap-1">
                                  <AlertTriangle className="w-2.5 h-2.5 text-rose-600" /><InterfaceText source="Error" /></span>
                              ) : hasWarnings ? (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-1">
                                  <AlertTriangle className="w-2.5 h-2.5 text-amber-600" /><InterfaceText source="Warning" /></span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 inline-flex items-center gap-1">
                                  <Check className="w-2.5 h-2.5 text-emerald-700" /> Valid
                                </span>
                              )}
                            </td>

                            <td className="py-2 px-3 font-mono font-bold text-stone-900">
                              {rec.pigIdTag || '—'}
                            </td>

                            <td className="py-2 px-3 font-bold text-stone-900">
                              {rec.farmerName || <span className="text-rose-500 italic">Empty</span>}
                            </td>

                            <td className="py-2 px-3">{rec.barangay || '—'}</td>

                            <td className="py-2 px-3">
                              <span className="text-[11px]">{rec.birthDate || 'N/A'}</span>
                              {rec.ageMonths ? (
                                <span className="text-[10px] text-stone-500 ml-1.5 font-bold">
                                  ({rec.ageMonths} mo)
                                </span>
                              ) : null}
                            </td>

                            <td className="py-2 px-3 font-bold">{rec.actualWeightKg ?? rec.weightKg ?? '—'} kg</td>

                            <td className="py-2 px-3">
                              {rec.customFields && Object.keys(rec.customFields).length > 0 ? (
                                <span className="px-2 py-0.5 rounded-lg bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-bold">
                                  {Object.keys(rec.customFields).length} Custom Fields
                                </span>
                              ) : (
                                <span className="text-stone-400 italic text-[11px]">—</span>
                              )}
                            </td>

                            <td className="py-2 px-3 text-[11px] max-w-xs truncate">
                              {hasErrors ? (
                                <span className="text-rose-700 font-semibold">
                                  {res.errors.map(e => e.message).join(' ')}
                                </span>
                              ) : hasWarnings ? (
                                <span className="text-amber-700">
                                  {res.warnings.map(w => w.message).join(' ')}
                                </span>
                              ) : (
                                <span className="text-emerald-700">Ready for import</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {filteredValidationResults.length > 100 && (
                  <div className="p-2.5 bg-stone-50 text-center text-stone-500 text-[11px] border-t border-stone-200">
                    Showing first 100 rows of {filteredValidationResults.length} total rows.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: IMPORTING & PROGRESS */}
          {currentStep === 'importing' && (
            <div className="py-12 px-6 text-center space-y-6">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center animate-spin">
                <RefreshCw className="w-8 h-8 text-emerald-700" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-stone-900"><InterfaceText source="Importing Swine Registry Data..." /></h3>
                <p className="text-xs text-stone-500 mt-1">{<LocalizedFeedback value={importStatusMsg} />}</p>
              </div>

              <div className="max-w-md mx-auto space-y-2">
                <div className="w-full bg-stone-200 rounded-full h-3 overflow-hidden shadow-inner">
                  <div
                    className="bg-gradient-to-r from-emerald-600 to-teal-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${importProgress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] font-bold text-stone-600">
                  <span><InterfaceText source="Progress" /></span>
                  <span>{importProgress}%</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: COMPLETED SUMMARY */}
          {currentStep === 'completed' && (
            <div className="py-8 px-6 text-center space-y-6 animate-fadeIn">
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 shadow-lg">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-stone-900"><InterfaceText source="Import Results" /></h3>
                <p className="text-xs text-stone-500 mt-1">
                  {<LocalizedFeedback value={resultStatus} />}
                </p>
              </div>

              {importFailures.length > 0 && <div className="text-left rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
                <button type="button" onClick={downloadImportFailures} className="font-bold underline mb-2"><InterfaceText source="Download rejected rows and reasons" /></button>
                <ul className="space-y-1">{importFailures.slice(0,20).map((failure,index) => <li key={index}>Row {failure.row}: {failure.reason}</li>)}</ul>
              </div>}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl">
                  <p className="text-[10px] font-bold text-emerald-800 uppercase"><InterfaceText source="New Records Created" /></p>
                  <p className="text-2xl font-black text-emerald-950 mt-1">{importSummary.created}</p>
                </div>

                <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl">
                  <p className="text-[10px] font-bold text-blue-800 uppercase"><InterfaceText source="Records Updated" /></p>
                  <p className="text-2xl font-black text-blue-950 mt-1">{importSummary.updated}</p>
                </div>

                <div className="bg-purple-50 border border-purple-200 p-4 rounded-2xl">
                  <p className="text-[10px] font-bold text-purple-800 uppercase"><InterfaceText source="Custom Fields Created" /></p>
                  <p className="text-2xl font-black text-purple-950 mt-1">{importSummary.newFieldsCount}</p>
                </div>

                <div className="bg-stone-50 border border-stone-200 p-4 rounded-2xl">
                  <p className="text-[10px] font-bold text-stone-600 uppercase"><InterfaceText source="Skipped / Failed" /></p>
                  <p className="text-2xl font-black text-stone-900 mt-1">{importSummary.skipped}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Navigation */}
        <div className="bg-stone-50 border-t border-stone-200 p-4 px-6 flex items-center justify-between shrink-0">
          <div>
            {currentStep !== 'upload' && currentStep !== 'completed' && currentStep !== 'importing' && (
              <button
                type="button"
                onClick={() => {
                  if (currentStep === 'mapping') setCurrentStep('upload');
                  if (currentStep === 'validation') setCurrentStep('mapping');
                }}
                className="px-4 py-2 rounded-xl bg-white border border-stone-300 hover:bg-stone-100 text-stone-700 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span><InterfaceText source="Back" /></span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {currentStep === 'upload' && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white border border-stone-300 hover:bg-stone-100 text-stone-700 text-xs font-bold transition cursor-pointer"
              ><InterfaceText source="Cancel" /></button>
            )}

            {currentStep === 'mapping' && (
              <button
                type="button"
                onClick={handleProceedToValidation}
                className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition cursor-pointer"
              >
                <span><InterfaceText source="Proceed to Data Validation" /></span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {currentStep === 'validation' && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={validationStats.valid + validationStats.warnings === 0 || isImporting}
                className="px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-2 shadow-md transition cursor-pointer disabled:opacity-50"
              >
                <Database className="w-4 h-4" />
                <span>{validationStats.newFieldsCount ? translateInterfaceText("Create Custom Fields & Import") : `Commit ${validationStats.valid + validationStats.warnings} Records to Database`}</span>
              </button>
            )}

            {currentStep === 'completed' && (
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-md transition cursor-pointer"
              ><InterfaceText source="Done & View Records" /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
