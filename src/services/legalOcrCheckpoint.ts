// Browser-local page checkpoints: reselecting the identical upload safely resumes OCR.
// No server worker or provider credentials are required. Clear site data to remove drafts.
export interface OcrCheckpoint { text: string; confidence: number }
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('legal-ocr-checkpoints-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pages');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function imageKey(image: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(image));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export async function readCheckpoint(key: string): Promise<OcrCheckpoint | undefined> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('pages').objectStore('pages').get(key);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
export async function writeCheckpoint(key: string, value: OcrCheckpoint): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pages', 'readwrite'); tx.objectStore('pages').put(value, key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}

export async function saveReviewDraft(owner: string, items: unknown): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pages', 'readwrite');
    tx.objectStore('pages').put(items, `review:${owner}`);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function loadReviewDraft(owner: string): Promise<unknown> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('pages').objectStore('pages').get(`review:${owner}`);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
