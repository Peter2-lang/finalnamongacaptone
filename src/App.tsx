import React, { useState, useEffect, Suspense, lazy, useRef, useCallback } from 'react';
import { Header } from './components/common/Header';
import { Sidebar } from './components/common/Sidebar';
import { OfflineBanner } from './components/common/OfflineBanner';
import { BackupModal } from './components/common/BackupModal';
import { AuthModal } from './components/auth/AuthModal';
import { SuperAdminAuth } from './components/auth/SuperAdminAuth';
import { AccessDenied403 } from './components/admin/media/AccessDenied403';
import { hasPermission, isSuperAdminOnlyTab } from './utils/rbacPermissions';
import { storageService } from './services/storageService';
import { accountsApi, authApi, barangaysApi } from './services/api';
import { landingCmsService } from './services/landingCmsService';
import { BackgroundPhotoConfig } from './types/landingCms';
import { Barangay, FarmerSelection, LandingPageConfig, SwineRecord, UserAccount, UserRole } from './types';
import { useRoleTheme } from './hooks/useRoleTheme';
import { supabase } from './lib/supabase';
import { isDynamicImportFailure } from './utils/chunkLoadRecovery';

// Route-level code-splitting for large modules & GIS/Export libraries
const LandingPage = lazy(() => import('./components/landing/LandingPage').then(m => ({ default: m.LandingPage })));
const Dashboard = lazy(() => import('./components/dashboard/Dashboard').then(m => ({ default: m.Dashboard })));
const GisMap = lazy(() => import('./components/gis/GisMap').then(m => ({ default: m.GisMap })));
const SwineForm = lazy(() => import('./components/registry/SwineForm').then(m => ({ default: m.SwineForm })));
const BatchImportModal = lazy(() => import('./components/registry/BatchImportModal').then(m => ({ default: m.BatchImportModal })));
const PigsRecords = lazy(() => import('./components/records/PigsRecords').then(m => ({ default: m.PigsRecords })));
const CertificateManager = lazy(() => import('./components/certificate/CertificateManager').then(m => ({ default: m.CertificateManager })));
const MessagingCenter = lazy(() => import('./components/messaging/MessagingCenter').then(m => ({ default: m.MessagingCenter })));
const ManageBarangays = lazy(() => import('./components/admin/ManageBarangays').then(m => ({ default: m.ManageBarangays })));
const ManageAccounts = lazy(() => import('./components/admin/ManageAccounts').then(m => ({ default: m.ManageAccounts })));
const ManageLandingPage = lazy(() => import('./components/admin/ManageLandingPage').then(m => ({ default: m.ManageLandingPage })));
const ManageRegistryForms = lazy(() => import('./components/admin/ManageRegistryForms').then(m => ({ default: m.ManageRegistryForms })));
const BarangayBiosecurity = lazy(() => import('./components/admin/BarangayBiosecurity').then(m => ({ default: m.BarangayBiosecurity })));
const PhotoMediaSettings = lazy(() => import('./components/admin/media/PhotoMediaSettings').then(m => ({ default: m.PhotoMediaSettings })));
const LogoConfiguration = lazy(() => import('./components/admin/media/LogoConfiguration').then(m => ({ default: m.LogoConfiguration })));
const InterfaceBackgroundConfig = lazy(() => import('./components/admin/media/InterfaceBackgroundConfig').then(m => ({ default: m.InterfaceBackgroundConfig })));
const SidebarColorConfig = lazy(() => import('./components/admin/SidebarColorConfig').then(m => ({ default: m.SidebarColorConfig })));
const RegistryFormCustomizer = lazy(() => import('./components/admin/RegistryFormCustomizer').then(m => ({ default: m.RegistryFormCustomizer })));
const SwineMarketingAlerts = lazy(() => import('./components/marketing/SwineMarketingAlerts').then(m => ({ default: m.SwineMarketingAlerts })));
const SwineTakeoffManager = lazy(() => import('./components/takeoff/SwineTakeoffManager').then(m => ({ default: m.SwineTakeoffManager })));
const AgentCatalog = lazy(() => import('./components/agent/AgentCatalog').then(m => ({ default: m.AgentCatalog })));
const AgentAccountView = lazy(() => import('./components/agent/AgentAccountView').then(m => ({ default: m.AgentAccountView })));
const UserAccountView = lazy(() => import('./components/account/UserAccountView').then(m => ({ default: m.UserAccountView })));
const ApiConfiguration = lazy(() => import('./components/admin/ApiConfiguration').then(m => ({ default: m.ApiConfiguration })));
const DatabaseConfiguration = lazy(() => import('./components/admin/DatabaseConfiguration').then(m => ({ default: m.DatabaseConfiguration })));
const ASFOrdinanceModule = lazy(() => import('./components/asf/ASFOrdinanceModule').then(m => ({ default: m.ASFOrdinanceModule })));
const BiosecurityAssistant = lazy(() => import('./components/assistant/BiosecurityAssistant').then(m => ({ default: m.BiosecurityAssistant })));
const MasterConfigHub = lazy(() => import('./components/admin/MasterConfigHub').then(m => ({ default: m.MasterConfigHub })));

const ViewLoader: React.FC = () => (
  <div className="flex flex-col items-center justify-center min-h-[350px] w-full p-8 text-emerald-800">
    <div className="w-8 h-8 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mb-3" />
    <span className="text-xs font-semibold tracking-wide text-stone-500">Loading module...</span>
  </div>
);

const ModuleLoadError: React.FC<{ error: unknown }> = ({ error }) => (
  <div role="alert" className="mx-auto my-12 max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-6 text-center text-amber-950 shadow-sm">
    <h2 className="text-lg font-bold">This page could not be loaded</h2>
    <p className="mt-2 text-sm">
      {isDynamicImportFailure(error)
        ? 'The app may have updated while this session was open. Reload the page to get the current version.'
        : 'A required page module failed to load. Check your connection and try again.'}
    </p>
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
    >
      Reload application
    </button>
  </div>
);

const normalizeAccountRecord = (row: Partial<UserAccount> & Record<string, any>): UserAccount | null => {
  if (!row) return null;
  const permissions = Array.isArray(row.permissions)
    ? row.permissions
    : typeof row.permissions === 'string'
      ? (() => { try { return JSON.parse(row.permissions); } catch { return []; } })()
      : [];
  const active = row.active ?? row.isActive ?? row.is_active ?? true;
  const userId = typeof row.id === 'string' && row.id ? row.id : (typeof row.uid === 'string' ? row.uid : undefined);
  if (!userId && !row.email && !row.username) return null;
  return {
    ...row,
    id: String(userId || row.email || row.username),
    username: String(row.username || row.uid || (typeof row.email === 'string' ? row.email.split('@')[0] : 'user')),
    name: String(row.name || row.full_name || row.fullName || 'User'),
    fullName: row.fullName || row.full_name || row.name || undefined,
    email: String(row.email || ''),
    role: (row.role || 'focal') as UserRole,
    phone: String(row.phone || row.contactNo || row.phone_number || ''),
    contactNo: String(row.contactNo || row.phone || row.phone_number || ''),
    assignedBarangay: row.assignedBarangay || row.assigned_barangay || undefined,
    barangay_id: row.barangay_id || row.assigned_barangay_id || undefined,
    authUserId: row.authUserId || row.auth_user_id || undefined,
    active: Boolean(active),
    isActive: row.isActive ?? row.is_active ?? Boolean(active),
    status: row.status || (active === false ? 'inactive' : 'active'),
    permissions: Array.isArray(permissions) ? permissions : [],
    avatarUrl: row.avatarUrl || row.avatar_url || undefined,
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
    hasProfile: row.hasProfile ?? true,
  };
};

const applyAccountRealtimeChange = (
  accounts: UserAccount[],
  payload: { eventType: string; new?: Record<string, any>; old?: Record<string, any> }
): UserAccount[] => {
  if (payload.eventType === 'DELETE') {
    const deletedId = payload.old?.id;
    if (deletedId === undefined || deletedId === null) return accounts;
    return accounts.filter(account => account.id !== String(deletedId));
  }

  const nextAccount = normalizeAccountRecord(payload.new || {});
  if (!nextAccount) return accounts;
  const existingIndex = accounts.findIndex(account => account.id === nextAccount.id);
  if (existingIndex < 0) return [nextAccount, ...accounts];
  return accounts.map(account => account.id === nextAccount.id ? { ...account, ...nextAccount } : account);
};

export default function App() {
  const [moduleLoadError, setModuleLoadError] = useState<unknown>(null);
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      if (!isDynamicImportFailure(event.error || event.message)) return;
      console.error('Application dynamic import failed.', event.error || event.message);
      setModuleLoadError(event.error || new Error(event.message));
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (!isDynamicImportFailure(event.reason)) return;
      console.error('Application lazy-loaded module rejected.', event.reason);
      setModuleLoadError(event.reason);
    };
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);
  const [currentRole, setCurrentRole] = useState<UserRole | 'landing'>('landing');
  const [sessionRestoreComplete, setSessionRestoreComplete] = useState(false);
  const isSuperAdmin = currentUser?.role === 'super_admin' || currentRole === 'super_admin';
  const isAdmin = currentUser?.role === 'admin' || currentRole === 'admin' || isSuperAdmin;
  const { fontStyle, colors, roleConfig } = useRoleTheme(currentRole);

  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // Path-based routing state for strict URL enforcement (/superadmin, /dashboard, etc.)
  const [currentPath, setCurrentPath] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname;
    }
    return '/';
  });

  const navigateTo = (path: string) => {
    if (typeof window !== 'undefined') {
      if (window.location.pathname !== path) {
        window.history.pushState({}, '', path);
      }
      setCurrentPath(path);
    }
  };

  const [swineList, setSwineList] = useState<SwineRecord[]>(() => storageService.getSwineRecords());
  const [barangays, setBarangays] = useState<Barangay[]>([]);
  const [landingConfig, setLandingConfig] = useState<LandingPageConfig>(() => storageService.getLandingConfig());
  const [accounts, setAccounts] = useState<UserAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const accountsRefreshRequestRef = useRef(0);
  const accountsInitialLoadPendingRef = useRef(false);
  const accountsRealtimeChangesRef = useRef<Array<{ eventType: string; new?: Record<string, any>; old?: Record<string, any> }>>([]);
  const [interfaceBg, setInterfaceBg] = useState<BackgroundPhotoConfig | null>(() => {
    try {
      return landingCmsService.getDraftConfig().interfaceBackground || null;
    } catch {
      return null;
    }
  });

  // Modals & Navigation helpers
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalRole, setAuthModalRole] = useState<UserRole>('admin');
  const [editingSwine, setEditingSwine] = useState<SwineRecord | null>(null);
  const [selectedFarmerForSwine, setSelectedFarmerForSwine] = useState<FarmerSelection | null>(null);
  const [pendingGisCoordinates, setPendingGisCoordinates] = useState<{ latitude: number; longitude: number; barangay?: string } | null>(null);
  const [certificateSwine, setCertificateSwine] = useState<SwineRecord | null>(null);
  const [preselectedTakeoffSwine, setPreselectedTakeoffSwine] = useState<SwineRecord | null>(null);
  const [gisSelectedBarangay, setGisSelectedBarangay] = useState<string | undefined>(undefined);
  const [gisInitialCenter, setGisInitialCenter] = useState<[number, number] | undefined>(undefined);
  const [gisTargetSwineId, setGisTargetSwineId] = useState<string | null>(null);
  const [recordsViewingRecordId, setRecordsViewingRecordId] = useState<string | null>(null);

  const handleViewSwineOnMap = (swine: SwineRecord) => {
    setGisTargetSwineId(swine.id || swine.pigIdTag);
    const matchedBg = barangays.find(
      b => (swine.barangay_id && b.id === swine.barangay_id) ||
           b.name.toLowerCase() === (swine.barangay || '').toLowerCase()
    );
    if (matchedBg) {
      setGisSelectedBarangay(matchedBg.name);
    } else {
      setGisSelectedBarangay(swine.barangay);
    }

    if (swine.latitude && swine.longitude) {
      setGisInitialCenter([swine.latitude, swine.longitude]);
    } else if (matchedBg) {
      setGisInitialCenter([matchedBg.latitude, matchedBg.longitude]);
    }
    setActiveTab('gis');
  };

  const handleViewSwineRecord = (swine: SwineRecord) => {
    setRecordsViewingRecordId(swine.id || swine.pigIdTag);
    setActiveTab('records');
  };

  // Counters for Header badges
  const [readyTakeoffCount, setReadyTakeoffCount] = useState<number>(0);
  const [activeAlertsCount, setActiveAlertsCount] = useState<number>(0);

  // Google Maps Platform Quota Defense listener
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  useEffect(() => {
    const handler = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  // Sidebar visibility state: open by default on desktop (>=1024px), closed on mobile/tablet
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return true;
  });

  // Close sidebar on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen]);

  // Unread messages count
  const [unreadCount, setUnreadCount] = useState<number>(0);

  useEffect(() => {
    let active = true;
    authApi.restoreSession().then(user => {
      if (!active || !user) return;
      storageService.setCurrentUser(user, true);
      setCurrentUser(user);
      setCurrentRole(user.role);
    }).catch(error => {
      console.error('Unable to restore Supabase Auth profile:', error);
    }).finally(() => {
      if (active) setSessionRestoreComplete(true);
    });
    return () => { active = false; };
  }, []);

  const refreshAccounts = useCallback(async () => {
    const isUserAdmin = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
    if (!isUserAdmin) {
      accountsRefreshRequestRef.current += 1;
      accountsInitialLoadPendingRef.current = false;
      accountsRealtimeChangesRef.current = [];
      setAccounts([]);
      setAccountsLoading(false);
      setAccountsError(null);
      return;
    }

    const requestId = ++accountsRefreshRequestRef.current;
    if (!accountsInitialLoadPendingRef.current) accountsRealtimeChangesRef.current = [];
    accountsInitialLoadPendingRef.current = true;
    setAccountsLoading(true);
    try {
      const recordList = await accountsApi.getAll();
      if (requestId !== accountsRefreshRequestRef.current) return;
      const loadedAccounts = recordList.map(record => normalizeAccountRecord(record)).filter((record): record is UserAccount => Boolean(record));
      const pendingChanges = accountsRealtimeChangesRef.current;
      setAccounts(pendingChanges.reduce(applyAccountRealtimeChange, loadedAccounts));
      accountsRealtimeChangesRef.current = [];
      setAccountsError(null);
    } catch (error) {
      console.error('Unable to refresh user accounts from database:', error);
      if (requestId !== accountsRefreshRequestRef.current) return;
      setAccountsError('Unable to load accounts.');
    } finally {
      if (requestId === accountsRefreshRequestRef.current) {
        accountsInitialLoadPendingRef.current = false;
        accountsRealtimeChangesRef.current = [];
        setAccountsLoading(false);
      }
    }
  }, [currentUser?.role]);

  const refreshAllData = async () => {
    setLandingConfig(storageService.getLandingConfig());

    if (currentUser && storageService.getSessionToken()) {
      try {
        await storageService.refreshRegistryFormSchemaFromCloud();
      } catch (error) {
        console.error('Unable to refresh registry form from database:', error);
      }
    }

    try {
      setBarangays(await barangaysApi.getAll());
    } catch (error) {
      console.error('Unable to refresh barangays from database:', error);
      setBarangays([]);
    }

    try {
      const { records } = await storageService.fetchSwineRecords();
      setSwineList(records);
    } catch {
      setSwineList(storageService.isEffectiveOffline() ? storageService.getSwineRecords() : []);
    }

    const msgs = storageService.getMessages();
    const currUser = storageService.getCurrentUser();
    const unread = msgs.filter(m => {
      const isRead = m.isRead || (currUser?.id && m.readBy?.includes(currUser.id));
      if (isRead) return false;
      if (currUser?.role === 'admin') return true;
      const targetBg = (m.recipientBarangay || m.targetBarangay || 'all').toLowerCase();
      const userBg = (currUser?.assignedBarangay || '').toLowerCase();
      if (currUser?.role === 'focal' && userBg) {
        return targetBg === 'all' || targetBg === userBg;
      }
      return false;
    }).length;
    setUnreadCount(unread);

    // Badges for Takeoff & Marketing Alerts
    const readyPigs = storageService.getSwineRecords().filter(s => {
      if (s.isArchived || !s.readyToSell) return false;
      if (currUser?.role === 'focal' && currUser.assignedBarangay) {
        return (s.barangay || '').toLowerCase() === currUser.assignedBarangay.toLowerCase();
      }
      return true;
    });
    setReadyTakeoffCount(readyPigs.length);

    const alerts = storageService.getMarketingAlerts().filter(a => a.isActive);
    setActiveAlertsCount(alerts.length);
  };

  useEffect(() => {
    refreshAllData();
  }, [currentRole, currentUser]);

  useEffect(() => {
    if (!currentUser || !storageService.getSessionToken()) return;
    storageService.refreshRegistryFormSchemaFromCloud().catch(error => {
      console.error('Unable to refresh registry schema from database:', error);
    });
  }, [currentUser]);

  useEffect(() => {
    const handleSwineUpdate = (e: Event) => {
      const customEvt = e as CustomEvent<SwineRecord[]>;
      if (customEvt?.detail) {
        setSwineList(customEvt.detail);
      }
    };
    window.addEventListener('swine_records_updated', handleSwineUpdate);
    return () => window.removeEventListener('swine_records_updated', handleSwineUpdate);
  }, []);

  useEffect(() => {
    if (!supabase || !currentUser) return;
    let active = true;
    const swineChannel = supabase
      .channel('swine-records-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'swine_records' }, () => {
        if (active) void refreshAllData();
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Unable to subscribe to swine record changes (${status}).`);
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(swineChannel);
    };
  }, [currentUser?.id]);

  const accountsPageOpen = activeTab === 'accounts' && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin');
  useEffect(() => {
    if (!accountsPageOpen) {
      accountsRefreshRequestRef.current += 1;
      accountsInitialLoadPendingRef.current = false;
      accountsRealtimeChangesRef.current = [];
      setAccounts([]);
      setAccountsLoading(false);
      setAccountsError(null);
      return;
    }
    if (!supabase) {
      setAccounts([]);
      setAccountsError('Supabase Realtime is unavailable.');
      setAccountsLoading(false);
      return;
    }

    let active = true;
    let lastStatus: string | null = null;
    setAccountsLoading(true);
    setAccountsError(null);
    accountsRealtimeChangesRef.current = [];
    const usersChannel = supabase.channel('user-accounts-realtime');
    usersChannel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload: any) => {
        if (!isSuperAdmin && payload.new?.role === 'super_admin') {
          const protectedId = String(payload.new.id || '');
          setAccounts(current => current.filter(account => account.id !== protectedId));
          return;
        }
        if (accountsInitialLoadPendingRef.current) accountsRealtimeChangesRef.current.push(payload);
        setAccounts(current => applyAccountRealtimeChange(current, payload));
      })
      .subscribe(status => {
        if (!active) return;
        if (status === 'SUBSCRIBED' && lastStatus !== 'SUBSCRIBED') {
          setAccountsError(null);
          void refreshAccounts();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setAccountsError(`Unable to subscribe to account changes (${status}).`);
          setAccountsLoading(false);
        }
        lastStatus = status;
      });

    return () => {
      active = false;
      accountsRefreshRequestRef.current += 1;
      accountsInitialLoadPendingRef.current = false;
      accountsRealtimeChangesRef.current = [];
      void supabase.removeChannel(usersChannel);
    };
  }, [accountsPageOpen, currentUser?.id, isSuperAdmin, refreshAccounts]);

  const handleAccountUpsert = useCallback((account: UserAccount) => {
    if (currentUser?.role !== 'super_admin' && account.role === 'super_admin') return;
    const change = { eventType: 'UPDATE', new: account as unknown as Record<string, any> };
    if (accountsInitialLoadPendingRef.current) accountsRealtimeChangesRef.current.push(change);
    setAccounts(current => applyAccountRealtimeChange(current, change));
  }, [currentUser?.role]);

  const handleAccountDelete = useCallback((accountId: string) => {
    const change = { eventType: 'DELETE', old: { id: accountId } };
    if (accountsInitialLoadPendingRef.current) accountsRealtimeChangesRef.current.push(change);
    setAccounts(current => current.filter(account => account.id !== accountId));
  }, []);

  useEffect(() => {
    const handleCmsUpdate = (e: Event) => {
      const customEvt = e as CustomEvent;
      const config = customEvt?.detail || landingCmsService.getDraftConfig();
      if (config?.interfaceBackground) {
        setInterfaceBg(config.interfaceBackground);
      }
    };
    window.addEventListener('da_landing_cms_updated', handleCmsUpdate);
    window.addEventListener('da_landing_draft_updated', handleCmsUpdate);
    return () => {
      window.removeEventListener('da_landing_cms_updated', handleCmsUpdate);
      window.removeEventListener('da_landing_draft_updated', handleCmsUpdate);
    };
  }, []);

  // Synchronize browser URL paths with active application state & tab navigation
  useEffect(() => {
    const syncRouteWithState = () => {
      const rawPath = typeof window !== 'undefined' ? window.location.pathname : '/';
      const path = rawPath.toLowerCase().replace(/\/$/, '') || '/';
      setCurrentPath(path);

      if (path === '/superadmin') {
        return;
      }

      if (path === '/login') {
        if (!storageService.getCurrentUser()) {
          setIsAuthModalOpen(true);
        }
        return;
      }

      // Map administrative URLs directly to corresponding modules
      if (path === '/admin/landing-page-cms' || path === '/superadmin/landing-page-cms') {
        setActiveTab('landing_manager');
      } else if (path === '/admin/sidebar-configuration' || path === '/superadmin/sidebar-configuration') {
        setActiveTab('sidebar_color');
      } else if (path === '/admin/user-accounts' || path === '/superadmin/user-accounts') {
        setActiveTab('accounts');
      } else if (path === '/admin/api-configuration' || path === '/superadmin/api-configuration') {
        setActiveTab('api_config');
      } else if (path === '/admin/database-configuration' || path === '/superadmin/database-configuration') {
        setActiveTab('database_config');
      } else if (path === '/admin/registry-form-customization' || path === '/superadmin/registry-form-customization') {
        setActiveTab('form_customizer');
      } else if (path === '/superadmin/system-appearance') {
        setActiveTab('system_appearance');
      } else if (path === '/superadmin/role-page-configuration') {
        setActiveTab('role_page_config');
      } else if (path === '/superadmin/feature-configuration') {
        setActiveTab('feature_config');
      } else if (path === '/superadmin/component-configuration') {
        setActiveTab('component_config');
      } else if (path === '/superadmin/chatbot-configuration') {
        setActiveTab('chatbot_config');
      } else if (path === '/superadmin/typography') {
        setActiveTab('typography_config');
      } else if (path === '/superadmin/branding') {
        setActiveTab('branding_config');
      } else if (path === '/superadmin/layout') {
        setActiveTab('layout_config');
      } else if (path === '/superadmin/version-history') {
        setActiveTab('version_history');
      } else if (path === '/superadmin/audit-logs') {
        setActiveTab('audit_logs');
      } else if (path === '/superadmin/dashboard' || path === '/dashboard') {
        setActiveTab('dashboard');
      } else if (path === '/gis') {
        setActiveTab('gis');
      } else if (path === '/records') {
        setActiveTab('records');
      } else if (path === '/reports' || path === '/certificate') {
        setActiveTab('certificate');
      } else if (path === '/takeoff') {
        setActiveTab('takeoff');
      } else if (path === '/biosecurity') {
        setActiveTab('biosecurity');
      } else if (path === '/asf-ordinance' || path === '/asf_ordinance') {
        setActiveTab('asf_ordinance');
      } else if (path === '/messages') {
        setActiveTab('messages');
      } else if (path === '/barangays') {
        setActiveTab('barangays');
      } else if (path === '/account') {
        setActiveTab('account');
      }
    };

    syncRouteWithState();
    window.addEventListener('popstate', syncRouteWithState);
    return () => window.removeEventListener('popstate', syncRouteWithState);
  }, []);

  const handleSelectRole = (role: UserRole | 'landing', _specificUser?: UserAccount) => {
    if (role === 'landing') {
      setCurrentRole('landing');
      setCurrentUser(null);
      storageService.setCurrentUser(null as any);
      navigateTo('/');
      return;
    }
    const token = storageService.getSessionToken();
    if (!token || !currentUser) {
      handleOpenLogin(role);
      return;
    }
    setCurrentRole(currentUser.role);
    if (currentUser.role === 'super_admin') {
      navigateTo('/superadmin/dashboard');
      setActiveTab('dashboard');
    } else {
      navigateTo('/dashboard');
      setActiveTab(currentUser.role === 'agent' ? 'ready_to_sell' : 'dashboard');
    }
  };

  const handleLogout = () => {
    void authApi.logout();
    setCurrentRole('landing');
    setCurrentUser(null);
    storageService.setCurrentUser(null as any);
    if (currentPath.startsWith('/superadmin')) {
      navigateTo('/superadmin');
    } else {
      navigateTo('/');
    }
  };

  const handleOpenLogin = (role: UserRole = 'admin') => {
    setAuthModalRole(role);
    setIsAuthModalOpen(true);
    if (currentPath === '/' || currentPath === '') {
      navigateTo('/login');
    }
  };

  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    setCurrentRole(user.role);
    storageService.setCurrentUser(user, true);
    setIsAuthModalOpen(false);
    if (user.role === 'super_admin') {
      navigateTo('/superadmin/dashboard');
      setActiveTab('dashboard');
    } else {
      navigateTo('/dashboard');
      setActiveTab(user.role === 'agent' ? 'ready_to_sell' : 'dashboard');
    }
  };

  const handleTabSelect = (tab: string) => {
    if (tab === 'add_swine' && activeTab !== 'add_swine') {
      setEditingSwine(null);
    }
    setActiveTab(tab);

    if (isSuperAdmin) {
      if (tab === 'landing_manager') navigateTo('/superadmin/landing-page-cms');
      else if (tab === 'sidebar_color') navigateTo('/superadmin/sidebar-configuration');
      else if (tab === 'api_config') navigateTo('/superadmin/api-configuration');
      else if (tab === 'database_config') navigateTo('/superadmin/database-configuration');
      else if (tab === 'accounts') navigateTo('/superadmin/user-accounts');
      else if (tab === 'form_customizer') navigateTo('/admin/registry-form-customization');
      else if (tab === 'system_appearance') navigateTo('/superadmin/system-appearance');
      else if (tab === 'role_page_config') navigateTo('/superadmin/role-page-configuration');
      else if (tab === 'feature_config') navigateTo('/superadmin/feature-configuration');
      else if (tab === 'component_config') navigateTo('/superadmin/component-configuration');
      else if (tab === 'chatbot_config') navigateTo('/superadmin/chatbot-configuration');
      else if (tab === 'typography_config') navigateTo('/superadmin/typography');
      else if (tab === 'branding_config') navigateTo('/superadmin/branding');
      else if (tab === 'layout_config') navigateTo('/superadmin/layout');
      else if (tab === 'version_history') navigateTo('/superadmin/version-history');
      else if (tab === 'audit_logs') navigateTo('/superadmin/audit-logs');
      else if (tab === 'dashboard') navigateTo('/superadmin/dashboard');
      else navigateTo(`/${tab}`);
    } else if (isAdmin) {
      if (tab === 'form_customizer') navigateTo('/admin/registry-form-customization');
      else if (tab === 'accounts') navigateTo('/admin/user-accounts');
      else if (tab === 'dashboard') navigateTo('/dashboard');
      else navigateTo(`/${tab}`);
    } else {
      navigateTo(`/${tab}`);
    }
  };

  // Navigations from records
  const handleEditSwine = (swine: SwineRecord) => {
    setEditingSwine(swine);
    setActiveTab('add_swine');
  };

  const handleIssueCertificateForSwine = (swine: SwineRecord) => {
    setCertificateSwine(swine);
    setActiveTab('certificate');
  };

  // Dedicated /superadmin portal handling
  const isSuperAdminRoute = currentPath === '/superadmin' || currentPath.startsWith('/superadmin');

  if (isSuperAdminRoute && !currentUser && !sessionRestoreComplete) {
    return (
      <div className="min-h-screen bg-stone-950 flex items-center justify-center text-stone-200 text-sm" role="status">
        Restoring secure session...
      </div>
    );
  }

  if (isSuperAdminRoute && !isSuperAdmin) {
    if (currentUser) {
      // Non-superadmin account attempting to access /superadmin
      return (
        <div className="min-h-screen bg-stone-950 flex items-center justify-center p-4">
          <AccessDenied403
            moduleName="Super Administrator Portal (Restricted to Regional Super Administrators)"
            onBackToDashboard={() => {
              navigateTo('/dashboard');
              setActiveTab('dashboard');
            }}
          />
        </div>
      );
    }

    // Unauthenticated visitor on /superadmin -> render dedicated SuperAdminAuth
    return (
      <SuperAdminAuth
        onSuccess={async (user) => {
          const verifiedUser = await authApi.restoreSession();
          if (
            !verifiedUser ||
            verifiedUser.role !== 'super_admin' ||
            verifiedUser.authUserId !== user.authUserId
          ) {
            throw new Error('The authenticated Supabase session could not be verified for the Super Admin account.');
          }

          storageService.setCurrentUser(verifiedUser, true);
          setCurrentUser(verifiedUser);
          setCurrentRole('super_admin');
          navigateTo('/superadmin/dashboard');
          setActiveTab('dashboard');
        }}
        onReturnToNormalPortal={() => {
          navigateTo('/');
          setCurrentRole('landing');
        }}
      />
    );
  }

  return (
    <div
      style={fontStyle}
      className={`${currentRole === 'landing' ? 'min-h-dvh' : 'h-dvh max-h-dvh overflow-hidden'} app-shell bg-slate-100 text-stone-900 flex flex-col font-sans antialiased selection:bg-emerald-200 relative`}
    >
      {/* Connected Interface Background Layer - Exclusively for Public Landing View */}
      {interfaceBg?.imageUrl && interfaceBg.enabled !== false && currentRole === 'landing' && (
        <div
          className={`fixed inset-0 pointer-events-none z-0 ${interfaceBg.fixed !== false ? 'attachment-fixed' : ''}`}
          style={{
            backgroundImage: `url(${interfaceBg.imageUrl})`,
            backgroundPosition: interfaceBg.position || 'center',
            backgroundSize: interfaceBg.fit || 'cover',
            backgroundRepeat: interfaceBg.repeat || 'no-repeat',
            filter: `brightness(${(interfaceBg.brightness ?? 100) / 100}) blur(${interfaceBg.blur ?? 0}px)`,
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: interfaceBg.overlayColor || '#064e3b',
              opacity: Math.min(0.94, ((interfaceBg.overlayOpacity ?? 35) / 100) + 0.35),
            }}
          />
        </div>
      )}

      {/* Offline Status & Sync Alert */}
      <OfflineBanner onSyncComplete={refreshAllData} />

      {/* Google Maps Platform Quota Exceeded Sticky Notice */}
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Main Responsive Header */}
      <Header
        currentUser={currentUser}
        currentRole={currentRole}
        onSelectRole={handleSelectRole}
        activeTab={activeTab}
        onSelectTab={handleTabSelect}
        unreadCount={unreadCount}
        onOpenMessages={() => handleTabSelect('messages')}
        onLogout={handleLogout}
        onOpenBackupModal={() => setIsBackupModalOpen(true)}
        onOpenLogin={() => handleOpenLogin('admin')}
        readyTakeoffCount={readyTakeoffCount}
        activeAlertsCount={activeAlertsCount}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
      />

      {/* Main Layout Container with Desktop Locked-In Docked Sidebar & Mobile Drawer */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Desktop Sidebar (Toggleable via left hamburger menu button) */}
        {currentRole !== 'landing' && isSidebarOpen && (
          <aside className="hidden lg:flex flex-col w-72 xl:w-80 shrink-0 border-r border-transparent bg-transparent z-20 h-full overflow-hidden transition-all duration-200">
            <Sidebar
              currentUser={currentUser}
              currentRole={currentRole}
              activeTab={activeTab}
              onSelectTab={handleTabSelect}
              onSelectRole={handleSelectRole}
              unreadCount={unreadCount}
              readyTakeoffCount={readyTakeoffCount}
              onLogout={handleLogout}
              onClose={() => {}}
              onOpenLogin={() => handleOpenLogin('admin')}
            />
          </aside>
        )}

        {/* Mobile Slide-in Drawer (Only on mobile/tablet <lg when opened via menu toggle) */}
        {isSidebarOpen && currentRole !== 'landing' && (
          <div className="lg:hidden fixed inset-0 z-50 flex pointer-events-auto">
            {/* Clickable Backdrop - closes drawer cleanly */}
            <div
              className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity cursor-pointer"
              onClick={() => setIsSidebarOpen(false)}
              aria-label="Close navigation menu"
            />
            <div className="relative w-72 sm:w-80 max-w-[85vw] h-full bg-transparent shadow-2xl z-10 flex flex-col overflow-hidden animate-in slide-in-from-left duration-200">
              <Sidebar
                currentUser={currentUser}
                currentRole={currentRole}
                activeTab={activeTab}
                onSelectTab={tab => {
                  handleTabSelect(tab);
                  setIsSidebarOpen(false);
                }}
                onSelectRole={role => {
                  handleSelectRole(role);
                  setIsSidebarOpen(false);
                }}
                unreadCount={unreadCount}
                readyTakeoffCount={readyTakeoffCount}
                onLogout={() => {
                  handleLogout();
                  setIsSidebarOpen(false);
                }}
                onClose={() => setIsSidebarOpen(false)}
                onOpenLogin={() => {
                  handleOpenLogin('admin');
                  setIsSidebarOpen(false);
                }}
              />
            </div>
          </div>
        )}

        {/* Main Dashboard Viewport - ALWAYS fully visible, bright, solid administrative canvas */}
        <main
          style={{
            backgroundColor: currentRole !== 'landing' && colors?.backgroundColor ? colors.backgroundColor : undefined,
          }}
          className="flex-1 min-h-0 w-full min-w-0 overflow-y-auto text-stone-900 relative z-10"
        >
          {moduleLoadError ? (
            <ModuleLoadError error={moduleLoadError} />
          ) : <Suspense fallback={<ViewLoader />}>
            {currentRole === 'landing' ? (
          <LandingPage
            swineList={swineList}
            barangays={barangays}
            config={landingConfig}
            accounts={accounts}
            onSelectRole={handleSelectRole}
            onNavigateTab={tab => setActiveTab(tab)}
            onOpenLogin={() => handleOpenLogin('admin')}
          />
        ) : currentRole === 'agent' ? (
          activeTab === 'messages' ? (
            <MessagingCenter
              barangays={barangays}
              currentUser={currentUser}
              onRefreshBadge={refreshAllData}
            />
          ) : activeTab === 'account' ? (
            <AgentAccountView
              currentUser={currentUser}
              onLogout={handleLogout}
            />
          ) : (
            <AgentCatalog
              swineList={swineList}
              barangays={barangays}
            />
          )
        ) : (
          /* Admin or Focal Person Tabs */
          <>
            {activeTab === 'dashboard' && (
              <Dashboard
                swineList={swineList}
                barangays={barangays}
                currentUser={currentUser}
                currentRole={currentRole}
                onNavigateTab={setActiveTab}
                onAddSwine={() => {
                  setEditingSwine(null);
                  setActiveTab('add_swine');
                }}
                onOpenBatchModal={() => setIsBatchModalOpen(true)}
              />
            )}

            {activeTab === 'takeoff' && (
              <SwineTakeoffManager
                swineList={swineList}
                barangays={barangays}
                currentUser={currentUser}
                initialSelectedSwine={preselectedTakeoffSwine}
                onRefresh={refreshAllData}
                onNavigateBack={() => handleTabSelect('records')}
              />
            )}

            {activeTab === 'biosecurity' && (
              <BarangayBiosecurity
                barangays={barangays}
                currentUser={currentUser}
                currentRole={currentRole}
                onRefresh={refreshAllData}
              />
            )}

            {activeTab === 'marketing_alerts' && (
              <SwineMarketingAlerts
                swineList={swineList}
                barangays={barangays}
                currentUser={currentUser}
                onScheduleTakeoff={(swine) => {
                  setPreselectedTakeoffSwine(swine);
                  setActiveTab('takeoff');
                }}
                onRefresh={refreshAllData}
              />
            )}

            {activeTab === 'gis' && (
              <div className="p-4 sm:p-6 w-full space-y-4">
                <div className="bg-white p-6 rounded-2xl border border-stone-200 shadow-xs space-y-4">
                  <div>
                    <h2 className="text-xl font-extrabold text-stone-900 tracking-tight">
                      Hinunangan Municipal GIS Biosurveillance & Swine Map
                    </h2>
                    <p className="text-xs text-stone-500 mt-1">
                      Satellite & topographical mapping of 40 Hinunangan barangays, ASF risk zones, pig farm density heatmap, and live GPS tracking.
                    </p>
                  </div>
                  <div>
                    <button
                      onClick={() => {
                        setEditingSwine(null);
                        setActiveTab('add_swine');
                      }}
                      className="bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-xs px-4 py-2 rounded-xl transition cursor-pointer shadow-sm flex items-center gap-1.5"
                    >
                      + Register Swine with GPS
                    </button>
                  </div>
                </div>

                <GisMap
                  swineList={
                    currentRole === 'focal' && currentUser?.assignedBarangay
                      ? swineList.filter(s => (s.barangay || '').toLowerCase() === (currentUser.assignedBarangay || '').toLowerCase())
                      : swineList
                  }
                  barangays={barangays}
                  selectedBarangay={gisSelectedBarangay || (currentRole === 'focal' ? currentUser?.assignedBarangay : undefined)}
                  initialCenter={gisInitialCenter}
                  currentUser={currentUser}
                  currentRole={currentRole}
                  targetSwineId={gisTargetSwineId}
                  onSelectSwine={handleEditSwine}
                  onViewSwineRecord={handleViewSwineRecord}
                  onPickLocation={(lat, lng, closestBarangay) => {
                    setPendingGisCoordinates({ latitude: lat, longitude: lng, barangay: closestBarangay });
                    setEditingSwine(null);
                    setActiveTab('add_swine');
                  }}
                />
              </div>
            )}

            {activeTab === 'asf_ordinance' && currentRole !== 'focal' && (
              <ASFOrdinanceModule
                barangays={barangays}
                currentUser={currentUser}
                onNavigateTab={setActiveTab}
              />
            )}

            {activeTab === 'add_swine' && (
              <SwineForm
                barangays={barangays}
                currentUser={currentUser}
                initialData={editingSwine}
                initialFarmer={selectedFarmerForSwine}
                initialCoordinates={pendingGisCoordinates}
                onSuccess={() => {
                  setEditingSwine(null);
                  setSelectedFarmerForSwine(null);
                  setPendingGisCoordinates(null);
                  refreshAllData();
                  setActiveTab('records');
                }}
                onCancel={() => {
                  setEditingSwine(null);
                  setSelectedFarmerForSwine(null);
                  setPendingGisCoordinates(null);
                  setActiveTab('records');
                }}
                onOpenBatchModal={() => setIsBatchModalOpen(true)}
                onViewOrdinance={() => setActiveTab('asf_ordinance')}
              />
            )}

            {activeTab === 'records' && (
              <PigsRecords
                swineList={swineList}
                barangays={barangays}
                currentUser={currentUser}
                currentRole={currentRole}
                onEditSwine={handleEditSwine}
                onIssueCertificate={handleIssueCertificateForSwine}
                onViewOnMap={handleViewSwineOnMap}
                initialViewingRecordId={recordsViewingRecordId}
                onAddSwine={farmer => {
                  setEditingSwine(null);
                  setSelectedFarmerForSwine(farmer || null);
                  setActiveTab('add_swine');
                }}
                onRefresh={refreshAllData}
              />
            )}

            {activeTab === 'certificate' && (
              <CertificateManager
                swineList={swineList}
                barangays={barangays}
                currentUser={currentUser}
                selectedSwineInitial={certificateSwine}
              />
            )}

            {activeTab === 'messages' && (
              <MessagingCenter
                barangays={barangays}
                currentUser={currentUser}
                onRefreshBadge={refreshAllData}
              />
            )}

            {activeTab === 'barangays' && (
              isAdmin ? (
                <ManageBarangays barangays={barangays} onRefresh={refreshAllData} />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => setActiveTab('dashboard')}
                  moduleName="Manage Barangays"
                />
              )
            )}

            {activeTab === 'accounts' && (
              (isSuperAdmin || isAdmin) ? (
                <ManageAccounts
                  users={accounts}
                  barangays={barangays}
                  currentUser={currentUser}
                  isLoading={accountsLoading}
                  loadError={accountsError}
                  onAccountUpsert={handleAccountUpsert}
                  onAccountDelete={handleAccountDelete}
                />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => setActiveTab('dashboard')}
                  moduleName="User Accounts"
                />
              )
            )}

            {/* Unified Landing Page Settings Hub (Consolidates all landing page settings, background, media library, logos, and social) */}
            {(activeTab === 'landing_manager' ||
              activeTab === 'landing_settings' ||
              activeTab === 'admin_photo_media' ||
              activeTab === 'photo_media' ||
              activeTab === 'admin_logos' ||
              activeTab === 'admin_background' ||
              activeTab === 'admin_social') && (
              isSuperAdmin ? (
                <ManageLandingPage
                  initialTab={
                    activeTab === 'admin_photo_media' || activeTab === 'photo_media'
                      ? 'media_library'
                      : activeTab === 'admin_logos'
                      ? 'logos_branding'
                      : activeTab === 'admin_background'
                      ? 'background'
                      : activeTab === 'admin_social'
                      ? 'social_media'
                      : undefined
                  }
                  onRefresh={refreshAllData}
                />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => setActiveTab('dashboard')}
                  moduleName="Landing Page CMS"
                />
              )
            )}

            {/* Theme & Appearance */}
            {activeTab === 'admin_theme' && (
              isSuperAdmin ? (
                <ManageLandingPage onRefresh={refreshAllData} />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => setActiveTab('dashboard')}
                  moduleName="Theme & Appearance Settings"
                />
              )
            )}

            {/* Sidebar Color Configuration (SUPER ADMIN ONLY) */}
            {activeTab === 'sidebar_color' && (
              isSuperAdmin ? (
                <SidebarColorConfig
                  onSaved={refreshAllData}
                  onNavigateTab={setActiveTab}
                />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => setActiveTab('dashboard')}
                  moduleName="Sidebar Configuration"
                />
              )
            )}

            {/* My Account (Focal Person & Admin) */}
            {activeTab === 'account' && (
              <UserAccountView
                currentUser={currentUser}
                onLogout={handleLogout}
                onUpdateUser={(updated) => {
                  setCurrentUser(updated);
                  refreshAllData();
                }}
                swineList={swineList}
                barangays={barangays}
              />
            )}

            {/* Registry Form Customization (ADMIN & SUPER ADMIN) */}
            {(activeTab === 'form_customizer' || activeTab === 'form_manager') && (
              isAdmin ? (
                <RegistryFormCustomizer
                  barangays={barangays}
                  onRefresh={refreshAllData}
                  onNavigateTab={handleTabSelect}
                />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => handleTabSelect('dashboard')}
                  moduleName="Registry Form Customization"
                />
              )
            )}

            {/* API Configuration (SUPER ADMIN ONLY) */}
            {activeTab === 'api_config' && (
              isSuperAdmin ? (
                <ApiConfiguration />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => handleTabSelect('dashboard')}
                  moduleName="API Configuration"
                />
              )
            )}

            {/* Database Configuration (SUPER ADMIN ONLY) */}
            {activeTab === 'database_config' && (
              isSuperAdmin ? (
                <DatabaseConfiguration />
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => handleTabSelect('dashboard')}
                  moduleName="Database Configuration"
                />
              )
            )}

            {/* Master Configuration Hub (SUPER ADMIN ONLY) */}
            {(activeTab === 'system_appearance' ||
              activeTab === 'role_page_config' ||
              activeTab === 'feature_config' ||
              activeTab === 'component_config' ||
              activeTab === 'chatbot_config' ||
              activeTab === 'nav_config' ||
              activeTab === 'notification_config' ||
              activeTab === 'popup_config' ||
              activeTab === 'button_config' ||
              activeTab === 'typography_config' ||
              activeTab === 'branding_config' ||
              activeTab === 'layout_config' ||
              activeTab === 'version_history' ||
              activeTab === 'audit_logs') && (
              isSuperAdmin ? (
                <div className="p-4 sm:p-6 w-full">
                  <MasterConfigHub
                    initialTab={activeTab}
                    onRefresh={refreshAllData}
                    onNavigateTab={handleTabSelect}
                  />
                </div>
              ) : (
                <AccessDenied403
                  onBackToDashboard={() => handleTabSelect('dashboard')}
                  moduleName="Master System Configuration"
                />
              )
            )}
          </>
        )}
          </Suspense>}
      </main>
    </div>

      {/* Batch Import Modal */}
      <Suspense fallback={null}>
        <BatchImportModal
          isOpen={isBatchModalOpen}
          onClose={() => setIsBatchModalOpen(false)}
          barangays={barangays}
          currentUser={currentUser}
          onImportComplete={() => {
            refreshAllData();
            handleTabSelect('records');
          }}
        />
      </Suspense>

      {/* Database Backup & Restore Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        onDataRestored={refreshAllData}
      />

      {/* Login Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          if (currentPath === '/login') {
            navigateTo('/');
          }
        }}
        onLoginSuccess={handleLoginSuccess}
        initialRole={authModalRole}
      />

      {/* Floating DA Hinunangan Biosecurity Assistant */}
      <Suspense fallback={null}>
        <BiosecurityAssistant
          currentUser={currentUser}
          currentRole={currentRole}
          onNavigateTab={handleTabSelect}
          swineList={swineList}
          barangays={barangays}
          onRefresh={refreshAllData}
          onOpenLogin={() => setIsAuthModalOpen(true)}
        />
      </Suspense>
    </div>
  );
}
