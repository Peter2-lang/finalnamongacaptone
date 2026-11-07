import { LocalizedFeedback } from '../../i18n/LocalizedFeedback';
import { InterfaceText } from '../../i18n/interfaceText';
import React, { useEffect, useRef, useState } from 'react';
import { Database, Download, Upload, RefreshCw, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { storageService } from '../../services/storageService';
import { ConfirmDialog } from './ConfirmDialog';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataRestored: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({ isOpen, onClose, onDataRestored }) => {
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', handleEscape);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleExportJson = () => {
    const backup = storageService.exportFullBackup();
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `DA_Hinunangan_Backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSuccessMessage('Full database exported successfully!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        const success = storageService.restoreFullBackup(parsed);
        if (success) {
          setSuccessMessage('Database restored successfully from file!');
          onDataRestored();
          setTimeout(() => {
            setSuccessMessage(null);
            onClose();
          }, 1500);
        } else {
          setErrorMessage('Invalid backup file structure.');
        }
      } catch (err) {
        setErrorMessage('Failed to read JSON backup file.');
      }
    };
    reader.readAsText(file);
  };

  const handleResetDefaults = () => {
    setConfirmReset(true);
  };

  const confirmResetDefaults = async () => {
    setIsResetting(true);
    try {
      storageService.resetToDefaults();
      setSuccessMessage('System restored to clean Hinunangan demo state!');
      onDataRestored();
      setTimeout(() => {
        setSuccessMessage(null);
        onClose();
      }, 1500);
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to reset local records.');
      return false;
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="backup-modal-title" className="my-auto flex max-h-[calc(100dvh-16px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-32px)]">
        {/* Header */}
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between bg-stone-900 p-5 text-white">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 id="backup-modal-title" className="font-bold text-sm">Offline Database Backup & Restore</h3>
              <p className="text-[11px] text-stone-400">Manage local storage, offline data export & resets</p>
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close backup and restore" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-stone-400 hover:bg-white/10 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4 text-xs sm:p-6">
          {successMessage && (
            <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>{<LocalizedFeedback value={successMessage} />}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 bg-red-50 text-red-800 border border-red-200 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span>{<LocalizedFeedback value={errorMessage} />}</span>
            </div>
          )}

          {/* Export */}
          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
            <div>
              <span className="font-bold text-stone-900 block text-xs">Export Complete System Snapshot</span>
              <p className="text-stone-500 text-[11px]">Download all swine, farmers, barangays, accounts, and logs as JSON.</p>
            </div>
            <button
              onClick={handleExportJson}
              className="bg-white hover:bg-stone-100 text-emerald-800 border border-emerald-400 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" /> Export JSON
            </button>
          </div>

          {/* Import */}
          <div className="p-4 rounded-xl border border-stone-200 bg-stone-50 flex items-center justify-between gap-3">
            <div>
              <span className="font-bold text-stone-900 block text-xs">Restore From JSON File</span>
              <p className="text-stone-500 text-[11px]">Upload a previously saved database file.</p>
            </div>
            <label className="bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer transition">
              <Upload className="w-3.5 h-3.5" /><InterfaceText source="Restore" /><input type="file" accept=".json,application/json" onChange={handleImportJson} className="hidden" />
            </label>
          </div>

          {/* Reset */}
          <div className="p-4 rounded-xl border border-red-200 bg-red-50/50 flex items-center justify-between gap-3">
            <div>
              <span className="font-bold text-red-900 block text-xs">Reset Capstone Demonstration Data</span>
              <p className="text-red-700/80 text-[11px]">Restore standard Hinunangan initial data set.</p>
            </div>
            <button
              onClick={handleResetDefaults}
              className="bg-white hover:bg-red-50 text-red-700 border border-red-300 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reset All
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 shrink-0 bg-stone-50 p-4 border-t border-stone-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-stone-300 hover:bg-stone-100 text-stone-700 font-semibold text-xs cursor-pointer"
          ><InterfaceText source="Close" /></button>
        </div>
      </div>
    </div>
    <ConfirmDialog
      open={confirmReset}
      title="Reset demonstration data?"
      message="This replaces local custom records with the initial Hinunangan demo dataset. This does not reset production database records."
      confirmLabel={isResetting ? 'Resetting…' : 'Reset Local Data'}
      variant="danger"
      onClose={() => setConfirmReset(false)}
      onConfirm={confirmResetDefaults}
    />
    </>
  );
};
