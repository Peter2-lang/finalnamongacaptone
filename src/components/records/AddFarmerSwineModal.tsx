import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import type { Barangay, FarmerSelection, SwineRecord, UserAccount } from '../../types';
import { hasValidGisLocation } from '../../utils/gisLocation';
import { MAX_FARMER_SWINE_BATCH, type FarmerSwineBatch, type FarmerSwineDraft } from '../../utils/farmerSwineRegistration';
import { loadRegistrationFarmer, prepareFarmerSwineUploads, submitFarmerSwine, UnconfirmedFarmerSwineSave } from '../../services/farmerSwineApi';
import { offlineSyncEngine } from '../../services/offlineSyncEngine';
import { storageService } from '../../services/storageService';
import { SwineForm } from '../registry/SwineForm';

interface Props {
  source: SwineRecord;
  barangays: Barangay[];
  user: UserAccount;
  onClose: () => void;
  onSaved: (count: number, pending: boolean) => void;
}

export function AddFarmerSwineModal({ source, barangays, user, onClose, onSaved }: Props) {
  const farmerId = source.farmerId!;
  const owner = user.authUserId || user.id;
  const [farmer, setFarmer] = useState<FarmerSelection | null>(null);
  const [entries, setEntries] = useState(() => [crypto.randomUUID()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [offlineProfile, setOfflineProfile] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dirty = useRef(false);
  const submitting = useRef(false);
  const forms = useRef(new Map<string, HTMLFormElement>());
  const collected = useRef(new Map<string, FarmerSwineDraft>());
  const unconfirmed = useRef<FarmerSwineBatch | null>(null);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const useCachedProfile = () => {
      setOfflineProfile(true);
      setFarmer({
        id: farmerId,
        farmerName: source.farmerName,
        farmerContact: source.farmerContact,
        farmerAddress: source.farmerAddress,
        farmName: source.farmName,
        barangay: source.barangay,
      });
    };
    if (storageService.isEffectiveOffline()) {
      useCachedProfile();
      setLoading(false);
    } else {
      loadRegistrationFarmer(farmerId, AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]))
        .then(result => { if (!controller.signal.aborted) setFarmer(result); })
        .catch(error => {
          if (controller.signal.aborted) return;
          if (storageService.isEffectiveOffline()) useCachedProfile();
          else setError(error.message);
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [farmerId, source]);

  const close = () => {
    if (submitting.current) return;
    if (dirty.current) setDiscard(true);
    else onClose();
  };

  const save = async () => {
    if (submitting.current || !farmer) return;
    setError('');
    let batch = unconfirmed.current;
    if (!batch) {
      collected.current.clear();
      for (const id of entries) forms.current.get(id)?.requestSubmit();
      const invalid = entries.flatMap((id, index) => collected.current.has(id) ? [] : [index + 1]);
      if (invalid.length) {
        setError(`Review the highlighted fields for swine ${invalid.join(', ')}.`);
        return;
      }
      batch = { farmerId, batchId: crypto.randomUUID(), drafts: Array.from(collected.current.values()) };
    }

    submitting.current = true;
    setSaving(true);
    try {
      const currentUser = storageService.getCurrentUser();
      if ((currentUser?.authUserId || currentUser?.id) !== owner) throw new Error('The registry session changed during registration.');
      if (!storageService.isEffectiveOffline() && !unconfirmed.current) {
        try {
          await prepareFarmerSwineUploads(batch);
          const count = await submitFarmerSwine(batch);
          onSaved(count, false);
          return;
        } catch (error) {
          if (!(error instanceof UnconfirmedFarmerSwineSave) && !storageService.isEffectiveOffline()) throw error;
          unconfirmed.current = batch;
        }
      }
      await offlineSyncEngine.queueFarmerSwineBatch(batch, owner);
      onSaved(batch.drafts.length, true);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby="add-farmer-swine-title"
      onCancel={event => { event.preventDefault(); close(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-[900px] overflow-hidden rounded-2xl bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/60">
      <div className="flex max-h-[90dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-6">
          <div>
            <h2 id="add-farmer-swine-title" className="text-lg font-black text-emerald-950">Add Swine to Existing Farmer</h2>
            <p className="text-sm text-stone-600">{farmer?.farmerName || source.farmerName}</p>
          </div>
          <button type="button" aria-label="Close" onClick={close} disabled={saving}
            className="rounded-lg p-2 hover:bg-stone-100 disabled:opacity-50"><X size={20} /></button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain bg-stone-50 p-3 sm:p-5"
          onChange={() => { dirty.current = true; }}>
          {loading && <p role="status" className="flex items-center gap-2 p-3"><Loader2 className="animate-spin" size={16} /> Loading farmer profile…</p>}
          {farmer && (
            <>
              {offlineProfile && <p className="mb-2 text-xs text-amber-800">Showing the farmer information saved on this device.</p>}
              <dl className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['Farmer Name', farmer.farmerName], ['Farmer ID', farmer.id],
                  ['Contact Number', farmer.farmerContact], ['Barangay', farmer.barangay],
                  ['Farm Name', farmer.farmName], ['Farm Location', farmer.farmerAddress],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs font-bold text-stone-600">{label}</dt>
                    <dd className="break-words">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
              {entries.map((id, index) => (
                <fieldset key={id} disabled={saving || discard || Boolean(unconfirmed.current)} className="mt-4 min-w-0 rounded-xl border border-stone-200">
                  <legend className="ml-3 px-2 text-sm font-bold text-emerald-950">Swine {index + 1}</legend>
                  {entries.length > 1 && (
                    <button type="button" className="ml-4 mt-2 rounded-lg px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                      onClick={() => { dirty.current = true; setEntries(items => items.filter(item => item !== id)); }}>
                      Remove swine {index + 1}
                    </button>
                  )}
                  <SwineForm barangays={barangays} currentUser={user} initialFarmer={farmer}
                    initialCoordinates={hasValidGisLocation(source) && source.barangay === farmer.barangay ? source : null}
                    onSuccess={() => {}} onOpenBatchModal={() => {}}
                    batchFormRef={form => { if (form) forms.current.set(id, form); else forms.current.delete(id); }}
                    onDraftChange={() => { dirty.current = true; }}
                    onCollectDraft={draft => collected.current.set(id, draft)} />
                </fieldset>
              ))}
            </>
          )}
        </div>

        <footer className="shrink-0 border-t border-stone-200 px-4 py-3 sm:px-6">
          {error && <p role="alert" className="mb-2 text-sm font-semibold text-red-700">{error}</p>}
          {discard ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p>Discard unsaved changes?</p>
              <div className="flex gap-2">
                <button type="button" className="rounded-lg border px-3 py-2" onClick={() => setDiscard(false)}>Keep editing</button>
                <button type="button" className="rounded-lg bg-red-700 px-3 py-2 font-bold text-white" onClick={onClose}>Discard changes</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" disabled={saving || !farmer || Boolean(unconfirmed.current) || entries.length >= MAX_FARMER_SWINE_BATCH}
                onClick={() => { dirty.current = true; setEntries(items => [...items, crypto.randomUUID()]); }}
                className="mr-auto flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
                <Plus size={16} /> Add Another Swine
              </button>
              <button type="button" disabled={saving} onClick={close} className="rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-50">Cancel</button>
              <button type="button" disabled={saving || !farmer} onClick={() => void save()}
                className="flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                {saving && <Loader2 className="animate-spin" size={15} />}
                {saving ? 'Saving…' : 'Save Swine'}
              </button>
            </div>
          )}
        </footer>
      </div>
    </dialog>
  );
}
