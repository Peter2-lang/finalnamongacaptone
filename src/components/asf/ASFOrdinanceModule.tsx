import { LocalizedFeedback } from '../../i18n/LocalizedFeedback';
import { InterfaceText, translateInterfaceText } from '../../i18n/interfaceText';
import React, { useState, useMemo } from 'react';
import {
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MapPin,
  Scale,
  Printer,
  Search,
  ChevronRight,
  BookOpen,
  Info,
  Building,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Archive,
  RefreshCw,
  Eye,
  ScrollText,
  ShieldAlert,
  Paperclip,
  History,
  Trees,
  SlidersHorizontal,
  Compass,
  Check,
  Download,
  Upload,
  Sparkles,
} from 'lucide-react';
import { storageService } from '../../services/storageService';
import { ASFRegulatoryDocument, Barangay, LegalSourceAttachment, UserAccount } from '../../types';
import { LegalDocumentComboBox } from './LegalDocumentComboBox';
import { LegalLocationalTable } from './LegalLocationalTable';
import { LegalDocumentPrintView } from './LegalDocumentPrintView';
import { LegalComplianceCalculator } from './LegalComplianceCalculator';
import { LegalDocumentEditModal } from './LegalDocumentEditModal';
import { LegalSmartImportModal } from './LegalSmartImportModal';
import { LegalImportHistoryModal } from './LegalImportHistoryModal';
import { LegalDocumentOriginalViewerModal } from './LegalDocumentOriginalViewerModal';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface ASFOrdinanceModuleProps {
  barangays?: Barangay[];
  currentUser: UserAccount | null;
  onNavigateTab?: (tab: string) => void;
}

export const ASFOrdinanceModule: React.FC<ASFOrdinanceModuleProps> = ({
  barangays = [],
  currentUser,
  onNavigateTab,
}) => {
  const [regulations, setRegulations] = useState<ASFRegulatoryDocument[]>(() =>
    storageService.getAsfRegulations()
  );
  const [selectedDocId, setSelectedDocId] = useState<string>(
    regulations[0]?.id || 'mo-hinunangan-2025-59'
  );
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | 'ordinance' | 'resolution' | 'provincial_ordinance' | 'executive_order' | 'national_reference' | 'archived'
  >('all');
  const [activeDocTab, setActiveDocTab] = useState<
    'articles' | 'locational_standards' | 'task_force' | 'penalties' | 'compliance_checker' | 'attachments' | 'history'
  >('articles');
  const [searchTerm, setSearchTerm] = useState('');
  const [documentSearchTerm, setDocumentSearchTerm] = useState('');
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [confirmResetSeeds, setConfirmResetSeeds] = useState(false);

  // Modals
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [docToEdit, setDocToEdit] = useState<ASFRegulatoryDocument | null>(null);
  const [isPrintViewOpen, setIsPrintViewOpen] = useState(false);
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState<ASFRegulatoryDocument | null>(null);
  const [isSmartImportOpen, setIsSmartImportOpen] = useState(false);
  const [isImportHistoryOpen, setIsImportHistoryOpen] = useState(false);
  const [isOriginalViewerOpen, setIsOriginalViewerOpen] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<LegalSourceAttachment | null>(null);

  React.useEffect(() => {
    let active = true;
    storageService.fetchAsfRegulationsFromApi().then(documents => {
      if (active) setRegulations(documents);
    }).catch(error => {
      if (active) setDocumentError(error instanceof Error ? error.message : 'Unable to load legal documents.');
    }).finally(() => { if (active) setIsLoadingDocuments(false); });
    return () => { active = false; };
  }, []);

  const isAdmin = (currentUser?.role === 'admin' || currentUser?.role === 'super_admin');
  const visibleRegulations = useMemo(
    () => isAdmin ? regulations : regulations.filter(document => document.status === 'verified' && !document.isArchived),
    [isAdmin, regulations],
  );

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  // Filtered documents list by category
  const filteredDocs = useMemo(() => {
    return visibleRegulations.filter(doc => {
      const archived = doc.status === 'archived' || doc.isArchived;
      if (categoryFilter === 'archived' ? !archived : archived) return false;
      const matchesCategory =
        categoryFilter === 'all' || categoryFilter === 'archived' ||
        (categoryFilter === 'ordinance' && doc.type === 'municipal_ordinance') ||
        (categoryFilter === 'resolution' && doc.type === 'resolution') ||
        (categoryFilter === 'provincial_ordinance' && doc.type === 'provincial_ordinance') ||
        (categoryFilter === 'executive_order' && doc.type === 'municipal_eo') ||
        (categoryFilter === 'national_reference' &&
          (doc.category === 'national_reference' || doc.type.includes('administrative_order') || doc.type.includes('reference')));
      const query = documentSearchTerm.trim().toLowerCase();
      const matchesSearch = !query ||
        [doc.title, doc.officialNumber, doc.seriesYear, doc.type, doc.category]
          .some(value => value?.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [visibleRegulations, categoryFilter, documentSearchTerm]);

  // Ensure valid selected document
  const selectedDoc = useMemo(() => {
    return (
      filteredDocs.find(r => r.id === selectedDocId) ||
      filteredDocs[0] ||
      visibleRegulations.find(r => r.id === selectedDocId) ||
      visibleRegulations[0]
    );
  }, [visibleRegulations, selectedDocId, filteredDocs]);

  // Filtered articles/sections within selected document
  const filteredArticles = useMemo(() => {
    if (!selectedDoc) return [];
    if (!searchTerm.trim()) {
      return selectedDoc.articles || [];
    }
    const q = searchTerm.toLowerCase();
    return (selectedDoc.articles || [])
      .map(art => ({
        ...art,
        sections: art.sections.filter(
          sec =>
            sec.sectionNumber.toLowerCase().includes(q) ||
            sec.sectionTitle.toLowerCase().includes(q) ||
            sec.content.toLowerCase().includes(q) ||
            art.articleNumber.toLowerCase().includes(q) ||
            art.articleTitle.toLowerCase().includes(q)
        ),
      }))
      .filter(art => art.sections.length > 0);
  }, [selectedDoc, searchTerm]);

  // CRUD Handlers
  const handleCreateNew = () => {
    setDocToEdit(null);
    setIsEditModalOpen(true);
  };

  const handleEditCurrent = () => {
    if (!selectedDoc) return;
    setDocToEdit(selectedDoc);
    setIsEditModalOpen(true);
  };

  const handleSaveDoc = async (doc: ASFRegulatoryDocument, changeSummary?: string) => {
    try {
    if (docToEdit) {
      await storageService.updateAsfRegulation(doc, currentUser?.name || currentUser?.username || 'Admin', changeSummary);
      showToast(`Updated "${doc.officialNumber}" successfully.`);
    } else {
      await storageService.addAsfRegulation(doc, currentUser?.name || currentUser?.username || 'Admin');
      showToast(`Created "${doc.officialNumber}" successfully.`);
      setSelectedDocId(doc.id);
    }
    setRegulations(storageService.getAsfRegulations());
    } catch (error) {
      throw error;
    }
  };

  const handleArchiveDoc = async (doc: ASFRegulatoryDocument) => {
    try {
    await storageService.archiveAsfRegulation(doc.id, currentUser?.name || currentUser?.username || 'Admin');
    setRegulations(storageService.getAsfRegulations());
    showToast(`Archived "${doc.officialNumber}". Moved to Archived tab.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save legal document.');
    }
  };

  const handleRestoreDoc = async (doc: ASFRegulatoryDocument) => {
    try {
    await storageService.restoreAsfRegulation(doc.id, currentUser?.name || currentUser?.username || 'Admin');
    setRegulations(storageService.getAsfRegulations());
    showToast(`Restored "${doc.officialNumber}" for official verification.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save legal document.');
    }
  };

  const handleConfirmDelete = async () => {
    try {
    if (!deleteConfirmDoc) return;
    await storageService.deleteAsfRegulation(deleteConfirmDoc.id);
    const updated = storageService.getAsfRegulations();
    setRegulations(updated);
    if (selectedDocId === deleteConfirmDoc.id) {
      setSelectedDocId(updated[0]?.id || '');
    }
    showToast(`Permanently deleted "${deleteConfirmDoc.officialNumber}".`);
    setDeleteConfirmDoc(null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to save legal document.');
    }
  };

  const handleResetToOfficialSeeds = async () => {
    try {
      const reset = await storageService.resetAsfRegulations();
      setRegulations(reset);
      setSelectedDocId(reset[0]?.id || '');
      showToast('Successfully restored official statutory documents.');
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to restore official documents.');
      return false;
    }
  };

  return (
    <>
    <div className="space-y-6">
      {isLoadingDocuments && <p role="status">Loading legal documents…</p>}
      {documentError && <p role="alert" className="p-3 bg-red-50 text-red-700 rounded-lg">{<LocalizedFeedback value={documentError} />}</p>}
      {/* Toast notification */}
      {successToast && (
        <div className="fixed top-20 right-6 z-50 bg-emerald-900 text-white px-4 py-3 rounded-xl shadow-xl flex items-center gap-2.5 border border-emerald-700 animate-in fade-in slide-in-from-top-4 duration-200 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Page Title & Mission Banner */}
      <div className="bg-white rounded-2xl p-6 border border-stone-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-emerald-800 text-white rounded-2xl shadow-xs shrink-0">
            <Scale className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold tracking-tight text-stone-900">
                Legal Decrees &amp; Ordinances Management
              </h2>
              <span className="text-[10px] font-bold bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                Official Law Registry
              </span>
            </div>
            <p className="text-xs text-stone-500 mt-1 max-w-2xl">
              Legislative database of enacted Municipal Ordinances, Sangguniang Bayan Resolutions, Bantay ASF Decrees, and locational standards in the Municipality of Hinunangan, Southern Leyte.
            </p>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => setIsImportHistoryOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl transition border border-stone-200"
            title="View smart import audit trail and logs"
          >
            <History className="w-3.5 h-3.5 text-emerald-700" /> Import History
          </button>

          <button
            type="button"
            onClick={handleResetToOfficialSeeds}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
            title="Reset to official municipal ordinances"
          >
            <RefreshCw className="w-3.5 h-3.5 text-stone-500" /> Reset to Official Laws
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setIsSmartImportOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl shadow-md transition transform hover:-translate-y-0.5"
                title="Smart Import PDF, DOCX, XLSX, or Scanned Legal Documents with OCR"
              >
                <Sparkles className="w-4 h-4 text-emerald-200" />
                <span>+ Import Legal Document</span>
              </button>

              <button
                type="button"
                onClick={handleCreateNew}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-xl shadow-xs transition"
              >
                <Plus className="w-4 h-4 text-stone-300" /> Manual Entry
              </button>
            </>
          )}
        </div>
      </div>

      {/* Document Selection Combo Box & Category Filters */}
      <div className="bg-white rounded-2xl p-4 border border-stone-200 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          {/* Combo Box */}
          <div className="flex-1 min-w-0">
            <LegalDocumentComboBox
              documents={filteredDocs}
              selectedId={selectedDoc?.id || ''}
              onSelect={id => {
                setSelectedDocId(id);
                setSelectedArticleId(null);
              }}
            />
          </div>

          {/* Quick Search */}
          <div className="relative lg:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3.5 top-3 text-stone-400" />
            <input
              type="text"
              value={documentSearchTerm}
              onChange={e => setDocumentSearchTerm(e.target.value)}
              placeholder="Search title, number, year, category..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <div className="relative lg:w-72">
            <Search className="w-3.5 h-3.5 absolute left-3.5 top-3 text-stone-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search sections and provisions..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-stone-50 border border-stone-300 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>

        {/* Category Pills Filter */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs border-t border-stone-100 pt-3">
          <span className="text-stone-400 font-semibold text-[11px] uppercase tracking-wider shrink-0 mr-1">
            Filter View:
          </span>
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 ${
              categoryFilter === 'all'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            All Documents ({visibleRegulations.filter(r => !r.isArchived && r.status !== 'archived').length})
          </button>

          <button
            type="button"
            onClick={() => setCategoryFilter('ordinance')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1.5 ${
              categoryFilter === 'ordinance'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Municipal Ordinances (
            {visibleRegulations.filter(r => r.type === 'municipal_ordinance' && !r.isArchived && r.status !== 'archived').length})
          </button>

          <button
            type="button"
            onClick={() => setCategoryFilter('resolution')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1.5 ${
              categoryFilter === 'resolution'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            <ScrollText className="w-3.5 h-3.5" /> Resolutions (
            {visibleRegulations.filter(r => (r.category === 'resolution' || r.type.includes('resolution')) && !r.isArchived && r.status !== 'archived').length})
          </button>

          <button
            type="button"
            onClick={() => setCategoryFilter('provincial_ordinance')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 ${
              categoryFilter === 'provincial_ordinance'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Provincial ASF Ordinances (
            {visibleRegulations.filter(r => r.type === 'provincial_ordinance' && !r.isArchived && r.status !== 'archived').length})
          </button>

          <button
            type="button"
            onClick={() => setCategoryFilter('executive_order')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 ${
              categoryFilter === 'executive_order'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            Municipal ASF Executive Orders (
            {visibleRegulations.filter(r => r.type === 'municipal_eo' && !r.isArchived && r.status !== 'archived').length})
          </button>

          <button
            type="button"
            onClick={() => setCategoryFilter('national_reference')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1.5 ${
              categoryFilter === 'national_reference'
                ? 'bg-emerald-800 text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" /> National References (
            {visibleRegulations.filter(r => (r.category === 'national_reference' || r.type.includes('order')) && !r.isArchived && r.status !== 'archived').length})
          </button>

          <button
            type="button"
            onClick={() => setCategoryFilter('archived')}
            className={`px-3 py-1.5 rounded-xl font-bold transition shrink-0 flex items-center gap-1.5 ${
              categoryFilter === 'archived'
                ? 'bg-stone-800 text-white shadow-xs'
                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
            }`}
          >
            <Archive className="w-3.5 h-3.5" /> Archived (
            {visibleRegulations.filter(r => r.isArchived || r.status === 'archived').length})
          </button>
        </div>
      </div>

      {/* Active Document Header Card */}
      {selectedDoc && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
          {/* Document Masthead */}
          <div className="p-6 bg-gradient-to-r from-emerald-950 via-stone-900 to-emerald-900 text-white">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-xs font-mono font-bold bg-emerald-600/90 text-white px-2.5 py-0.5 rounded-md">
                    {selectedDoc.officialNumber}
                  </span>
                  <span className="text-xs bg-white/15 text-emerald-100 px-2.5 py-0.5 rounded-md font-semibold">
                    {selectedDoc.seriesYear}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-md font-bold flex items-center gap-1 ${
                    selectedDoc.status === 'verified'
                      ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/30'
                      : 'bg-amber-400/90 text-amber-950'
                  }`}>
                    {selectedDoc.status === 'verified' ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {selectedDoc.status === 'verified'
                      ? 'Verified Official Document'
                      : selectedDoc.status === 'for_verification'
                        ? 'For Verification — Not Enforceable'
                        : selectedDoc.status === 'draft'
                          ? 'Draft / Pending Official Verification'
                          : selectedDoc.status === 'superseded'
                            ? 'Superseded'
                            : selectedDoc.status === 'archived' || selectedDoc.isArchived
                              ? 'Archived'
                              : 'Legacy Status — Verification Required'}
                  </span>
                </div>

                <h3 className="text-base sm:text-lg font-bold mt-2.5 leading-snug">
                  {selectedDoc.title}
                </h3>
                {selectedDoc.sourceCompleteness && selectedDoc.sourceCompleteness !== 'complete' && (
                  <p className="mt-2 max-w-3xl rounded-lg border border-amber-300/50 bg-amber-950/40 p-2 text-xs text-amber-100">
                    {selectedDoc.sourceCompleteness === 'excerpt'
                      ? 'Source is an incomplete excerpt; do not treat it as the complete ordinance.'
                      : 'Original source is unavailable or incomplete. The record is not verified and must not be treated as enforceable law.'}
                  </p>
                )}

                {selectedDoc.knownAs && (
                  <p className="text-xs text-emerald-300 font-semibold mt-1"><InterfaceText source="Known as: “" />{selectedDoc.knownAs}&rdquo;
                  </p>
                )}

                <div className="flex items-center gap-4 mt-3 text-xs text-stone-300 flex-wrap">
                  {selectedDoc.author && (
                    <span>
                      <strong className="text-stone-100"><InterfaceText source="Author:" /></strong> {selectedDoc.author}
                    </span>
                  )}
                  {selectedDoc.dateEnacted && (
                    <span>
                      <strong className="text-stone-100"><InterfaceText source="Enacted:" /></strong> {selectedDoc.dateEnacted}
                    </span>
                  )}
                  {selectedDoc.effectiveDate && (
                    <span>
                      <strong className="text-stone-100">Effectivity:</strong> {selectedDoc.effectiveDate}
                    </span>
                  )}
                  {selectedDoc.signatory && (
                    <span>
                      <strong className="text-stone-100">Signatory:</strong> {selectedDoc.signatory} ({selectedDoc.signatoryTitle})
                    </span>
                  )}
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAttachment(null);
                    setIsOriginalViewerOpen(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 hover:text-white rounded-xl text-xs font-bold transition border border-emerald-500/30"
                  title="Inspect Original Scanned Document / Source Split View"
                >
                  <Eye className="w-4 h-4" /> View Original Source
                </button>

                <button
                  type="button"
                  onClick={() => setIsPrintViewOpen(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition border border-white/20"
                >
                  <Printer className="w-4 h-4" /><InterfaceText source="Print Document" /></button>

                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={handleEditCurrent}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-xs"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit Decree
                    </button>

                    {selectedDoc.status === 'archived' || selectedDoc.isArchived ? (
                      <button
                        type="button"
                        onClick={() => handleRestoreDoc(selectedDoc)}
                        className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /><InterfaceText source="Restore" /></button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleArchiveDoc(selectedDoc)}
                        className="flex items-center gap-1.5 px-3 py-2 bg-stone-700 hover:bg-stone-600 text-stone-200 rounded-xl text-xs font-semibold transition"
                        title="Move to Archive"
                      >
                        <Archive className="w-3.5 h-3.5" /> Archive
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setDeleteConfirmDoc(selectedDoc)}
                      className="p-2 bg-red-950/60 hover:bg-red-900 text-red-200 hover:text-white rounded-xl transition border border-red-800/40"
                      title={translateInterfaceText("Permanently Delete")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Document Sub-Navigation Tabs */}
          <div className="px-6 border-b border-stone-200 bg-stone-50/80 flex items-center gap-1 overflow-x-auto text-xs">
            <button
              type="button"
              onClick={() => setActiveDocTab('articles')}
              className={`px-4 py-3 font-bold border-b-2 transition shrink-0 flex items-center gap-1.5 ${
                activeDocTab === 'articles'
                  ? 'border-emerald-700 text-emerald-900 bg-white'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <BookOpen className="w-4 h-4 text-emerald-700" /> Statutory Articles &amp; Sections (
              {selectedDoc.articles ? selectedDoc.articles.reduce((acc, a) => acc + a.sections.length, 0) : selectedDoc.keyArticles.length})
            </button>

            {selectedDoc.locationalStandards && selectedDoc.locationalStandards.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveDocTab('locational_standards')}
                className={`px-4 py-3 font-bold border-b-2 transition shrink-0 flex items-center gap-1.5 ${
                  activeDocTab === 'locational_standards'
                    ? 'border-emerald-700 text-emerald-900 bg-white'
                    : 'border-transparent text-stone-600 hover:text-stone-900'
                }`}
              >
                <Compass className="w-4 h-4 text-emerald-700" /> Locational Design Standards (Sec. 9 &amp; 10)
              </button>
            )}

            {selectedDoc.mltfMembers && selectedDoc.mltfMembers.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveDocTab('task_force')}
                className={`px-4 py-3 font-bold border-b-2 transition shrink-0 flex items-center gap-1.5 ${
                  activeDocTab === 'task_force'
                    ? 'border-emerald-700 text-emerald-900 bg-white'
                    : 'border-transparent text-stone-600 hover:text-stone-900'
                }`}
              >
                <Shield className="w-4 h-4 text-emerald-700" /> Municipal Task Force (MLTF)
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveDocTab('penalties')}
              className={`px-4 py-3 font-bold border-b-2 transition shrink-0 flex items-center gap-1.5 ${
                activeDocTab === 'penalties'
                  ? 'border-emerald-700 text-emerald-900 bg-white'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <Scale className="w-4 h-4 text-emerald-700" /> Setbacks &amp; Penalties
            </button>

            <button
              type="button"
              onClick={() => setActiveDocTab('compliance_checker')}
              className={`px-4 py-3 font-bold border-b-2 transition shrink-0 flex items-center gap-1.5 ${
                activeDocTab === 'compliance_checker'
                  ? 'border-emerald-700 text-emerald-900 bg-white'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4 text-emerald-700" /> Legal Compliance Checker
            </button>

            <button
              type="button"
              onClick={() => setActiveDocTab('attachments')}
              className={`px-4 py-3 font-bold border-b-2 transition shrink-0 flex items-center gap-1.5 ${
                activeDocTab === 'attachments'
                  ? 'border-emerald-700 text-emerald-900 bg-white'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <Paperclip className="w-4 h-4 text-emerald-700" /> Scanned Document &amp; Files
            </button>

            <button
              type="button"
              onClick={() => setActiveDocTab('history')}
              className={`px-4 py-3 font-bold border-b-2 transition shrink-0 flex items-center gap-1.5 ${
                activeDocTab === 'history'
                  ? 'border-emerald-700 text-emerald-900 bg-white'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <History className="w-4 h-4 text-emerald-700" /> Version History &amp; Audit
            </button>
          </div>

          {/* Sub-Tab Contents */}
          <div className="p-6">
            {/* Tab 1: Articles & Sections */}
            {activeDocTab === 'articles' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Table of Contents sidebar */}
                <div className="lg:col-span-4 bg-stone-50 p-4 rounded-2xl border border-stone-200 max-h-[600px] overflow-y-auto space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 mb-3 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-emerald-700" /> Table of Contents
                  </h4>

                  {selectedDoc.articles && selectedDoc.articles.length > 0 ? (
                    selectedDoc.articles.map(art => (
                      <div key={art.id} className="space-y-1">
                        <span className="text-[11px] font-bold text-stone-800 uppercase block px-2 py-1 bg-stone-200/60 rounded">
                          {art.articleNumber} – {art.articleTitle}
                        </span>
                        <div className="pl-2 space-y-0.5">
                          {art.sections.map(sec => (
                            <button
                              key={sec.id}
                              type="button"
                              onClick={() => {
                                setSelectedArticleId(sec.id);
                                const el = document.getElementById(`section-${sec.id}`);
                                if (el) el.scrollIntoView({ behavior: 'smooth' });
                              }}
                              className={`w-full text-left px-2 py-1 text-[11px] rounded transition truncate block ${
                                selectedArticleId === sec.id
                                  ? 'bg-emerald-100 text-emerald-950 font-bold'
                                  : 'text-stone-600 hover:bg-stone-100'
                              }`}
                            >
                              {sec.sectionNumber}. {sec.sectionTitle}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="space-y-1">
                      {selectedDoc.keyArticles.map((art, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="w-full text-left px-2 py-1 text-xs text-stone-700 hover:bg-stone-100 rounded truncate block"
                        >
                          {art.number}. {art.heading}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Main Articles View */}
                <div className="lg:col-span-8 space-y-6">
                  {/* Statutory Basis Box */}
                  {selectedDoc.legalBasis && selectedDoc.legalBasis.length > 0 && (
                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 text-xs">
                      <h4 className="font-bold text-stone-900 uppercase tracking-wider mb-2">
                        Official Legal Basis &amp; Authority:
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-stone-700">
                        {selectedDoc.legalBasis.map((basis, idx) => (
                          <li key={idx}>{basis}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Articles & Sections Full Breakdown */}
                  {filteredArticles.length === 0 ? (
                    <div className="py-12 text-center text-xs text-stone-500">
                      No sections matching &quot;{searchTerm}&quot; in this document.
                    </div>
                  ) : (
                    filteredArticles.map(article => (
                      <div
                        key={article.id}
                        className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden"
                      >
                        <div className="px-5 py-3.5 bg-emerald-950 text-white flex items-center justify-between">
                          <div>
                            <span className="text-xs font-mono text-emerald-300 font-bold mr-2">
                              {article.articleNumber}
                            </span>
                            <span className="text-xs font-bold uppercase tracking-wider">
                              {article.articleTitle}
                            </span>
                          </div>
                          <span className="text-[10px] text-emerald-200 bg-emerald-900/60 px-2 py-0.5 rounded-full font-semibold">
                            {article.sections.length} Sections
                          </span>
                        </div>

                        <div className="p-5 space-y-4 divide-y divide-stone-100">
                          {article.sections.map(sec => (
                            <div
                              key={sec.id}
                              id={`section-${sec.id}`}
                              className="pt-4 first:pt-0 space-y-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-emerald-950 font-mono text-xs">
                                    {sec.sectionNumber}
                                  </span>
                                  <span className="font-bold text-stone-900 uppercase">
                                    {sec.sectionTitle}
                                  </span>
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase ${
                                    sec.mandateCategory === 'prohibitive'
                                      ? 'bg-red-100 text-red-800'
                                      : sec.mandateCategory === 'penal'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {sec.mandateCategory || translateInterfaceText("Mandatory")}
                                </span>
                              </div>

                              <p className="text-stone-800 text-xs leading-relaxed text-justify bg-stone-50/70 p-3.5 rounded-xl border border-stone-100">
                                {sec.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: Locational Design Standards (Sec. 9 & 10) */}
            {activeDocTab === 'locational_standards' && (
              <LegalLocationalTable
                standards={selectedDoc.locationalStandards}
                proximity={selectedDoc.proximityRegulations}
                officialNumber={selectedDoc.officialNumber}
              />
            )}

            {/* Tab 3: Municipal Livestock Task Force */}
            {activeDocTab === 'task_force' && (
              <div className="space-y-6">
                <div className="bg-emerald-900 text-white p-5 rounded-2xl flex items-start gap-4">
                  <div className="p-2.5 bg-emerald-800 rounded-xl shrink-0">
                    <Shield className="w-6 h-6 text-emerald-200" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold">
                      Municipal Livestock Task Force (MLTF) – Section 7 &amp; 8
                    </h4>
                    <p className="text-xs text-emerald-100 mt-1 leading-relaxed">
                      Statutory administrative body tasked with formulating the Implementing Rules and Regulations (IRR), conducting regular inspections, verifying public complaints, issuing Notices of Violation, and enforcing farm closures and dismantling of unauthorized structures.
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-stone-200 shadow-xs overflow-hidden">
                  <div className="px-5 py-3.5 bg-stone-50 border-b border-stone-200">
                    <h5 className="text-xs font-bold text-stone-900 uppercase">
                      Official Task Force Composition
                    </h5>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-stone-800">
                      <thead className="bg-stone-100 font-bold border-b border-stone-200 text-[11px]">
                        <tr>
                          <th className="px-4 py-3">Task Force Role</th>
                          <th className="px-4 py-3">Official Designation</th>
                          <th className="px-4 py-3">Department / Agency</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {selectedDoc.mltfMembers?.map((member, idx) => (
                          <tr key={idx} className="hover:bg-emerald-50/20 transition">
                            <td className="px-4 py-3 font-bold text-emerald-900">
                              {member.role}
                            </td>
                            <td className="px-4 py-3 font-semibold text-stone-900">
                              {member.title}
                            </td>
                            <td className="px-4 py-3 text-stone-600">{member.office}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Setbacks & Penalties */}
            {activeDocTab === 'penalties' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Setback Rules */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-emerald-700" /> Statutory Setback Clearances
                  </h4>
                  <div className="space-y-3">
                    {selectedDoc.setbackRules.map((rule, idx) => (
                      <div
                        key={idx}
                        className="bg-stone-50 p-4 rounded-2xl border border-stone-200 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <strong className="text-stone-900 font-bold">{rule.target}</strong>
                          <span className="font-mono font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                            ≥ {rule.minimumDistance}<InterfaceText source="meters" /></span>
                        </div>
                        <p className="text-[11px] text-stone-500 font-mono">{rule.statutoryBasis}</p>
                        <p className="text-stone-600 text-[11px]">{rule.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Penalties */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
                    <Scale className="w-4 h-4 text-emerald-700" /> Penal Clause &amp; Sanctions (Sec. 21)
                  </h4>
                  <div className="space-y-3">
                    {selectedDoc.penalties.map((pen, idx) => (
                      <div
                        key={idx}
                        className="bg-amber-50/60 p-4 rounded-2xl border border-amber-200 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <strong className="text-amber-950 font-bold">{pen.offenseTier}</strong>
                          {pen.finePhp > 0 && (
                            <span className="font-mono font-bold text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded">
                              ₱{pen.finePhp.toLocaleString()} Fine
                            </span>
                          )}
                        </div>
                        <p className="text-stone-700 text-xs leading-relaxed">{pen.punitiveActions}</p>
                        {pen.imprisonment && (
                          <p className="text-[11px] text-red-700 font-semibold mt-1">
                            Imprisonment: {pen.imprisonment}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 5: Legal Compliance Checker */}
            {activeDocTab === 'compliance_checker' && (
              <LegalComplianceCalculator document={selectedDoc} />
            )}

            {/* Tab 6: Attachments & Scans */}
            {activeDocTab === 'attachments' && (
              <div className="space-y-6">
                <div className="bg-stone-50 p-6 rounded-2xl border border-stone-200 text-center space-y-3">
                  <Paperclip className="w-8 h-8 text-stone-400 mx-auto" />
                  <div>
                    <h4 className="text-xs font-bold text-stone-800">
                      Official Scanned Legal Documents &amp; Enactment Certifications
                    </h4>
                    <p className="text-xs text-stone-500 mt-1 max-w-md mx-auto">
                      Scanned true copies of the signed ordinance, Sangguniang Bayan minutes, and posting certifications.
                    </p>
                  </div>
                  {isAdmin && <div className="pt-2">
                    <label className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-stone-100 border border-stone-300 text-stone-800 rounded-xl text-xs font-bold cursor-pointer transition shadow-2xs">
                      <Upload className="w-3.5 h-3.5 text-emerald-700" /> Upload / Replace Source (PDF, DOCX, JPG, PNG)
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.docx,.jpg,.jpeg,.png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png"
                        onChange={async e => {
                          const input = e.currentTarget;
                          const file = input.files?.[0];
                          if (!file || !selectedDoc) return;
                          try {
                            await storageService.uploadLegalDocumentAttachment(selectedDoc.id, file);
                            const documents = storageService.getAsfRegulations();
                            setRegulations(documents);
                            showToast(`Uploaded versioned source attachment "${file.name}".`);
                          } catch (error) {
                            showToast(error instanceof Error ? error.message : 'Unable to upload legal document attachment.');
                          } finally {
                            input.value = '';
                          }
                        }}
                      />
                    </label>
                  </div>}
                </div>

                {/* Scanned files list */}
                <div className="space-y-3">
                  {selectedDoc.sourceDocuments?.filter(docFile => docFile.storagePath || (docFile.url && docFile.url !== '/icon.svg')).length ? (
                    selectedDoc.sourceDocuments
                      .filter(docFile => docFile.storagePath || (docFile.url && docFile.url !== '/icon.svg'))
                      .map(docFile => (
                      <div
                        key={docFile.id}
                        className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-emerald-50 rounded-xl border border-emerald-100">
                            <FileText className="w-5 h-5 text-emerald-700" />
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-stone-900">{docFile.name}</h5>
                            <p className="text-[11px] text-stone-400">
                              Version {docFile.version || 1} • Uploaded by {docFile.uploadedBy || 'Administrator'} • {docFile.uploadedAt}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAttachment(docFile);
                              setIsOriginalViewerOpen(true);
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold rounded-lg transition"
                          >
                            <Eye className="w-3.5 h-3.5" /><InterfaceText source="View" /></button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-stone-500 italic text-center py-4">
                      Source page not yet provided.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Tab 7: Version History & Audit Trail */}
            {activeDocTab === 'history' && (
              <div className="space-y-6">
                <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-emerald-800" />
                    <h4 className="text-xs font-bold text-stone-900">
                      Audit Trail &amp; Document Version History
                    </h4>
                  </div>
                  <span className="text-[11px] text-stone-500 font-mono">
                    Official Record ID: {selectedDoc.id}
                  </span>
                </div>

                <div className="space-y-3">
                  {(selectedDoc.auditLogs || []).length === 0 ? (
                    <div className="p-4 bg-white rounded-xl border border-stone-200 text-xs text-stone-500">
                      Initial Enactment Record: Created on {selectedDoc.dateEnacted || 'March 3, 2025'} by Sangguniang Bayan Secretariat.
                    </div>
                  ) : (
                    selectedDoc.auditLogs?.map(log => (
                      <div
                        key={log.id}
                        className="bg-white p-3.5 rounded-xl border border-stone-200 flex items-start justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-stone-900 capitalize"><InterfaceText source="Action:" />{log.action}
                            </span>
                            <span className="text-[10px] text-stone-400 font-mono">
                              {new Date(log.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-stone-600 text-[11px]">{log.details}</p>
                        </div>
                        <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                          {log.performedBy}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmDoc && (
        <div className="fixed inset-0 z-50 bg-stone-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-red-600">
              <div className="p-2.5 bg-red-100 rounded-xl">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-stone-900">
                  Delete Legal Document?
                </h3>
                <p className="text-xs text-stone-500 font-mono">
                  {deleteConfirmDoc.officialNumber}
                </p>
              </div>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-stone-900">&ldquo;{deleteConfirmDoc.title}&rdquo;</strong>? This action cannot be undone. Alternatively, you can choose &ldquo;Archive&rdquo; to preserve the statutory record without permanently erasing it.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmDoc(null)}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-bold rounded-xl transition"
              ><InterfaceText source="Cancel" /></button>
              <button
                type="button"
                onClick={() => {
                  handleArchiveDoc(deleteConfirmDoc);
                  setDeleteConfirmDoc(null);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition"
              >
                Archive Instead
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition"
              ><InterfaceText source="Permanently Delete" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Create Modal */}
      <LegalDocumentEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        documentToEdit={docToEdit}
        onSave={handleSaveDoc}
        currentUserRole={currentUser?.role}
      />

      {/* Print View Modal */}
      {isPrintViewOpen && selectedDoc && (
        <LegalDocumentPrintView
          document={selectedDoc}
          onClose={() => setIsPrintViewOpen(false)}
        />
      )}

      {/* Smart Import Wizard Modal */}
      <LegalSmartImportModal
        isOpen={isSmartImportOpen}
        onClose={() => setIsSmartImportOpen(false)}
        onImportSuccess={importedDocs => {
          const docs = Array.isArray(importedDocs) ? importedDocs : [importedDocs];
          setRegulations(storageService.getAsfRegulations());
          if (docs.length > 0) {
            setSelectedDocId(docs[0].id);
            showToast(`Successfully smart-imported ${docs.length} legal document${docs.length > 1 ? 's' : ''}!`);
          }
        }}
        currentUser={currentUser}
      />

      {/* Import History Modal */}
      <LegalImportHistoryModal
        isOpen={isImportHistoryOpen}
        onClose={() => setIsImportHistoryOpen(false)}
        onSelectDocument={docId => {
          setSelectedDocId(docId);
        }}
      />

      {/* Original Source Split-Viewer Modal */}
      <LegalDocumentOriginalViewerModal
        isOpen={isOriginalViewerOpen}
        onClose={() => setIsOriginalViewerOpen(false)}
        document={selectedDoc}
        initialAttachment={selectedAttachment}
      />
    </div>
    <ConfirmDialog
      open={confirmResetSeeds}
      title="Restore official legal documents?"
      message="Replace the current legal decree library with the official municipal and provincial seed documents."
      confirmLabel="Restore Official Documents"
      variant="danger"
      onClose={() => setConfirmResetSeeds(false)}
      onConfirm={handleResetToOfficialSeeds}
    />
    </>
  );
};
