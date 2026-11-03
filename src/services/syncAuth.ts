/**
 * Resolve a current Supabase Auth session before any offline queue network call.
 * Never treat backend /api/health (a public endpoint) as proof of user sign-in.
 * Queue records stay in IndexedDB when authentication is missing or invalid.
 */
export interface SyncSession {
  access_token: string;
  expires_at?: number | null;
  user: { id: string };
}
export interface SyncAuthClient {
  getSession(): Promise<{ data: { session: SyncSession | null }; error: unknown }>;
  refreshSession(): Promise<{ data: { session: SyncSession | null }; error: unknown }>;
}

export async function getSyncSessionToken(
  auth: SyncAuthClient | null,
  profile: { authUserId?: string | null } | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!profile) throw new Error('Sign in to synchronize offline changes.');
  if (!auth) throw new Error('Supabase Auth is not configured. Synchronization is paused.');
  const { data, error } = await auth.getSession();
  if (error) throw new Error('Unable to check your sign-in session. Synchronization is paused; try again when online.');
  let session = data.session;
  if (!session) throw new Error('Your session has expired. Sign in again to synchronize saved offline changes.');
  if (session.expires_at && session.expires_at <= nowSeconds + 60) {
    const refreshed = await auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      throw new Error('Your session has expired. Sign in again to synchronize saved offline changes.');
    }
    session = refreshed.data.session;
  }
  // Do not upload another user's device-local queue while signed in as a
  // different profile. The server still enforces permissions on every call.
  if (!profile.authUserId || profile.authUserId !== session.user.id) {
    throw new Error('The signed-in account does not match the active registry profile. Sign in with the correct account before synchronizing.');
  }
  if (!session.access_token) throw new Error('Your session has expired. Sign in again to synchronize saved offline changes.');
  return session.access_token;
}
