import { InterfaceText, translateInterfaceText } from '../../i18n/interfaceText';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Save,
  Plus,
  Trash2,
  FileText,
  Scale,
  ShieldAlert,
  Calendar,
  User,
  Building,
  Layers,
  HelpCircle,
} from 'lucide-react';
import { ASFRegulatoryDocument, LegalArticle, LegalArticleSection, LegalDocumentCategory, LegalDocumentStatus } from '../../types';

interface LegalDocumentEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  documentToEdit?: ASFRegulatoryDocument | null;
  onSave: (doc: ASFRegulatoryDocument, changeSummary?: string) => void | Promise<void>;
  currentUserRole?: string;
}

export const LegalDocumentEditModal: React.FC<LegalDocumentEditModalProps> = ({
  isOpen,
  onClose,
  documentToEdit,
  onSave,
  currentUserRole = 'admin',
}) => {
  const isEditMode = !!documentToEdit;

  const [activeTab, setActiveTab] = useState<'details' | 'articles' | 'setbacks_penalties'>('details');
  const [changeSummary, setChangeSummary] = useState('');

  // Form fields
  const [id, setId] = useState('');
  const [type, setType] = useState<string>('municipal_ordinance');
  const [category, setCategory] = useState<'ordinance' | 'resolution' | 'national_reference' | 'administrative_order' | string>('ordinance');
  const [officialNumber, setOfficialNumber] = useState('');
  const [seriesYear, setSeriesYear] = useState('');
  const [title, setTitle] = useState('');
  const [knownAs, setKnownAs] = useState('');
  const [jurisdiction, setJurisdiction] = useState('Municipality of Hinunangan, Southern Leyte');
  const [issuingAuthority, setIssuingAuthority] = useState('Sangguniang Bayan of Hinunangan, Southern Leyte');
  const [author, setAuthor] = useState('');
  const [signatory, setSignatory] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('Municipal Mayor');
  const [dateEnacted, setDateEnacted] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [shortSummary, setShortSummary] = useState('');
  const [legalBasisText, setLegalBasisText] = useState('');
  const [documentStatus, setDocumentStatus] = useState<LegalDocumentStatus>('draft');
  const [sourceCompleteness, setSourceCompleteness] = useState<'complete' | 'excerpt' | 'metadata_only'>('metadata_only');

  // Articles state
  const [articles, setArticles] = useState<LegalArticle[]>([]);

  // Key articles fallback
  const [keyArticles, setKeyArticles] = useState<
    { number: string; heading: string; text: string; mandateCategory: 'mandatory' | 'prohibitive' | 'advisory' }[]
  >([]);

  // Setbacks & Penalties
  const [setbackRules, setSetbackRules] = useState<
    { target: string; minimumDistance: number; statutoryBasis: string; rationale: string }[]
  >([]);

  const [penalties, setPenalties] = useState<
    { offenseTier: string; finePhp: number; punitiveActions: string; imprisonment?: string }[]
  >([]);

  // Populate when modal opens
  useEffect(() => {
    if (documentToEdit) {
      setId(documentToEdit.id);
      setType(documentToEdit.type || 'municipal_ordinance');
      setCategory(documentToEdit.category || (documentToEdit.type.includes('resolution') ? 'resolution' : 'ordinance'));
      setOfficialNumber(documentToEdit.officialNumber || '');
      setSeriesYear(documentToEdit.seriesYear || '');
      setTitle(documentToEdit.title || '');
      setKnownAs(documentToEdit.knownAs || '');
      setJurisdiction(documentToEdit.jurisdiction || 'Municipality of Hinunangan, Southern Leyte');
      setIssuingAuthority(documentToEdit.issuingAuthority || 'Sangguniang Bayan of Hinunangan, Southern Leyte');
      setAuthor(documentToEdit.author || '');
      setSignatory(documentToEdit.signatory || '');
      setSignatoryTitle(documentToEdit.signatoryTitle || '');
      setDateEnacted(documentToEdit.dateEnacted || '');
      setEffectiveDate(documentToEdit.effectiveDate || '');
      setShortSummary(documentToEdit.shortSummary || '');
      setLegalBasisText((documentToEdit.legalBasis || []).join('\n'));
      setDocumentStatus(documentToEdit.status || 'for_verification');
      setSourceCompleteness(documentToEdit.sourceCompleteness || 'metadata_only');
      setArticles(documentToEdit.articles || []);
      setKeyArticles(documentToEdit.keyArticles || []);
      setSetbackRules(documentToEdit.setbackRules || []);
      setPenalties(documentToEdit.penalties || []);
      setChangeSummary('');
    } else {
      // Defaults for new document
      const newId = `doc-${Date.now()}`;
      setId(newId);
      setType('municipal_ordinance');
      setCategory('ordinance');
      setOfficialNumber('');
      setSeriesYear('');
      setTitle('');
      setKnownAs('');
      setJurisdiction('Municipality of Hinunangan, Southern Leyte');
      setIssuingAuthority('Sangguniang Bayan of Hinunangan, Southern Leyte');
      setAuthor('');
      setSignatory('');
      setSignatoryTitle('');
      setDateEnacted('');
      setEffectiveDate('');
      setShortSummary('');
      setLegalBasisText('');
      setArticles([]);
      setKeyArticles([]);
      setSetbackRules([]);
      setPenalties([]);
      setDocumentStatus('draft');
      setSourceCompleteness('metadata_only');
      setChangeSummary('');
    }
  }, [documentToEdit, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Article handlers
  const handleAddArticle = () => {
    const artNum = `ARTICLE ${articles.length + 1}`;
    const newArt: LegalArticle = {
      id: `art-${Date.now()}`,
      articleNumber: artNum,
      articleTitle: 'GENERAL PROVISIONS',
      sections: [
        {
          id: `sec-${Date.now()}`,
          sectionNumber: `SECTION ${articles.reduce((acc, a) => acc + a.sections.length, 0) + 1}`,
          sectionTitle: 'GENERAL PROVISION',
          content: '',
          mandateCategory: 'mandatory',
        },
      ],
    };
    setArticles([...articles, newArt]);
  };

  const handleRemoveArticle = (artIdx: number) => {
    setArticles(articles.filter((_, i) => i !== artIdx));
  };

  const handleAddSection = (artIdx: number) => {
    const updated = [...articles];
    const totalSecs = articles.reduce((acc, a) => acc + a.sections.length, 0);
    updated[artIdx].sections.push({
      id: `sec-${Date.now()}`,
      sectionNumber: `SECTION ${totalSecs + 1}`,
      sectionTitle: '',
      content: '',
      mandateCategory: 'mandatory',
    });
    setArticles(updated);
  };

  const handleRemoveSection = (artIdx: number, secIdx: number) => {
    const updated = [...articles];
    updated[artIdx].sections = updated[artIdx].sections.filter((_, i) => i !== secIdx);
    setArticles(updated);
  };

  const handleUpdateSection = (
    artIdx: number,
    secIdx: number,
    field: keyof LegalArticleSection,
    value: string
  ) => {
    const updated = [...articles];
    updated[artIdx].sections[secIdx] = {
      ...updated[artIdx].sections[secIdx],
      [field]: value,
    };
    setArticles(updated);
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !officialNumber.trim()) {
      alert('Please fill in both the Document Title and Official Number.');
      return;
    }
    if (documentStatus === 'verified' &&
        (sourceCompleteness === 'metadata_only' || !documentToEdit?.sourceDocuments?.some(attachment => attachment.storagePath))) {
      alert('Upload and review an original source attachment before marking this document verified.');
      return;
    }

    const legalBasisArray = legalBasisText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    // Auto-generate key articles from structured articles for backwards compatibility
    const compiledKeyArticles =
      articles.length > 0
        ? articles.flatMap(a =>
            a.sections.map(s => ({
              number: s.sectionNumber,
              heading: s.sectionTitle,
              text: s.content,
              mandateCategory: (s.mandateCategory as 'mandatory' | 'prohibitive' | 'advisory') || 'mandatory',
            }))
          )
        : keyArticles;

    const updatedDoc: ASFRegulatoryDocument = {
      ...(documentToEdit || {}),
      id,
      type,
      category: category as LegalDocumentCategory,
      title: title.trim(),
      knownAs: knownAs.trim() || undefined,
      officialNumber: officialNumber.trim(),
      seriesYear: seriesYear.trim(),
      jurisdiction: jurisdiction.trim(),
      issuingAuthority: issuingAuthority.trim(),
      author: author.trim() || undefined,
      signatory: signatory.trim(),
      signatoryTitle: signatoryTitle.trim(),
      dateEnacted: dateEnacted.trim() || undefined,
      effectiveDate: effectiveDate.trim() || dateEnacted.trim(),
      shortSummary: shortSummary.trim(),
      legalBasis: legalBasisArray,
      articles,
      keyArticles: compiledKeyArticles,
      setbackRules,
      penalties,
      status: documentStatus,
      sourceCompleteness,
    };

    try {
      await onSave(updatedDoc, changeSummary || (isEditMode ? 'Updated legal document contents' : 'Created legal document'));
      onClose();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to save legal document.');
    }
  };

  return (
    createPortal(<div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-stone-900/60 p-2 backdrop-blur-xs sm:p-4">
      <div role="dialog" aria-modal="true" className="flex max-h-[calc(100dvh-16px)] min-h-0 w-[calc(100vw-16px)] max-w-[900px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl animate-in fade-in-50 zoom-in-95 duration-200 sm:max-h-[calc(100dvh-32px)] sm:w-[calc(100vw-32px)]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-emerald-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-800/80 rounded-xl">
              <Scale className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">
                {isEditMode ? `Edit Legal Decree: ${officialNumber}` : 'Create New Legal Decree / Ordinance / Resolution'}
              </h3>
              <p className="text-xs text-emerald-300">
                Official Hinunangan Livestock & ASF Legal Decrees Management System
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-xl text-stone-300 hover:text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-stone-200 bg-stone-50 px-3 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition ${
              activeTab === 'details'
                ? 'border-emerald-600 text-emerald-900 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            1. Document Details & Enactment
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('articles')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition ${
              activeTab === 'articles'
                ? 'border-emerald-600 text-emerald-900 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            2. Articles & Sections ({articles.reduce((acc, a) => acc + a.sections.length, 0)})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('setbacks_penalties')}
            className={`px-4 py-3 text-xs font-bold border-b-2 transition ${
              activeTab === 'setbacks_penalties'
                ? 'border-emerald-600 text-emerald-900 bg-white'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
          >
            3. Setbacks & Penalties
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-6 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-6">
          {activeTab === 'details' && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">Document Type *</label>
                  <select
                    value={type}
                    onChange={e => {
                      const val = e.target.value;
                      setType(val);
                      if (val === 'resolution') setCategory('resolution');
                      else if (val === 'administrative_order' || val === 'legal_reference') setCategory('national_reference');
                      else if (val === 'municipal_eo') setCategory('executive_order');
                      else setCategory('ordinance');
                    }}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  >
                    <option value="municipal_ordinance">{translateInterfaceText("Municipal Ordinance")}</option>
                    <option value="resolution">Sangguniang Bayan Resolution</option>
                    <option value="provincial_ordinance">{translateInterfaceText("Provincial Ordinance")}</option>
                    <option value="administrative_order">DA Administrative Order</option>
                    <option value="municipal_eo">Municipal Executive Order</option>
                    <option value="memorandum">Memorandum Order</option>
                    <option value="republic_act">{translateInterfaceText("Republic Act")}</option>
                    <option value="proclamation">Presidential Proclamation</option>
                    <option value="department_order">{translateInterfaceText("Department Order")}</option>
                    <option value="legal_reference">Legal Reference</option>
                    <option value="other">{translateInterfaceText("Other Legal Document")}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-stone-700 mb-1">Official Number *</label>
                  <input
                    type="text"
                    required
                    value={officialNumber}
                    onChange={e => setOfficialNumber(e.target.value)}
                    placeholder="e.g. Municipal Ordinance No. 2025-59"
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-700 mb-1">Series Year *</label>
                  <input
                    type="text"
                    required
                    value={seriesYear}
                    onChange={e => setSeriesYear(e.target.value)}
                    placeholder="e.g. Series of 2025"
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Official Title *</label>
                <textarea
                  required
                  rows={2}
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Full statutory title..."
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600 font-sans"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">Verification Status</label>
                  <select
                    value={documentStatus}
                    onChange={e => setDocumentStatus(e.target.value as LegalDocumentStatus)}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl"
                  >
                    <option value="draft">Draft</option>
                    <option value="for_verification">For Verification</option>
                    <option value="verified">Verified</option>
                    <option value="superseded">Superseded</option>
                    <option value="archived">Archived</option>
                    <option value="repealed">Repealed</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-stone-700 mb-1">Source Completeness</label>
                  <select
                    value={sourceCompleteness}
                    onChange={e => setSourceCompleteness(e.target.value as 'complete' | 'excerpt' | 'metadata_only')}
                    className="w-full px-3 py-2 bg-stone-50 border border-stone-300 rounded-xl"
                  >
                    <option value="metadata_only">Original content not provided</option>
                    <option value="excerpt">Incomplete excerpt / reference pages</option>
                    <option value="complete">Complete source document</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">Short Title / Known As</label>
                  <input
                    type="text"
                    value={knownAs}
                    onChange={e => setKnownAs(e.target.value)}
                    placeholder="e.g. Piggery and Poultry Regulation Ordinance"
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-700 mb-1"><InterfaceText source="Author / Sponsor" /></label>
                  <input
                    type="text"
                    value={author}
                    onChange={e => setAuthor(e.target.value)}
                    placeholder={translateInterfaceText("e.g. Hon. Gezar S. Ngoho")}
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1">Signatory / Approver</label>
                  <input
                    type="text"
                    value={signatory}
                    onChange={e => setSignatory(e.target.value)}
                    placeholder="e.g. Hon. Reynaldo C. Fontenilla"
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-700 mb-1">Signatory Title</label>
                  <input
                    type="text"
                    value={signatoryTitle}
                    onChange={e => setSignatoryTitle(e.target.value)}
                    placeholder="e.g. Municipal Mayor"
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-stone-700 mb-1"><InterfaceText source="Date Enacted" /></label>
                  <input
                    type="text"
                    value={dateEnacted}
                    onChange={e => setDateEnacted(e.target.value)}
                    placeholder="e.g. March 3, 2025"
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>

                <div>
                  <label className="block font-bold text-stone-700 mb-1">Effective Date</label>
                  <input
                    type="text"
                    value={effectiveDate}
                    onChange={e => setEffectiveDate(e.target.value)}
                    placeholder="e.g. March 18, 2025"
                    className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Executive Summary</label>
                <textarea
                  rows={2}
                  value={shortSummary}
                  onChange={e => setShortSummary(e.target.value)}
                  placeholder="Key summary of what this document regulates..."
                  className="w-full px-3 py-2 border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Statutory Legal Basis (one per line)</label>
                <textarea
                  rows={3}
                  value={legalBasisText}
                  onChange={e => setLegalBasisText(e.target.value)}
                  placeholder="Republic Act No. 7160..."
                  className="w-full px-3 py-2 font-mono text-[11px] border border-stone-300 rounded-xl focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {isEditMode && (
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                  <label className="block font-bold text-amber-900 mb-1">
                    Version Change Summary (Audit Trail Note)
                  </label>
                  <input
                    type="text"
                    value={changeSummary}
                    onChange={e => setChangeSummary(e.target.value)}
                    placeholder="Describe changes made in this version..."
                    className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg text-xs"
                  />
                </div>
              )}
            </div>
          )}

          {activeTab === 'articles' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <p className="text-xs text-stone-500">
                  Manage official Articles and Sections for this legal decree.
                </p>
                <button
                  type="button"
                  onClick={handleAddArticle}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Article
                </button>
              </div>

              {articles.map((art, artIdx) => (
                <div
                  key={art.id || artIdx}
                  className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-4"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-1 min-w-64">
                      <input
                        type="text"
                        value={art.articleNumber}
                        onChange={e => {
                          const updated = [...articles];
                          updated[artIdx].articleNumber = e.target.value;
                          setArticles(updated);
                        }}
                        className="w-36 px-2.5 py-1.5 font-bold text-xs bg-white border border-stone-300 rounded-lg"
                        placeholder="ARTICLE I"
                      />
                      <input
                        type="text"
                        value={art.articleTitle}
                        onChange={e => {
                          const updated = [...articles];
                          updated[artIdx].articleTitle = e.target.value;
                          setArticles(updated);
                        }}
                        className="flex-1 px-2.5 py-1.5 font-bold text-xs bg-white border border-stone-300 rounded-lg"
                        placeholder="TITLE AND OBJECTIVES"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleAddSection(artIdx)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-stone-100 border border-stone-300 text-stone-700 rounded-lg text-[11px] font-semibold transition"
                      >
                        <Plus className="w-3 h-3 text-emerald-600" /><InterfaceText source="Add Section" /></button>
                      <button
                        type="button"
                        onClick={() => handleRemoveArticle(artIdx)}
                        className="p-1.5 text-stone-400 hover:text-red-600 transition"
                        title="Delete Article"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Sections List */}
                  <div className="space-y-3 pl-2 border-l-2 border-emerald-500/30">
                    {art.sections.map((sec, secIdx) => (
                      <div
                        key={sec.id || secIdx}
                        className="bg-white p-3 rounded-xl border border-stone-200 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1">
                            <input
                              type="text"
                              value={sec.sectionNumber}
                              onChange={e =>
                                handleUpdateSection(artIdx, secIdx, 'sectionNumber', e.target.value)
                              }
                              className="w-28 px-2 py-1 font-bold bg-stone-50 border border-stone-300 rounded text-[11px]"
                              placeholder="SECTION 1"
                            />
                            <input
                              type="text"
                              value={sec.sectionTitle}
                              onChange={e =>
                                handleUpdateSection(artIdx, secIdx, 'sectionTitle', e.target.value)
                              }
                              className="flex-1 px-2 py-1 font-semibold bg-stone-50 border border-stone-300 rounded text-[11px]"
                              placeholder="SECTION TITLE"
                            />
                          </div>

                          <select
                            value={sec.mandateCategory || 'mandatory'}
                            onChange={e =>
                              handleUpdateSection(artIdx, secIdx, 'mandateCategory', e.target.value)
                            }
                            className="text-[10px] px-2 py-1 bg-stone-50 border border-stone-300 rounded font-semibold text-stone-700"
                          >
                            <option value="mandatory">{translateInterfaceText("Mandatory")}</option>
                            <option value="prohibitive">Prohibitive</option>
                            <option value="advisory">{translateInterfaceText("Advisory")}</option>
                            <option value="penal">Penal</option>
                          </select>

                          <button
                            type="button"
                            onClick={() => handleRemoveSection(artIdx, secIdx)}
                            className="p-1 text-stone-400 hover:text-red-600 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <textarea
                          rows={2}
                          value={sec.content}
                          onChange={e =>
                            handleUpdateSection(artIdx, secIdx, 'content', e.target.value)
                          }
                          placeholder="Statutory provision text..."
                          className="w-full px-2.5 py-1.5 border border-stone-200 rounded-lg focus:ring-1 focus:ring-emerald-600 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'setbacks_penalties' && (
            <div className="space-y-6 text-xs">
              {/* Setbacks */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-stone-900 uppercase">Setback Buffer Clearances</h4>
                  <button
                    type="button"
                    onClick={() =>
                      setSetbackRules([
                        ...setbackRules,
                        {
                          target: 'Buffer Target Area',
                          minimumDistance: 50,
                          statutoryBasis: 'Section 9',
                          rationale: 'Environmental Buffer',
                        },
                      ])
                    }
                    className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Setback Rule
                  </button>
                </div>

                <div className="space-y-2">
                  {setbackRules.map((rule, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-2.5 bg-stone-50 rounded-xl border border-stone-200 items-center"
                    >
                      <input
                        type="text"
                        value={rule.target}
                        onChange={e => {
                          const updated = [...setbackRules];
                          updated[idx].target = e.target.value;
                          setSetbackRules(updated);
                        }}
                        className="sm:col-span-5 px-2 py-1 bg-white border border-stone-300 rounded font-semibold text-xs"
                        placeholder="Target area..."
                      />
                      <input
                        type="number"
                        value={rule.minimumDistance}
                        onChange={e => {
                          const updated = [...setbackRules];
                          updated[idx].minimumDistance = Number(e.target.value);
                          setSetbackRules(updated);
                        }}
                        className="sm:col-span-2 px-2 py-1 bg-white border border-stone-300 rounded font-mono font-bold text-xs"
                        placeholder={translateInterfaceText("Meters")}
                      />
                      <input
                        type="text"
                        value={rule.statutoryBasis}
                        onChange={e => {
                          const updated = [...setbackRules];
                          updated[idx].statutoryBasis = e.target.value;
                          setSetbackRules(updated);
                        }}
                        className="sm:col-span-4 px-2 py-1 bg-white border border-stone-300 rounded text-[11px]"
                        placeholder="Statutory Basis"
                      />
                      <button
                        type="button"
                        onClick={() => setSetbackRules(setbackRules.filter((_, i) => i !== idx))}
                        className="sm:col-span-1 p-1 text-stone-400 hover:text-red-600 justify-self-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Penalties */}
              <div className="space-y-3 pt-4 border-t border-stone-200">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-stone-900 uppercase">Penal Provisions & Sanctions</h4>
                  <button
                    type="button"
                    onClick={() =>
                      setPenalties([
                        ...penalties,
                        {
                          offenseTier: 'Additional Offense',
                          finePhp: 1000,
                          punitiveActions: 'Administrative fine and suspension',
                        },
                      ])
                    }
                    className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Penalty Tier
                  </button>
                </div>

                <div className="space-y-2">
                  {penalties.map((pen, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-2.5 bg-stone-50 rounded-xl border border-stone-200 items-center"
                    >
                      <input
                        type="text"
                        value={pen.offenseTier}
                        onChange={e => {
                          const updated = [...penalties];
                          updated[idx].offenseTier = e.target.value;
                          setPenalties(updated);
                        }}
                        className="sm:col-span-3 px-2 py-1 bg-white border border-stone-300 rounded font-bold text-xs"
                        placeholder="First Offense..."
                      />
                      <input
                        type="number"
                        value={pen.finePhp}
                        onChange={e => {
                          const updated = [...penalties];
                          updated[idx].finePhp = Number(e.target.value);
                          setPenalties(updated);
                        }}
                        className="sm:col-span-2 px-2 py-1 bg-white border border-stone-300 rounded font-mono font-bold text-xs"
                        placeholder="Fine PHP"
                      />
                      <input
                        type="text"
                        value={pen.punitiveActions}
                        onChange={e => {
                          const updated = [...penalties];
                          updated[idx].punitiveActions = e.target.value;
                          setPenalties(updated);
                        }}
                        className="sm:col-span-6 px-2 py-1 bg-white border border-stone-300 rounded text-[11px]"
                        placeholder="Administrative sanctions..."
                      />
                      <button
                        type="button"
                        onClick={() => setPenalties(penalties.filter((_, i) => i !== idx))}
                        className="sm:col-span-1 p-1 text-stone-400 hover:text-red-600 justify-self-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Modal Action Buttons */}
          <div className="sticky bottom-0 -mx-3 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:gap-3 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-stone-600 hover:text-stone-800 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
            ><InterfaceText source="Cancel" /></button>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition"
            >
              <Save className="w-4 h-4" /> {isEditMode ? 'Save & Enact Changes' : 'Create & Enact Document'}
            </button>
          </div>
        </form>
      </div>
    </div>, document.body)
  );
};
