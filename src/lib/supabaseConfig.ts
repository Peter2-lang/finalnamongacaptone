/** Metadata inspection only: signature verification remains Supabase Auth's job. */
export function supabaseKeyMetadata(key: string | undefined): { privileged: boolean; projectRef?: string } {
  if (!key) return { privileged: false };
  if (key.startsWith('sb_secret_')) return { privileged: true };
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
    return { privileged: payload.role === 'service_role', projectRef: typeof payload.ref === 'string' ? payload.ref : undefined };
  } catch { return { privileged: false }; }
}

export function validateBrowserSupabaseConfig(env: Record<string, string | undefined>): void {
  for (const name of ['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY']) {
    const metadata = supabaseKeyMetadata(env[name]);
    if (metadata.privileged) throw new Error(`${name} must never contain a privileged Supabase key.`);
    if (metadata.projectRef && env.VITE_SUPABASE_URL && new URL(env.VITE_SUPABASE_URL).hostname !== `${metadata.projectRef}.supabase.co`) {
      throw new Error(`${name} and VITE_SUPABASE_URL belong to different Supabase projects.`);
    }
  }
  if (env.SUPABASE_URL && env.VITE_SUPABASE_URL && new URL(env.SUPABASE_URL).origin !== new URL(env.VITE_SUPABASE_URL).origin) {
    throw new Error('SUPABASE_URL and VITE_SUPABASE_URL must match.');
  }
}
