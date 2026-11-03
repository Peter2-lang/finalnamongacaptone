import { supabase } from '../lib/supabase.ts';

/** Authenticated JSON transport. Rejects HTTP errors and SPA/invalid responses. */
export async function requestJson<T>(url: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (authenticated) {
    if (!supabase) throw new Error('Supabase Auth is not configured.');
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error('Please sign in again to continue.');
    headers.set('Authorization', `Bearer ${data.session.access_token}`);
  }
  const response = await fetch(url, { ...init, headers });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object' || ('success' in body && body.success === false)) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Request failed (${response.status}). Please try again.`;
    throw new Error(message);
  }
  return body as T;
}
