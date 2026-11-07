import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  detail?: React.ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<boolean | void> | boolean | void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'warning',
  detail,
  onClose,
  onConfirm,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isBusyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusyRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => cancelRef.current?.focus());
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const completed = await onConfirm();
      if (completed !== false) onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The requested action could not be completed.');
    } finally {
      isBusyRef.current = false;
      setIsBusy(false);
    }
  };

  const isDanger = variant === 'danger';

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center overflow-y-auto bg-stone-950/65 p-3 backdrop-blur-xs sm:p-4">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="my-auto flex max-h-[calc(100dvh-24px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-32px)]"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              isDanger ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
            }`}>
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="confirm-dialog-title" className="text-sm font-black text-stone-900">{title}</h2>
              <p id="confirm-dialog-message" className="mt-1 text-xs leading-relaxed text-stone-600">{message}</p>
            </div>
          </div>
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            aria-label="Close dialog"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-200 hover:text-stone-900 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {(detail || errorMessage) && (
          <div className="min-h-0 overflow-y-auto px-4 py-4 text-sm text-stone-700 sm:px-5">
            {detail}
            {errorMessage && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">{errorMessage}</p>}
          </div>
        )}
        <div className="sticky bottom-0 flex shrink-0 flex-wrap justify-end gap-2 border-t border-stone-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <button
            ref={cancelRef}
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="min-h-11 rounded-xl border border-stone-300 bg-white px-4 text-xs font-bold text-stone-700 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-50"
          >{cancelLabel}</button>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void handleConfirm()}
            className={`min-h-11 rounded-xl px-4 text-xs font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-50 ${
              isDanger
                ? 'bg-red-700 hover:bg-red-800 focus-visible:outline-red-700'
                : 'bg-emerald-700 hover:bg-emerald-800 focus-visible:outline-emerald-700'
            }`}
          >{isBusy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
};
