import React, {lazy, Suspense, useEffect} from 'react';
import {createPortal} from 'react-dom';
import {Building2, X} from 'lucide-react';
import {InterfaceText} from '../../i18n/interfaceText';
import type {Barangay, SwineRecord, UserAccount} from '../../types';
const SwineForm = lazy(() => import('../registry/SwineForm').then(module => ({default: module.SwineForm})));

interface SwineFarmRegistrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  barangays: Barangay[];
  currentUser: UserAccount | null;
  onOpenBatchModal: () => void;
  onFarmRegistered?: (record: SwineRecord) => void;
}

/** Dashboard registration uses the same validated, persisted form as the registry. */
export const SwineFarmRegistrationModal: React.FC<SwineFarmRegistrationModalProps> = ({
  isOpen, onClose, barangays, currentUser, onOpenBatchModal, onFarmRegistered,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  if (!isOpen || !currentUser || currentUser.role === 'agent') return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-stone-950/70 p-2 backdrop-blur-xs animate-fadeIn sm:p-4">
      <div role="dialog" aria-modal="true" aria-label="Swine Farm Registration" className="flex max-h-[calc(100dvh-16px)] min-h-0 w-[calc(100vw-16px)] max-w-2xl flex-col overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-32px)] sm:w-[calc(100vw-32px)]">
        <div className="flex shrink-0 items-center justify-between gap-2 bg-gradient-to-r from-emerald-900 via-teal-900 to-emerald-950 px-3 py-3 text-white sm:gap-3 sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/20 p-2 text-emerald-300"><Building2 className="h-6 w-6" /></div>
            <div className="min-w-0">
              <h2 className="text-base font-black tracking-tight text-white sm:text-xl"><InterfaceText source="Swine Farm Registration" /></h2>
              <p className="text-xs text-emerald-200">DA Hinunangan Municipal Swine Registry &amp; Biosecurity Form</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close swine farm registration" className="cursor-pointer rounded-full p-1.5 text-emerald-200 transition hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-6">
          <Suspense fallback={<p role="status">Loading registration…</p>}>
          <SwineForm barangays={barangays} currentUser={currentUser} onCancel={onClose}
            onOpenBatchModal={() => { onClose(); onOpenBatchModal(); }}
            onSuccess={record => { onFarmRegistered?.(record); onClose(); }} />
          </Suspense>
        </div>
      </div>
    </div>, document.body,
  );
};
