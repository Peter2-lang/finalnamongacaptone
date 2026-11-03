import { supabaseKeyMetadata, validateBrowserSupabaseConfig } from './supabaseConfig.ts';
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

function safeCreateClient(key: string | undefined): SupabaseClient | null {
  if (!url || !key) return null;
  try {
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  } catch {
    console.error('[CONFIG] invalid_supabase_client_configuration');
    return null;
  }
}

export const supabaseAuthClient = safeCreateClient(publishableKey);

export const supabaseAdminClient = safeCreateClient(adminKey);

export function getSupabaseProjectConfigurationError(): string | null {
  try {
    const metadata = supabaseKeyMetadata(publishableKey);
    if (metadata.privileged) return 'invalid_publishable_key';
    if (metadata.projectRef && metadata.projectRef !== supabaseAuthProjectRef) return 'project_mismatch';
    const urls = [serverUrl, process.env.VITE_SUPABASE_URL?.trim()].filter(Boolean);
    if (urls.some(value => new URL(value!).protocol !== 'https:')) return 'invalid_supabase_url';
    if (urls.length === 2 && new URL(urls[0]!).origin !== new URL(urls[1]!).origin) return 'project_mismatch';
    validateBrowserSupabaseConfig(process.env);
    if (!supabaseAuthClient || !supabaseAdminClient || !process.env.VITE_SUPABASE_URL?.trim() ||
        !(process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim())) return 'auth_not_configured';
    return null;
  } catch { return 'invalid_supabase_url'; }
}
