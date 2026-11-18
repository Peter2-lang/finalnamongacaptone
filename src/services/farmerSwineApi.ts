import type { FarmerSelection } from '../types.ts';
import type { FarmerSwineBatch } from '../utils/farmerSwineRegistration.ts';
import { storageService } from './storageService';
import { uploadSwineDocument, uploadSwineImage } from './supabaseStorageService';

export function farmerSwineHeaders(): Record<string, string> {
  const token = storageService.getSessionToken();
  return token ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } : { 'Content-Type': 'application/json' };
}

function endpoint(farmerId: string) {
  return `/api/farmers/${encodeURIComponent(farmerId)}/swine-registration`;
}

export async function loadRegistrationFarmer(farmerId: string, signal: AbortSignal): Promise<FarmerSelection> {
  const response = await fetch(endpoint(farmerId), { headers: farmerSwineHeaders(), signal, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok || !result.success || result.data?.id !== farmerId) {
    throw new Error(result.error || 'Unable to load the farmer profile.');
  }
  return result.data;
}

export async function prepareFarmerSwineUploads(
  batch: FarmerSwineBatch,
  checkpoint: () => Promise<unknown> = async () => {},
) {
  for (const draft of batch.drafts) {
    const { record } = draft;
    if (draft.photo) {
      record.photoUrl = (await uploadSwineImage(draft.photo, record.barangay, record.id)).url;
      draft.photo = undefined;
      await checkpoint();
    }
    while (draft.attachments.length) {
      const { id, key, type, file } = draft.attachments[0];
      const uploaded = type === 'file'
        ? await uploadSwineDocument(file, record.barangay, record.id)
        : await uploadSwineImage(file, record.barangay, record.id, id);
      record.customFields = { ...record.customFields, [id]: uploaded, [key]: uploaded };
      draft.attachments.shift();
      await checkpoint();
    }
  }
}

export class UnconfirmedFarmerSwineSave extends Error {}

export async function submitFarmerSwine(batch: FarmerSwineBatch, headers = farmerSwineHeaders()) {
  const response = await fetch(endpoint(batch.farmerId), {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({ batchId: batch.batchId, records: batch.drafts.map(({ record }) => record) }),
  }).catch(() => { throw new UnconfirmedFarmerSwineSave('The connection was lost before the registry confirmed the save.'); });
  const result = await response.json().catch(() => null);
  if (response.status >= 500 || (response.ok && (!result?.success || result.count !== batch.drafts.length))) {
    throw new UnconfirmedFarmerSwineSave(result?.error || 'The registry could not confirm the save.');
  }
  if (!response.ok) throw new Error(result?.error || 'Unable to register the swine batch.');
  return result.count as number;
}
