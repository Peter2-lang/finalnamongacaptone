import {
  Barangay,
  CertificateTemplate,
  IssuedCertificate,
  MessageItem,
  RegistryFormSchema,
  SidebarTheme,
  SwineRecord,
  UserAccount,
} from '../types.ts';
import type { LandingCmsConfig } from '../types/landingCms.ts';
import { storageService } from './storageService.ts';
import { supabase, supabaseProjectRef } from '../lib/supabase.ts';

supabase?.auth.onAuthStateChange((_event, session) => {
  storageService.setSessionToken(session?.access_token || null);
});

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const user = storageService.getCurrentUser();
    const token = storageService.getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (user) {
      headers['x-user-role'] = user.role || 'focal';
      headers['x-user-id'] = user.id || '';
      headers['x-user-name'] = user.username || user.name || '';
      if (user.assignedBarangay) {
        headers['x-user-assigned-barangay'] = user.assignedBarangay;
      }
      if (user.barangay_id) {
        headers['x-user-barangay-id'] = user.barangay_id;
      }
    }
  } catch {
    // Non-browser or SSR fallback
  }

  return headers;
}

async function getFreshAuthHeaders(): Promise<Record<string, string>> {
  if (!supabase) throw new Error('Supabase Auth is unavailable. Please sign in again.');

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error('Unable to read your Supabase session. Please sign in again.');
  let session = data.session;
  if (!session) throw new Error('Your session has expired. Please sign in again.');

  if (session.expires_at && session.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      storageService.setSessionToken(null);
      throw new Error('Your session has expired. Please sign in again.');
    }
    session = refreshed.session;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(session.access_token);
  if (userError || !userData.user || userData.user.id !== session.user.id) {
    storageService.setSessionToken(null);
    throw new Error(userError?.status === 401
      ? 'Your session has expired. Please sign in again.'
      : 'Unable to verify your Supabase session. Please sign in again.');
  }

  storageService.setSessionToken(session.access_token);
  return { ...getAuthHeaders(), Authorization: `Bearer ${session.access_token}` };
}

async function loginAt(endpoint: string, identifier: string, password: string): Promise<{ user: UserAccount; role: string; assignedBarangay?: string; token: string }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: identifier, email: identifier, password, clientProjectRef: supabaseProjectRef }),
  });

  const data = await res.json().catch(() => ({ success: false, error: 'Network error or server unavailable.' }));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Invalid credentials or login failed.');
  }
  if (!data.token || typeof data.token !== 'string') {
    throw new Error('Authentication service returned no session token.');
  }
  if (!supabase || !data.refreshToken) {
    throw new Error('Supabase Auth client is not configured for session persistence.');
  }
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.token,
    refresh_token: data.refreshToken,
  });
  if (sessionError) throw sessionError;
  const { data: sessionData, error: sessionReadError } = await supabase.auth.getSession();
  const { data: userData, error: userReadError } = await supabase.auth.getUser();
  const session = sessionData.session;
  console.info('[AUTH] browser_login_session_check', {
    sessionExists: Boolean(session),
    userExists: Boolean(userData.user),
    userId: userData.user?.id || null,
  });
  if (sessionReadError || userReadError || !session || !userData.user || userData.user.id !== data.user.authUserId) {
    storageService.setSessionToken(null);
    throw new Error('Supabase Auth session was not persisted for the signed-in account.');
  }
  storageService.setSessionToken(session.access_token);
  try {
    await storageService.refreshRegistryFormSchemaFromCloud();
  } catch (error) {
    console.warn('[AUTH] post_login_schema_refresh_failed', {
      message: error instanceof Error ? error.message : 'Unknown schema refresh error',
      userId: userData.user.id,
    });
  }
  return { user: data.user, role: data.role, assignedBarangay: data.assignedBarangay, token: session.access_token };
}

export const authApi = {
  login(username: string, password: string) {
    return loginAt('/api/auth/login', username, password);
  },

  superAdminLogin(email: string, password: string) {
    return (async () => {
      if (!supabase) throw new Error('Supabase Auth client is not configured.');

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      const session = data.session;
      const authUser = data.user;
      console.info('[AUTH] browser_superadmin_login', {
        success: !error && Boolean(authUser),
        userId: authUser?.id || null,
        sessionExists: Boolean(session),
      });
      if (error || !authUser || !session) {
        throw new Error('Supabase Auth could not establish a session for these credentials.');
      }

      storageService.setSessionToken(session.access_token);
      const response = await fetch('/api/auth/superadmin-profile', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success || !result.data) {
        console.warn('[AUTH] browser_superadmin_profile_rejected', {
          userId: authUser.id,
          status: response.status,
          profileFound: Boolean(result?.data),
        });
        await supabase.auth.signOut();
        storageService.setSessionToken(null);
        throw new Error(result?.error || 'Unable to verify the Super Admin application profile.');
      }

      return {
        user: result.data as UserAccount,
        role: result.data.role as string,
        assignedBarangay: result.data.assignedBarangay as string | undefined,
        token: session.access_token,
      };
    })();
  },

  async restoreSession(): Promise<UserAccount | null> {
    if (!supabase) {
      console.warn('[AUTH] browser_supabase_client_unavailable');
      return null;
    }
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      console.info('[AUTH] session_restore_check', { sessionExists: false });
      return null;
    }
    storageService.setSessionToken(data.session.access_token);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    console.info('[AUTH] session_restore_user_check', {
      sessionExists: true,
      userExists: Boolean(userData.user),
      userId: userData.user?.id || null,
    });
    if (userError || !userData.user || userData.user.id !== data.session.user.id) {
      storageService.setSessionToken(null);
      return null;
    }
    const res = await fetch('/api/auth/profile', { headers: getAuthHeaders() });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result?.success) {
      console.warn('[AUTH] session_restore_profile_rejected', {
        userId: userData.user.id,
        status: res.status,
        profileFound: false,
      });
      await supabase.auth.signOut();
      storageService.setSessionToken(null);
      throw new Error(result?.error || 'Unable to load the current database profile.');
    }
    console.info('[AUTH] session_restore_profile_authorized', {
      userId: userData.user.id,
      profileFound: true,
      role: result.data?.role,
      active: result.data?.active === true,
      status: result.data?.status,
    });
    return result.data as UserAccount;
  },

  async updateProfile(profile: Pick<UserAccount, 'name' | 'phone'>): Promise<UserAccount> {
    const res = await fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(profile),
    });
    const result = await res.json().catch(() => null);
    if (!res.ok || !result?.success) throw new Error(result?.error || 'Unable to save profile to database.');
    return result.data as UserAccount;
  },

  async changePassword(email: string, currentPassword: string, newPassword: string): Promise<void> {
    if (!supabase) throw new Error('Supabase Auth client is not configured.');
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (signInError) throw new Error('Current password is incorrect.');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  },

  async logout(): Promise<void> {
    await supabase?.auth.signOut();
    storageService.setSessionToken(null);
    storageService.setCurrentUser(null);
  },
};

export const accountsApi = {
  async getAll(): Promise<UserAccount[]> {
    const headers = await getFreshAuthHeaders();
    const res = await fetch('/api/accounts', {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to load user accounts from database.');
    }
    const data = await res.json();
    return data.data || [];
  },

  async create(user: Partial<UserAccount> & { initialPassword: string; confirmPassword: string }): Promise<UserAccount> {
    const headers = await getFreshAuthHeaders();
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify(user),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to save user account to database.');
    }
    return data.data;
  },

  async resetPassword(id: string, initialPassword: string, confirmPassword: string): Promise<void> {
    const headers = await getFreshAuthHeaders();
    const res = await fetch(`/api/accounts/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ initialPassword, confirmPassword }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to reset account password.');
    }
  },

  async update(id: string, user: Partial<UserAccount>): Promise<UserAccount> {
    const headers = await getFreshAuthHeaders();
    const res = await fetch(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(user),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to update user account in database.');
    }
    return data.data;
  },

  async delete(id: string): Promise<boolean> {
    const headers = await getFreshAuthHeaders();
    const res = await fetch(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to delete user account from database.');
    }
    return true;
  },
};

export const moduleDataApi = {
  async get<T>(key: string): Promise<T> {
    const res = await fetch(`/api/module-data/${encodeURIComponent(key)}`, {
      headers: await getFreshAuthHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const message = data?.error || 'Unable to load shared module data from database.';
      throw new Error(data?.diagnosticCode ? `${message} (Database code: ${data.diagnosticCode})` : message);
    }
    return data.data as T;
  },

  async save<T>(key: string, value: T): Promise<T> {
    const res = await fetch(`/api/module-data/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: await getFreshAuthHeaders(),
      body: JSON.stringify({ data: value }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      const message = data?.error || 'Unable to save shared module data to database.';
      throw new Error(data?.diagnosticCode ? `${message} (Database code: ${data.diagnosticCode})` : message);
    }
    return data.data as T;
  },
};

export const biosecurityApi = {
  getAudits: () => moduleDataApi.get<import('../types.ts').BarangayBiosecurityAudit[]>('biosecurity_audits'),
  saveAudits: (audits: import('../types.ts').BarangayBiosecurityAudit[]) =>
    moduleDataApi.save('biosecurity_audits', audits),
  getIncidents: () => moduleDataApi.get<import('../types.ts').BiosecurityIncident[]>('biosecurity_incidents'),
  saveIncidents: (incidents: import('../types.ts').BiosecurityIncident[]) =>
    moduleDataApi.save('biosecurity_incidents', incidents),
};

export const farmersApi = {
  async getAll(): Promise<any[]> {
    const res = await fetch('/api/farmers', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to load farmers from database.');
    }
    const data = await res.json();
    return data.data || [];
  },

  async getSwineRecords(
    farmerId: string,
    isArchived = false
  ): Promise<{ records: SwineRecord[]; total: number }> {
    const params = new URLSearchParams({
      farmerId,
      isArchived: String(isArchived),
    });
    const res = await fetch(`/api/swine?${params}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !Array.isArray(data.data) || typeof data.total !== 'number') {
      throw new Error(data?.error || "Unable to load this farmer's swine from the database.");
    }
    return { records: data.data as SwineRecord[], total: data.total };
  },
};

export const barangaysApi = {
  async getAll(): Promise<Barangay[]> {
    const res = await fetch('/api/barangays', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to load barangay statistics from database.');
    }
    const data = await res.json();
    return data.data || [];
  },

  async create(barangay: Partial<Barangay>): Promise<Barangay> {
    const res = await fetch('/api/barangays', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(barangay),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Unable to save barangay to database.');
    return data.data;
  },

  async update(id: string, barangay: Partial<Barangay>): Promise<Barangay> {
    const res = await fetch(`/api/barangays/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(barangay),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Unable to update barangay in database.');
    return data.data;
  },

  async deactivate(id: string): Promise<void> {
    const res = await fetch(`/api/barangays/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) throw new Error(data?.error || 'Unable to deactivate barangay in database.');
  },
};

export const dashboardApi = {
  async getStats(): Promise<any> {
    const res = await fetch('/api/dashboard/stats', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to load dashboard metrics from database.');
    }
    const data = await res.json();
    return data.data;
  },
};

export const certificatesApi = {
  async getAll(barangay?: string): Promise<IssuedCertificate[]> {
    const url = barangay && barangay !== 'all'
      ? `/api/certificates?filter_barangay=${encodeURIComponent(barangay)}`
      : '/api/certificates';

    const res = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to load certificates from database.');
    }
    const data = await res.json();
    return data.data || [];
  },

  async create(cert: Partial<IssuedCertificate>): Promise<IssuedCertificate> {
    const res = await fetch('/api/certificates', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(cert),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to save certificate to database.');
    }
    return data.data;
  },

  async update(id: string, cert: Partial<IssuedCertificate>): Promise<IssuedCertificate> {
    const res = await fetch(`/api/certificates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(cert),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to update certificate in database.');
    }
    return data.data;
  },

  async archive(controlNumber: string): Promise<void> {
    const res = await fetch(`/api/certificates/${encodeURIComponent(controlNumber)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to archive certificate in database.');
    }
  },
};

export const messagesApi = {
  async getAll(): Promise<MessageItem[]> {
    const res = await fetch('/api/messages', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to load messages from database.');
    }
    const data = await res.json();
    return data.data || [];
  },

  async send(msg: Partial<MessageItem>): Promise<MessageItem> {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(msg),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to send message to database.');
    }
    return data.data;
  },

  async markRead(id: string): Promise<boolean> {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });
    return res.ok;
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return res.ok;
  },
};

export const mediaApi = {
  async getAll(category?: string): Promise<any[]> {
    const url = category && category !== 'ALL'
      ? `/api/media?category=${encodeURIComponent(category)}`
      : '/api/media';
    const res = await fetch(url, {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Unable to load media from database.');
    }
    const data = await res.json();
    return data.data || [];
  },

  async upload(payload: { fileName: string; fileUrl?: string; base64?: string; mimeType?: string; category?: string; altText?: string }): Promise<any> {
    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || 'Unable to upload media to database.');
    }
    return data.data;
  },

  async uploadFile(file: File, category: string): Promise<any> {
    const extensionsByMime: Record<string, string[]> = {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
      'image/gif': ['gif'],
    };
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!extensionsByMime[file.type]?.includes(extension) || file.size === 0 || file.size > 15 * 1024 * 1024) {
      throw new Error('Choose a JPEG, PNG, WebP, or GIF image no larger than 15 MB.');
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Unable to read the selected image.'));
      reader.onerror = () => reject(new Error('Unable to read the selected image.'));
      reader.readAsDataURL(file);
    });
    return this.upload({ fileName: file.name, mimeType: file.type, base64, category });
  },

  async uploadCertificateAsset(file: File): Promise<{ filePath: string; fileUrl: string; fileSize: number }> {
    const extensionsByMime: Record<string, string[]> = {
      'image/jpeg': ['jpg', 'jpeg'],
      'image/png': ['png'],
      'image/webp': ['webp'],
      'image/gif': ['gif'],
    };
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!extensionsByMime[file.type]?.includes(extension) || file.size === 0 || file.size > 15 * 1024 * 1024) {
      throw new Error('Choose a JPEG, PNG, WebP, or GIF image no larger than 15 MB.');
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Unable to read the selected image.'));
      reader.onerror = () => reject(new Error('Unable to read the selected image.'));
      reader.readAsDataURL(file);
    });
    const res = await fetch('/api/certificate-assets/upload', {
      method: 'POST',
      headers: await getFreshAuthHeaders(),
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64 }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.data?.filePath || !data.data?.fileUrl) {
      throw new Error(data?.error || 'Unable to upload certificate image to private Supabase Storage.');
    }
    return data.data;
  },

  async delete(id: string): Promise<boolean> {
    const res = await fetch(`/api/media/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    return res.ok;
  },
};

export const settingsApi = {
  async getPublishedLandingCms(): Promise<LandingCmsConfig> {
    const res = await fetch('/api/landing-cms/published', { cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.config) {
      throw new Error(data?.error || 'Unable to load published landing page configuration.');
    }
    return data.config;
  },

  async getLandingCmsDraft(): Promise<LandingCmsConfig> {
    const res = await fetch('/api/admin/landing-cms/draft', { headers: getAuthHeaders(), cache: 'no-store' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.config) {
      throw new Error(data?.error || 'Unable to load landing page draft.');
    }
    return data.config;
  },

  async saveLandingCmsDraft(config: LandingCmsConfig): Promise<LandingCmsConfig> {
    const res = await fetch('/api/admin/landing-cms/draft', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(config),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.config) {
      throw new Error(data?.error || 'Unable to save landing page draft.');
    }
    return data.config;
  },

  async publishLandingCms(config: LandingCmsConfig): Promise<LandingCmsConfig> {
    const res = await fetch('/api/admin/landing-cms/publish', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(config),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.config) {
      throw new Error(data?.error || 'Unable to publish landing page configuration.');
    }
    return data.config;
  },

  async uploadLandingCmsAsset(file: File, category: string): Promise<{
    filePath: string;
    fileUrl: string;
    fileSize: number;
    fileName: string;
    mimeType: string;
  }> {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read selected file.'));
      reader.onerror = () => reject(new Error('Unable to read selected file.'));
      reader.readAsDataURL(file);
    });
    const res = await fetch('/api/admin/landing-cms/upload', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, base64, category }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.fileUrl || !data.filePath) {
      throw new Error(data?.error || 'Unable to upload landing page media.');
    }
    return data;
  },

  async getLandingConfig(): Promise<any> {
    const res = await fetch('/api/landing-config', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => null);
    return data?.config;
  },

  async saveLandingConfig(config: any): Promise<any> {
    const res = await fetch('/api/landing-config', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(config),
    });
    const data = await res.json().catch(() => null);
    return data?.config;
  },

  async getSidebarTheme(): Promise<SidebarTheme> {
    const res = await fetch('/api/admin/sidebar-theme', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.theme) {
      throw new Error(data?.error || 'Failed to load sidebar configuration.');
    }
    return data.theme;
  },

  async saveSidebarTheme(theme: SidebarTheme): Promise<SidebarTheme> {
    const res = await fetch('/api/admin/sidebar-theme', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(theme),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.theme) {
      throw new Error(data?.error || 'Failed to save sidebar configuration.');
    }
    return data.theme;
  },

  async getRegistryFormSchema(): Promise<RegistryFormSchema> {
    const res = await fetch('/api/admin/registry-form-schema', {
      method: 'GET',
      headers: getAuthHeaders(),
    });
    const data = await res.json().catch(() => null);
    return data?.schema;
  },

  async saveRegistryFormSchema(schema: RegistryFormSchema): Promise<RegistryFormSchema> {
    const res = await fetch('/api/admin/registry-form-schema', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(schema),
    });
    const data = await res.json().catch(() => null);
    return data?.schema;
  },
};
