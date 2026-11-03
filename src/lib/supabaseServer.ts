import { createClient, SupabaseClient } from '@supabase/supabase-js';

const serverUrl = process.env.SUPABASE_URL?.trim();
const url = serverUrl || process.env.VITE_SUPABASE_URL?.trim();
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.SUPABASE_ANON_KEY?.trim() ||
  process.env.VITE_SUPABASE_ANON_KEY?.trim();
const adminKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export const supabaseAuthProjectRef = (() => {
  try {
    return url ? new URL(url).hostname.split('.')[0] : null;
  } catch {
    return null;
  }
})();

export function getSupabaseAuthConfigStatus() {
  return {
    hasUrl: Boolean(url),
    hasPublishableKey: Boolean(publishableKey),
    projectRef: supabaseAuthProjectRef,
  };
}

export function getSupabaseAdminConfigError(): string | null {
  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL (or VITE_SUPABASE_URL)');
  if (!adminKey) missing.push('SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)');
  return missing.length > 0
    ? `Supabase Auth administration is unavailable. Configure ${missing.join(' and ')} as server-side environment variables.`
    : null;
}

export const supabaseAuthClient: SupabaseClient | null = url && publishableKey
  ? createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export const supabaseAdminClient: SupabaseClient | null = url && adminKey
  ? createClient(url, adminKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    })
  : null;
