import express from 'express';
import { createHash } from 'node:crypto';
import { HINUNANGAN_BARANGAYS } from '../data/barangays.ts';
import { ALL_ASF_REGULATIONS } from '../data/asfRegulationsData.ts';
import {
  getAllSwineRecords,
  getSwineRecordById,
  upsertSwineRecord,
  batchUpsertSwineRecords,
  deleteSwineRecordById,
  deleteSwineRecordsByIds,
  getNextAuthoritativePigIdTag,
} from '../db/swine.ts';
import { archiveCertificateByControlNumber, getAllCertificates, getCertificateByIdOrControlNumber, upsertCertificate } from '../db/certificates.ts';
import { getCertificateTemplates, saveCertificateTemplate } from '../db/certificateTemplates.ts';
import { filterCertificateTemplatesForUser } from '../utils/certificateTemplateFilters.ts';
import { formatCertificateTemplateDatabaseError } from '../utils/certificateTemplateDatabaseError.ts';
import { getAllUsers, getUserByAuthUserId, getUserByUsernameOrEmail, insertUserProfile, upsertUser, deleteUserByUid } from '../db/users.ts';
import { getAllMessages, createMessage, markMessageRead, deleteMessageById } from '../db/messages.ts';
import { getAllMedia, insertMedia, deleteMediaById } from '../db/media.ts';
import { getStoredSystemSetting, getSystemSetting, setSystemSetting } from '../db/settings.ts';
import { initPostgresTables, pool, testDatabaseConnection, updateDatabaseConnection } from '../db/index.ts';
import {
  getFullRegistrySchemaFromDb,
  syncFullRegistrySchemaToDb,
  upsertSchemaFieldInDb,
  deleteSchemaFieldFromDb,
  getSchemaFieldById,
  getAllSchemaFieldsFromDb,
} from '../db/registrySchema.ts';
import { DEFAULT_SIDEBAR_THEME, INITIAL_REGISTRY_FORM_SCHEMA } from '../data/initialFormSchema.ts';
import { INITIAL_LANDING_CONFIG } from '../data/initialData.ts';
import { DEFAULT_MASTER_CONFIG } from '../data/defaultMasterConfig.ts';
import { INITIAL_LANDING_CMS_CONFIG } from '../data/initialLandingCmsData.ts';
import {
  createCertificateAssetSignedUrl,
  deleteLandingCmsAsset,
  uploadCertificateAsset,
  uploadLandingCmsAsset,
} from './supabaseStorage.ts';
import { interpretSuperAdminConfigCommand } from '../utils/configCommandInterpreter.ts';
import { isValidPhilippinePhoneNumber, normalizePhilippinePhoneNumber, toFieldKey } from '../utils/registryFieldUtils.ts';
import { getSupabaseAdminConfigError, getSupabaseAuthConfigStatus, supabaseAdminClient, supabaseAuthClient, supabaseAuthProjectRef } from '../lib/supabaseServer.ts';

export function createApp() {
  const app = express();

  type SessionUser = {
    userId: string;
    username: string;
    name: string;
    role: string;
    assignedBarangay: string;
    barangayId: string;
    permissions: string[];
    active: boolean;
  };

  const getConfiguredDatabaseProjectRef = (): string | null => {
    const connectionString =
      process.env.DATABASE_URL?.trim() ||
      process.env.SUPABASE_DATABASE_URL?.trim() ||
      process.env.POSTGRES_URL?.trim();
    if (!connectionString) return null;
    try {
      const parsed = new URL(connectionString);
      const directHostRef = parsed.hostname.match(/^db\.([^.]+)\.supabase\.co$/i)?.[1];
      const usernameRef = decodeURIComponent(parsed.username).match(/^postgres\.([^.]+)$/i)?.[1];
      return directHostRef || usernameRef || null;
    } catch {
      return null;
    }
  };

  const sanitizeSupabaseDiagnostic = (message: unknown): string => {
    const value = typeof message === 'string' ? message : 'Unknown Supabase error';
    return value
      .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, '[redacted key]')
      .replace(/eyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+){0,2}/g, '[redacted token]')
      .slice(0, 300);
  };

  const uuidForSyncOperation = (operationId: string): string => {
    const bytes = createHash('sha256').update(operationId).digest('hex').slice(0, 32).split('');
    bytes[12] = '5';
    bytes[16] = ((parseInt(bytes[16], 16) & 0x3) | 0x8).toString(16);
    const hex = bytes.join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  const getDatabaseErrorCode = (error: any): string | undefined => {
    const code = error?.code || error?.cause?.code;
    return typeof code === 'string' && /^(?:[0-9A-Z]{5}|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET)$/.test(code)
      ? code
      : undefined;
  };

  const getDatabaseErrorKind = (error: any): string => {
    const causes: any[] = [];
    let current = error;
    while (current && causes.length < 4) {
      causes.push(current);
      current = current.cause;
    }

    const codes = causes.map(cause => String(cause.code || '')).join(' ');
    const messages = causes.map(cause => String(cause.message || '')).join(' ').toLowerCase();
    if (/28P01|28000/.test(codes)) return 'authentication_failed';
    if (/ENOTFOUND|EAI_AGAIN/.test(codes)) return 'host_not_found';
    if (/ECONNREFUSED/.test(codes)) return 'connection_refused';
    if (/ETIMEDOUT|timeout|timed out/.test(`${codes} ${messages}`)) return 'connection_timeout';
    if (/ECONNRESET|EHOSTUNREACH/.test(codes)) return 'network_unreachable';
    if (/certificate|ssl|tls/.test(messages)) return 'tls_error';
    if (/3D000/.test(codes)) return 'database_not_found';
    if (/42501/.test(codes)) return 'permission_denied';
    return 'connection_failed';
  };

  const getConfiguredDatabaseHost = (): string => {
    if (process.env.SQL_HOST?.trim()) return process.env.SQL_HOST.trim();
    const connectionString =
      process.env.DATABASE_URL?.trim() ||
      process.env.SUPABASE_DATABASE_URL?.trim() ||
      process.env.POSTGRES_URL?.trim();
    if (!connectionString) return 'not_configured';
    try {
      return new URL(connectionString).hostname || 'invalid_database_url';
    } catch {
      return 'invalid_database_url';
    }
  };

  // Non-blocking background table verification
  initPostgresTables().catch(err => {
    console.warn('PostgreSQL table check notice:', err?.message || err);
  });

  app.use(express.json({ limit: '30mb' }));
  app.use(express.urlencoded({ extended: true, limit: '30mb' }));

  app.use(async (req, res, next) => {
    const requiresSession =
      /^\/api\/(?:swine(?:-records)?|sync|registry-schema|module-data|accounts|certificates|reports)(?:\/|$)/.test(req.path) ||
      /^\/api\/auth\/(?:profile|superadmin-profile)$/.test(req.path) ||
      /^\/api\/admin\/registry-form-schema(?:\/|$)/.test(req.path) ||
      ((req.path === '/api/barangays' || req.path.startsWith('/api/barangays/')) && req.method !== 'GET');
    if (!requiresSession) return next();
    // Only check routes starting with /api/ or /health
    if (!req.path.startsWith('/api/') && req.path !== '/health') {
      return next();
    }

    // Explicitly allowed public routes that do NOT require an active session
    const isPublicRoute =
      req.path === '/health' ||
      req.path === '/api/health' ||
      req.path === '/api/auth/login' ||
      req.path === '/api/landing-cms/published' ||
      (req.path === '/api/landing-config' && req.method === 'GET') ||
      (req.path === '/api/landing/settings' && req.method === 'GET') ||
      req.path === '/api/legal-documents' ||
      req.path === '/api/public/assistant/chat' ||
      (req.path === '/api/barangays' && req.method === 'GET');

    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) {
      if (isPublicRoute) return next();
      console.warn('[AUTH] protected_request_missing_bearer', { path: req.path });
      return res.status(401).json({ success: false, error: 'Your session has expired. Please sign in again.' });
    }

    if (!supabaseAuthClient) {
      if (isPublicRoute) return next();
      return res.status(503).json({ success: false, error: 'Supabase Auth service is not configured on the server.' });
    }

    try {
      const { data, error } = await supabaseAuthClient.auth.getUser(token);
      if (error || !data.user) {
        if (isPublicRoute) return next();
        const tokenRejected = error?.status === 401 || !error;
        console.warn('[AUTH] protected_request_auth_verification_failed', {
          path: req.path,
          reason: tokenRejected ? 'token_rejected' : 'supabase_verifier_error',
          code: error?.code || 'user_not_found',
          status: error?.status,
        });
        return res.status(tokenRejected ? 401 : 503).json({
          success: false,
          error: tokenRejected
            ? 'Your session has expired. Please sign in again.'
            : 'Supabase could not verify your session right now. Please try again shortly.',
        });
      }

      const profile = await getUserByAuthUserId(data.user.id);
      if (!profile || profile.active !== true || profile.isActive !== true || profile.status !== 'active') {
        if (isPublicRoute) return next();
        console.warn('[AUTH] protected_request_profile_rejected', {
          path: req.path,
          userId: data.user.id,
          profileFound: Boolean(profile),
          role: profile?.role || null,
          active: profile?.active === true,
          isActive: profile?.isActive === true,
          status: profile?.status || null,
        });
        return res.status(403).json({ success: false, error: 'No active application profile is linked to this Supabase account.' });
      }

      (req as any).authenticatedUser = {
        userId: data.user.id,
        username: profile.username,
        name: profile.name,
        role: profile.role,
        assignedBarangay: profile.assignedBarangay || '',
        barangayId: profile.barangay_id || '',
        permissions: profile.permissions || [],
        active: profile.active,
      } satisfies SessionUser;

      console.info('[AUTH] protected_request_authorized', {
        path: req.path,
        userId: data.user.id,
        profileFound: true,
        role: profile.role,
        active: profile.active === true,
        isActive: profile.isActive === true,
        status: profile.status,
      });

      return next();
    } catch (error) {
      if (isPublicRoute) return next();
      console.error('[AUTH] protected_request_validation_failed', {
        path: req.path,
        message: error instanceof Error ? error.message : 'Unknown authentication validation error',
        code: getDatabaseErrorCode(error),
      });
      return res.status(503).json({ success: false, error: 'Unable to validate Supabase Auth session.' });
    }
  });

  app.get(['/health', '/api/health'], async (_req, res) => {
    let dbStatus = 'disconnected';
    let recordsCount = 0;
    let databaseErrorCode: string | undefined;
    let databaseErrorKind: string | undefined;
    try {
      const client = await pool.connect();
      dbStatus = 'connected';
      try {
        const countRes = await client.query('SELECT count(*) FROM swine_records');
        recordsCount = parseInt(countRes.rows[0]?.count || '0', 10);
      } catch (err: any) {
        dbStatus = 'schema_error';
        databaseErrorCode = getDatabaseErrorCode(err);
        databaseErrorKind = getDatabaseErrorKind(err);
      } finally {
        client.release();
      }
    } catch (err: any) {
      dbStatus = 'error';
      databaseErrorCode = getDatabaseErrorCode(err);
      databaseErrorKind = getDatabaseErrorKind(err);
    }
    let authAdminStatus: 'not_configured' | 'valid' | 'invalid' = 'not_configured';
    let authAdminError: string | undefined;
    if (supabaseAdminClient) {
      try {
        const { error } = await supabaseAdminClient.auth.admin.listUsers({ page: 1, perPage: 1 });
        if (error) {
          authAdminStatus = 'invalid';
          authAdminError = sanitizeSupabaseDiagnostic(error.message);
          console.error('[HEALTH] supabase_auth_admin_probe_failed', {
            code: error.code || 'unknown',
            status: error.status,
            message: authAdminError,
          });
        } else {
          authAdminStatus = 'valid';
        }
      } catch (error: any) {
        authAdminStatus = 'invalid';
        authAdminError = sanitizeSupabaseDiagnostic(error?.message);
        console.error('[HEALTH] supabase_auth_admin_probe_failed', {
          code: error?.code || 'unknown',
          status: error?.status,
          message: authAdminError,
        });
      }
    } else {
      authAdminError = getSupabaseAdminConfigError() || 'Supabase Auth Admin client is not initialized.';
    }

    res.json({
      status: 'ok',
      service: 'hinunangan-swine-registry',
      database: dbStatus,
      database_engine: global._isPgMem ? 'memory' : 'postgres',
      database_host: getConfiguredDatabaseHost(),
      database_configured: Boolean(
        process.env.DATABASE_URL?.trim() ||
        process.env.SUPABASE_DATABASE_URL?.trim() ||
        process.env.POSTGRES_URL?.trim() ||
        process.env.SQL_HOST?.trim()
      ),
      supabase_auth_project_ref: supabaseAuthProjectRef,
      supabase_auth_admin_configured: Boolean(supabaseAdminClient),
      supabase_auth_admin_status: authAdminStatus,
      ...(authAdminError ? { supabase_auth_admin_error: authAdminError } : {}),
      database_project_ref: getConfiguredDatabaseProjectRef(),
      ...(databaseErrorCode ? { database_error_code: databaseErrorCode } : {}),
      ...(databaseErrorKind ? { database_error_kind: databaseErrorKind } : {}),
      swine_records_count: recordsCount,
      timestamp: new Date().toISOString(),
    });
  });

  // Regex patterns
  const PIG_ID_TAG_REGEX = /^HIN-\d{4}-\d{4,}$/;

  // Helper to extract authenticated user security context
  function getUserSecurityContext(req: express.Request) {
    const authenticatedUser = ((req as any).authenticatedUser || null) as SessionUser | null;
    const rawRole = authenticatedUser?.role || '';
    const role = (rawRole === 'super_admin' || rawRole === 'admin' || rawRole === 'focal' || rawRole === 'agent')
      ? rawRole
      : 'guest';
    const barangayId = authenticatedUser?.barangayId || '';
    const assignedBarangay = authenticatedUser?.assignedBarangay || '';
    const userId = authenticatedUser?.userId || '';
    const username = authenticatedUser?.username || (role === 'guest' ? 'Visitor' : 'User');
    const isSuperAdmin = role === 'super_admin';
    const isAdmin = role === 'admin' || role === 'super_admin';
    const isAgent = role === 'agent';
    const isFocal = role === 'focal';
    const isAuthenticated = role !== 'guest';
    return { role, barangayId, assignedBarangay, userId, username, isSuperAdmin, isAdmin, isAgent, isFocal, isAuthenticated };
  }

  async function signTemplateAssetUrls(template: Awaited<ReturnType<typeof getCertificateTemplates>>[number], user: ReturnType<typeof getUserSecurityContext>) {
    const sign = async (path?: string) => {
      if (!path) return undefined;
      if (!supabaseAdminClient) {
        throw new Error(getSupabaseAdminConfigError() || 'Supabase Storage signing is not configured.');
      }
      if (!user.isAdmin && path.startsWith('barangays/')) {
        const folderBarangay = path.split('/')[1];
        if (folderBarangay.toLocaleLowerCase() !== user.assignedBarangay.trim().toLocaleLowerCase()) {
          throw new Error('The certificate image is outside your assigned barangay scope.');
        }
      }
      return createCertificateAssetSignedUrl(supabaseAdminClient, path);
    };
    const [logos, watermarkUrl, signatories, logoSettings] = await Promise.all([
      Promise.all((template.logos || []).map(async logo => ({
        ...logo,
        customUrl: await sign(logo.storagePath) || logo.customUrl,
      }))),
      sign(template.watermark?.storagePath),
      Promise.all((template.signatories || []).map(async signatory => ({
        ...signatory,
        signatureImageUrl: await sign(signatory.signatureStoragePath) || signatory.signatureImageUrl,
      }))),
      template.logoSettings
        ? Promise.all([
          sign(template.logoSettings.leftLogoStoragePath),
          sign(template.logoSettings.centerLogoStoragePath),
          sign(template.logoSettings.rightLogoStoragePath),
          sign(template.logoSettings.watermarkStoragePath),
        ])
        : Promise.resolve(undefined),
    ]);
    return {
      ...template,
      logos,
      watermark: {
        ...template.watermark,
        customUrl: watermarkUrl || template.watermark?.customUrl,
      },
      signatories,
      ...(logoSettings ? {
        logoSettings: {
          ...template.logoSettings,
          leftLogoUrl: logoSettings[0] || template.logoSettings?.leftLogoUrl,
          centerLogoUrl: logoSettings[1] || template.logoSettings?.centerLogoUrl,
          rightLogoUrl: logoSettings[2] || template.logoSettings?.rightLogoUrl,
          watermarkUrl: logoSettings[3] || template.logoSettings?.watermarkUrl,
        },
      } : {}),
    };
  }

  // =========================================================================
  // 1. AUTHENTICATION & USER ACCOUNTS (DATABASE-DRIVEN)
  // =========================================================================

  // Login endpoint
  const handleLogin = (requiredRole?: string) => async (req: express.Request, res: express.Response) => {
    const { username, email, password, clientProjectRef } = req.body || {};
    const identifier = String(email || username || '').trim();
    if (!identifier || typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }
    if (requiredRole && !identifier.includes('@')) {
      return res.status(400).json({ success: false, error: 'Enter the Super Admin email address.' });
    }

    const authConfig = getSupabaseAuthConfigStatus();
    if (!supabaseAuthClient || !authConfig.projectRef) {
      console.error('[AUTH] supabase_configuration_missing', {
        hasUrl: authConfig.hasUrl,
        hasPublishableKey: authConfig.hasPublishableKey,
      });
      return res.status(503).json({ success: false, error: 'Supabase Auth is not configured on the server.' });
    }
    if (typeof clientProjectRef !== 'string' || !clientProjectRef) {
      console.error('[AUTH] browser_supabase_configuration_missing');
      return res.status(503).json({ success: false, error: 'Supabase Auth is not configured in this deployment build.' });
    }
    if (clientProjectRef.toLowerCase() !== authConfig.projectRef.toLowerCase()) {
      console.error('[AUTH] supabase_project_mismatch', {
        browserProjectRef: clientProjectRef,
        serverProjectRef: authConfig.projectRef,
      });
      return res.status(503).json({ success: false, error: 'The application and authentication service use different Supabase projects.' });
    }

    let authEmail = identifier.toLowerCase();
    if (!authEmail.includes('@')) {
      try {
        const aliasProfile = await getUserByUsernameOrEmail(identifier);
        if (!aliasProfile?.email) {
          console.warn('[AUTH] login_alias_not_found');
          return res.status(401).json({ success: false, error: 'Invalid email or password.' });
        }
        authEmail = aliasProfile.email.toLowerCase();
      } catch (error: any) {
        console.error('[AUTH] login_alias_database_query_failed', {
          code: getDatabaseErrorCode(error),
        });
        return res.status(503).json({ success: false, error: 'Unable to look up this login. Please try again later.' });
      }
    }

    let authData: any;
    try {
      const result = await supabaseAuthClient.auth.signInWithPassword({ email: authEmail, password });
      if (result.error || !result.data.user || !result.data.session) {
        console.warn('[AUTH] supabase_authentication_failed', {
          code: result.error?.code || 'no_session',
          status: result.error?.status,
        });
        return res.status(401).json({ success: false, error: 'Invalid email or password.' });
      }
      authData = result.data;
      console.info('[AUTH] supabase_login_succeeded', {
        userId: authData.user.id,
        sessionExists: Boolean(authData.session),
      });
    } catch (error: any) {
      console.error('[AUTH] supabase_authentication_request_failed', {
        name: error?.name,
        code: error?.code,
        status: error?.status,
      });
      return res.status(503).json({ success: false, error: 'Supabase Auth is temporarily unavailable.' });
    }

    let user: Awaited<ReturnType<typeof getUserByAuthUserId>>;
    try {
      user = await getUserByAuthUserId(authData.user.id);
    } catch (error: any) {
      console.error('[AUTH] application_profile_database_query_failed', {
        authUserId: authData.user.id,
        code: getDatabaseErrorCode(error),
      });
      return res.status(503).json({ success: false, error: 'Unable to verify the application account right now.' });
    }
    if (!user) {
      console.warn('[AUTH] application_profile_not_found', { authUserId: authData.user.id });
      return res.status(403).json({ success: false, error: 'No application profile is linked to this Supabase account.' });
    }
    if (user.active !== true || user.isActive !== true || user.status !== 'active') {
      console.warn('[AUTH] application_profile_inactive', { authUserId: authData.user.id });
      return res.status(403).json({ success: false, error: 'This application account is inactive.' });
    }
    if (!['super_admin', 'admin', 'focal', 'agent'].includes(user.role)) {
      console.warn('[AUTH] application_profile_role_invalid', { authUserId: authData.user.id, role: user.role });
      return res.status(403).json({ success: false, error: 'This account does not have an authorized application role.' });
    }
    if (requiredRole && user.role !== requiredRole) {
      console.warn('[AUTH] application_profile_role_mismatch', {
        authUserId: authData.user.id,
        actualRole: user.role,
        requiredRole,
      });
      return res.status(403).json({ success: false, error: 'This account does not have Super Administrator privileges.' });
    }
    if (!requiredRole && user.role === 'super_admin') {
      return res.status(403).json({ success: false, error: 'Super Admin accounts must use the restricted Super Admin Gateway.' });
    }

    console.info('[AUTH] login_profile_authorized', {
      userId: authData.user.id,
      profileFound: true,
      role: user.role,
      active: user.active === true,
      status: user.status,
    });

    return res.json({
      success: true,
      user,
      token: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      role: user.role,
      assignedBarangay: user.assignedBarangay,
    });
  };

  app.post('/api/auth/login', handleLogin());
  app.post('/api/auth/superadmin-login', handleLogin('super_admin'));

  app.get('/api/auth/profile', async (req, res) => {
    const authenticated = getUserSecurityContext(req);
    if (!authenticated.isAuthenticated) {
        return res.status(401).json({ success: false, error: 'Authentication required. Please sign in to access this resource.' });
    }
    try {
      const user = await getUserByAuthUserId(authenticated.userId);
      if (!user || user.active !== true || user.isActive !== true || user.status !== 'active') {
          return res.status(403).json({ success: false, error: 'No active application profile is linked to this Supabase account.' });
      }
      return res.json({ success: true, data: user });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Unable to load the application profile.' });
    }
  });

  app.get('/api/auth/superadmin-profile', async (req, res) => {
    const authenticated = getUserSecurityContext(req);
    if (!authenticated.isAuthenticated) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }
    try {
      const user = await getUserByAuthUserId(authenticated.userId);
      if (!user) {
        console.warn('[AUTH] superadmin_profile_not_found', { userId: authenticated.userId });
        return res.status(403).json({ success: false, error: 'No application profile is linked to this Supabase account.' });
      }
      if (user.role !== 'super_admin') {
        console.warn('[AUTH] superadmin_profile_wrong_role', { userId: authenticated.userId, role: user.role });
        return res.status(403).json({ success: false, error: 'This account does not have Super Administrator privileges.' });
      }
      if (user.active !== true || user.isActive !== true || user.status !== 'active') {
        console.warn('[AUTH] superadmin_profile_inactive', {
          userId: authenticated.userId,
          active: user.active === true,
          isActive: user.isActive === true,
          status: user.status,
        });
        return res.status(403).json({ success: false, error: 'This Super Administrator account is inactive.' });
      }
      console.info('[AUTH] superadmin_profile_authorized', {
        userId: authenticated.userId,
        profileFound: true,
        role: user.role,
        active: user.active === true,
        isActive: user.isActive === true,
        status: user.status,
      });
      return res.json({ success: true, data: user });
    } catch (error: any) {
      console.error('[AUTH] superadmin_profile_query_failed', {
        userId: authenticated.userId,
        code: getDatabaseErrorCode(error),
      });
      return res.status(503).json({ success: false, error: 'Unable to verify the Super Admin application profile.' });
    }
  });

  app.patch('/api/auth/profile', async (req, res) => {
    const security = getUserSecurityContext(req);
    if (!security.isAuthenticated) return res.status(401).json({ success: false, error: 'Authentication required.' });
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    if (!name) return res.status(400).json({ success: false, error: 'A profile name is required.' });
    try {
      const current = await getUserByAuthUserId(security.userId);
      if (!current) return res.status(404).json({ success: false, error: 'Application profile not found.' });
      const saved = await upsertUser({ ...current, name, phone });
      return res.json({ success: true, data: saved });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message || 'Unable to save profile to database.' });
    }
  });

  // Enforce role-based endpoint security for Super Admin resources
  app.all(['/admin/landing-page-cms', '/admin/sidebar-configuration'], (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to access this resource.',
      });
    }
    return res.json({ success: true, message: 'Authorized Super Admin resource.' });
  });

  app.all('/admin/registry-form-customization', (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to access this resource.',
      });
    }
    return res.json({ success: true, message: 'Authorized Form Customization resource.' });
  });

  const listAllAuthUsers = async () => {
    if (!supabaseAdminClient) throw new Error(getSupabaseAdminConfigError() || 'Supabase Auth administration is unavailable.');
    const authUsers: Array<{
      id: string;
      email?: string;
      created_at?: string;
      user_metadata?: Record<string, unknown>;
    }> = [];
    const perPage = 1000;
    for (let page = 1; ; page += 1) {
      const { data, error } = await supabaseAdminClient.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      authUsers.push(...data.users.map(authUser => ({
        id: authUser.id,
        email: authUser.email,
        created_at: authUser.created_at,
        user_metadata: authUser.user_metadata as Record<string, unknown> | undefined,
      })));
      if (data.users.length < perPage) break;
    }
    return authUsers;
  };

  // Get application profiles merged with Supabase Auth users (Admin/Super Admin).
  app.get('/api/accounts', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }

    if (!supabaseAdminClient) {
      return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
    }

    try {
      const allProfiles = await getAllUsers();
      let authUsers;
      try {
        authUsers = await listAllAuthUsers();
      } catch (error: any) {
        console.error('[ACCOUNTS] auth_user_list_failed', { code: error?.code || 'list_failed', status: error?.status });
        return res.status(502).json({ success: false, error: 'Unable to retrieve users from Supabase Auth.' });
      }

      const profilesByAuthId = new Map(
        allProfiles.filter(profile => profile.authUserId).map(profile => [profile.authUserId as string, profile])
      );
      const authIds = new Set(authUsers.map(authUser => authUser.id));
      const visibleAuthUsers = user.isSuperAdmin
        ? authUsers
        : authUsers.filter(authUser =>
            profilesByAuthId.get(authUser.id)?.role !== 'super_admin' && authUser.user_metadata?.role !== 'super_admin'
          );
      const merged = visibleAuthUsers.map(authUser => {
        const profile = profilesByAuthId.get(authUser.id);
        if (profile) return { ...profile, hasProfile: true };

        const metadata = authUser.user_metadata || {};
        const email = authUser.email || '';
        const username = typeof metadata.username === 'string'
          ? metadata.username
          : (email.includes('@') ? email.slice(0, email.indexOf('@')) : authUser.id);
        const metadataName = typeof metadata.full_name === 'string'
          ? metadata.full_name
          : typeof metadata.name === 'string'
          ? metadata.name
          : '';
        return {
          id: authUser.id,
          authUserId: authUser.id,
          username,
          email,
          name: metadataName || email || authUser.id,
          role: 'focal' as const,
          active: false,
          isActive: false,
          status: 'pending' as const,
          permissions: [],
          createdAt: authUser.created_at || new Date(0).toISOString(),
          hasProfile: false,
          contactNo: '',
          phone: '',
        };
      });
      const legacyProfiles = allProfiles
        .filter(profile => (user.isSuperAdmin || profile.role !== 'super_admin') && (!profile.authUserId || !authIds.has(profile.authUserId)))
        .map(profile => ({ ...profile, hasProfile: true }));
      const result = [...merged, ...legacyProfiles];
      return res.json({ success: true, count: result.length, data: result });
    } catch (err: any) {
      console.error('Error fetching accounts from database:', err);
      return res.status(500).json({ success: false, error: 'Unable to retrieve user accounts from database.' });
    }
  });

  app.get('/api/users', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }
    try {
      const allUsers = await getAllUsers();
      return res.json({ success: true, count: allUsers.length, data: allUsers });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Unable to retrieve user accounts from database.' });
    }
  });

  const inviteAuthUser = async (email: string, metadata: Record<string, unknown>) => {
    if (!supabaseAdminClient) throw new Error(getSupabaseAdminConfigError() || 'Supabase Auth administration is unavailable.');
    const allAuthUsers = await listAllAuthUsers();
    const existingAuthUser = allAuthUsers.find(user => user.email?.toLowerCase() === email.toLowerCase());
    if (existingAuthUser) return existingAuthUser.id;
    const { data, error } = await supabaseAdminClient.auth.admin.inviteUserByEmail(email, { data: metadata });
    if (error || !data.user) throw error || new Error('Supabase Auth did not return the invited user.');
    return data.user.id;
  };

  // Create a Supabase Auth user and its application profile.
  app.post('/api/accounts', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isAdmin) {
      return res.status(403).json({ success: false, error: 'You are not authorized to manage system accounts.' });
    }

    const payload = req.body;
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    const username = typeof payload?.username === 'string' ? payload.username.trim().toLowerCase() : '';
    const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
    const role = String(payload?.role || '');
    const initialPassword = typeof payload?.initialPassword === 'string' ? payload.initialPassword : '';
    const confirmPassword = typeof payload?.confirmPassword === 'string' ? payload.confirmPassword : '';
    const assignedBarangay = typeof payload?.assignedBarangay === 'string' ? payload.assignedBarangay.trim() : '';

    if (!name || !username || !email) {
      return res.status(400).json({ success: false, error: 'Full name, username, and email are required.' });
    }
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      return res.status(400).json({ success: false, error: 'Username must be 3-40 characters using letters, numbers, dots, underscores, or hyphens.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Enter a valid email address.' });
    }
    if (!['super_admin', 'admin', 'focal', 'agent'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Unsupported user role.' });
    }
    if (role === 'super_admin' && !admin.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'Administrators cannot create Super Admin accounts.' });
    }
    if (role === 'focal' && !HINUNANGAN_BARANGAYS.some(b => b.name.toLowerCase() === assignedBarangay.toLowerCase())) {
      return res.status(400).json({ success: false, error: 'Select a valid designated barangay for a Focal Person.' });
    }
    if (initialPassword.length < 12 ||
      !/[a-z]/.test(initialPassword) ||
      !/[A-Z]/.test(initialPassword) ||
      !/\d/.test(initialPassword) ||
      !/[^A-Za-z0-9]/.test(initialPassword)) {
      return res.status(400).json({ success: false, error: 'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol characters.' });
    }
    if (initialPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Password and confirmation do not match.' });
    }
    if (typeof payload.active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Account active status is required.' });
    }
    if (!supabaseAdminClient) {
      console.error('[ACCOUNTS] supabase_admin_client_unavailable');
      return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
    }

    let createdAuthUserId: string | null = null;
    try {
      const [usernameProfile, emailProfile, authUsers] = await Promise.all([
        getUserByUsernameOrEmail(username),
        getUserByUsernameOrEmail(email),
        listAllAuthUsers(),
      ]);
      const usernameExistsInAuth = authUsers.some(authUser =>
        String(authUser.user_metadata?.username || '').trim().toLowerCase() === username
      );
      if (usernameProfile || usernameExistsInAuth) {
        return res.status(409).json({ success: false, error: 'That username is already in use.' });
      }
      if (emailProfile || authUsers.some(authUser => authUser.email?.toLowerCase() === email)) {
        return res.status(409).json({ success: false, error: 'That email is already registered.' });
      }

      const { data: authResult, error: authError } = await supabaseAdminClient.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: { username, full_name: name },
      });
      if (authError || !authResult.user) {
        console.error('[ACCOUNTS] auth_user_creation_failed', { code: authError?.code || 'user_missing' });
        return res.status(400).json({ success: false, error: authError?.message || 'Unable to create the Supabase Auth user.' });
      }
      createdAuthUserId = authResult.user.id;

      const saved = await insertUserProfile({
        uid: username,
        username,
        email,
        authUserId: authResult.user.id,
        name,
        role: role as any,
        assignedBarangay: role === 'focal' ? assignedBarangay : undefined,
        phone: typeof payload.contactNo === 'string' ? payload.contactNo.trim() : '',
        active: payload.active,
        isActive: payload.active,
        status: payload.active ? 'active' : 'inactive',
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      });
      createdAuthUserId = null;
      return res.status(201).json({ success: true, data: saved });
    } catch (err: any) {
      let rollbackFailed = false;
      if (createdAuthUserId && supabaseAdminClient) {
        const { error: rollbackError } = await supabaseAdminClient.auth.admin.deleteUser(createdAuthUserId);
        if (rollbackError) {
          rollbackFailed = true;
          console.error('[ACCOUNTS] auth_user_rollback_failed', {
            authUserId: createdAuthUserId,
            code: rollbackError.code || 'delete_failed',
          });
        }
      }
      console.error('[ACCOUNTS] account_creation_failed', {
        authUserId: createdAuthUserId,
        code: err?.code || err?.cause?.code || 'profile_insert_failed',
      });
      return res.status(500).json({
        success: false,
        error: rollbackFailed
          ? 'Profile creation failed and Supabase Auth cleanup could not be confirmed. Contact the system administrator.'
          : 'Failed to create the account profile. The newly created Supabase Auth user was removed.',
      });
    }
  });

  app.post('/api/accounts/:id/reset-password', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You are not authorized to manage system accounts.' });
    }
    if (!supabaseAdminClient) {
      return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
    }

    const password = typeof req.body?.initialPassword === 'string' ? req.body.initialPassword : '';
    const confirmation = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      return res.status(400).json({ success: false, error: 'Password must be at least 12 characters and include uppercase, lowercase, number, and symbol characters.' });
    }
    if (password !== confirmation) {
      return res.status(400).json({ success: false, error: 'Password and confirmation do not match.' });
    }

    try {
      const target = await getUserByUsernameOrEmail(req.params.id);
      let authUserId = target?.authUserId;
      if (!target && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) {
        const { data, error } = await supabaseAdminClient.auth.admin.getUserById(req.params.id);
        if (error || !data.user) return res.status(404).json({ success: false, error: 'Supabase Auth user not found.' });
        authUserId = data.user.id;
      }
      if (!authUserId) {
        return res.status(409).json({ success: false, error: 'This account is not linked to a Supabase Auth user.' });
      }
      const { error } = await supabaseAdminClient.auth.admin.updateUserById(authUserId, { password });
      if (error) {
        console.error('[ACCOUNTS] auth_password_reset_failed', {
          authUserId,
          code: error.code || 'update_failed',
        });
        return res.status(502).json({ success: false, error: 'Supabase Auth could not reset this account password.' });
      }
      console.info('[ACCOUNTS] auth_password_reset_succeeded', { authUserId });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[ACCOUNTS] password_reset_request_failed', {
        code: err?.code || err?.cause?.code || 'profile_lookup_failed',
      });
      return res.status(500).json({ success: false, error: 'Unable to reset this account password.' });
    }
  });

  app.put('/api/accounts/:id', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }

    const { id } = req.params;
    try {
      const current = await getUserByUsernameOrEmail(id);
      if (!current) return res.status(404).json({ success: false, error: 'User profile not found.' });
      if (current.role === 'super_admin' && !admin.isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'Only a Super Admin can modify a Super Admin account.' });
      }
      const payload = { ...req.body, id, authUserId: current.authUserId };
      if (payload.role === 'super_admin' && !admin.isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'Administrators cannot assign the Super Admin role.' });
      }
      if (!current.authUserId) {
        payload.authUserId = await inviteAuthUser(String(payload.email || current.email).trim().toLowerCase(), {
          username: payload.username || current.username,
          full_name: payload.name || payload.fullName || current.name,
        });
      } else if (payload.email && payload.email.toLowerCase() !== current.email.toLowerCase()) {
        if (!supabaseAdminClient) return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
        const { error } = await supabaseAdminClient.auth.admin.updateUserById(current.authUserId, { email: payload.email });
        if (error) throw error;
      }
      payload.status = payload.active === false ? 'inactive' : 'active';
      payload.isActive = payload.active !== false;
      const saved = await upsertUser(payload);
      return res.json({ success: true, data: saved });
    } catch (err: any) {
      console.error('Error updating user account:', err);
      return res.status(500).json({ success: false, error: err?.message || 'Failed to update user account in database.' });
    }
  });

  app.delete('/api/accounts/:id', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }

    const { id } = req.params;
    try {
      const target = await getUserByUsernameOrEmail(id);
      if (target?.role === 'super_admin' && !admin.isSuperAdmin) {
        return res.status(403).json({ success: false, error: 'Only a Super Admin can remove a Super Admin account.' });
      }
      let authUserId = target?.authUserId;
      if (!target && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        if (!admin.isSuperAdmin) {
          return res.status(403).json({ success: false, error: 'Only a Super Admin can remove an Auth user without an application profile.' });
        }
        authUserId = id;
      }
      if (authUserId) {
        if (!supabaseAdminClient) {
          return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
        }
        const { error } = await supabaseAdminClient.auth.admin.deleteUser(authUserId);
        if (error) throw error;
      }
      await deleteUserByUid(id);
      return res.json({ success: true, message: 'User account removed from database.' });
    } catch (err: any) {
      console.error('Error deleting user account:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete user account from database.' });
    }
  });

  const sharedModuleDataKeys = new Set([
    'biosecurity_audits',
    'biosecurity_incidents',
    'official_reports_config',
    'certificate_config',
    'certificate_templates',
  ]);
  const sharedModuleArrayKeys = new Set([
    'biosecurity_audits',
    'biosecurity_incidents',
    'certificate_templates',
  ]);
  const adminOnlyModuleDataKeys = new Set([
    'official_reports_config',
    'certificate_config',
  ]);

  app.get('/api/module-data/:key', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAuthenticated || !sharedModuleDataKeys.has(req.params.key)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }
    try {
      if (req.params.key === 'certificate_templates') {
        const templates = await getCertificateTemplates();
        const visibleTemplates = filterCertificateTemplatesForUser(templates, user);
        const signedTemplates = await Promise.all(
          visibleTemplates.map(template => signTemplateAssetUrls(template, user))
        );
        return res.json({ success: true, data: signedTemplates });
      }
      let value = await getStoredSystemSetting(req.params.key);
      return res.json({ success: true, data: value ?? (sharedModuleArrayKeys.has(req.params.key) ? [] : {}) });
    } catch (error) {
      const failure = formatCertificateTemplateDatabaseError(error);
      console.error('[module-data] load failed', {
        key: req.params.key,
        code: failure.code,
        detail: error instanceof Error ? error.message.slice(0, 500) : 'Unknown database error',
      });
      return res.status(500).json({
        success: false,
        error: req.params.key === 'certificate_templates'
          ? failure.message
          : 'Unable to load module data from database.',
        ...(req.params.key === 'certificate_templates' && failure.code ? { diagnosticCode: failure.code } : {}),
      });
    }
  });

  app.put('/api/module-data/:key', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!sharedModuleDataKeys.has(req.params.key) ||
      (req.params.key === 'certificate_templates'
        ? !(user.isAdmin || user.isFocal)
        : adminOnlyModuleDataKeys.has(req.params.key) ? !user.isAdmin : !user.isAuthenticated)) {
      return res.status(403).json({ success: false, error: 'You do not have permission to update this resource.' });
    }
    if (req.body?.data === undefined) {
      return res.status(400).json({ success: false, error: 'Module data is required.' });
    }
    if (req.params.key === 'certificate_templates' &&
      (typeof req.body.data !== 'object' || req.body.data === null || Array.isArray(req.body.data))) {
      return res.status(400).json({ success: false, error: 'A single certificate template is required.' });
    }
    if (sharedModuleArrayKeys.has(req.params.key) && req.params.key !== 'certificate_templates' && !Array.isArray(req.body.data)) {
      return res.status(400).json({ success: false, error: 'This module data must be an array.' });
    }
    if (!sharedModuleArrayKeys.has(req.params.key) && (typeof req.body.data !== 'object' || req.body.data === null || Array.isArray(req.body.data))) {
      return res.status(400).json({ success: false, error: 'This module data must be an object.' });
    }
    try {
      const saved = req.params.key === 'certificate_templates'
        ? await saveCertificateTemplate(req.body.data, {
          role: user.role,
          assignedBarangay: user.assignedBarangay,
          isAdmin: user.isAdmin,
        })
        : await setSystemSetting(req.params.key, req.body.data);
      if (req.params.key === 'certificate_templates') {
        return res.json({ success: true, data: await signTemplateAssetUrls(saved, user) });
      }
      const confirmed = await getStoredSystemSetting(req.params.key);
      if (confirmed === null) throw new Error('Database did not return the saved module data.');
      return res.json({ success: true, data: confirmed ?? saved       });

      app.post('/api/certificate-assets/upload', async (req, res) => {
        const user = getUserSecurityContext(req);
        if (!user.isAdmin && !user.isFocal) {
          return res.status(403).json({ success: false, error: 'Only Admin, Super Admin, or Focal Person accounts can upload certificate images.' });
        }
        if (!supabaseAdminClient) {
          return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
        }
        const { fileName, base64, mimeType } = req.body || {};
        if (typeof fileName !== 'string' || typeof base64 !== 'string' || typeof mimeType !== 'string') {
          return res.status(400).json({ success: false, error: 'An image file, filename, and MIME type are required.' });
        }
        try {
          const asset = await uploadCertificateAsset(
            supabaseAdminClient,
            fileName,
            mimeType,
            base64,
            { isAdmin: user.isAdmin, assignedBarangay: user.assignedBarangay }
          );
          return res.status(201).json({ success: true, data: asset });
        } catch (error) {
          console.error('[certificate-assets] upload failed', {
            userId: user.userId,
            role: user.role,
            detail: error instanceof Error ? error.message.slice(0, 300) : 'Unknown storage error',
          });
          const message = error instanceof Error ? error.message : 'Unable to upload the certificate image.';
          const status = /image|mime|payload|15 MB|assigned barangay/i.test(message) ? 400 : 500;
          return res.status(status).json({ success: false, error: message });
        }
      });
    } catch (error) {
      const failure = formatCertificateTemplateDatabaseError(error);
      console.error('[module-data] save failed', {
        key: req.params.key,
        code: failure.code,
        detail: error instanceof Error ? error.message.slice(0, 500) : 'Unknown database error',
      });
      return res.status(failure.code === '403' ? 403 : failure.code === '409' ? 409 : 500).json({
        success: false,
        error: req.params.key === 'certificate_templates'
          ? `Unable to save certificate templates. ${failure.message}`
          : 'Unable to save module data to database.',
        ...(req.params.key === 'certificate_templates' && failure.code ? { diagnosticCode: failure.code } : {}),
      });
    }
  });

  // =========================================================================
  // 2. SWINE RECORDS - STRICT DATABASE SOURCE OF TRUTH
  // =========================================================================

  // Next authoritative Pig ID Generator
  // Next authoritative Pig ID Generator using atomic database sequence
  app.get('/api/swine-records/next-id', async (_req, res) => {
    try {
      const nextPigId = await getNextAuthoritativePigIdTag();
      return res.json({ success: true, nextPigId });
    } catch (err: any) {
      console.error('Error generating next pig ID:', err);
      const fallbackSeq = String(Math.floor(1000 + Math.random() * 9000));
      return res.json({ success: true, nextPigId: `HIN-${new Date().getFullYear()}-${fallbackSeq}` });
    }
  });

  // Helper handler for GET /api/swine-records and /api/swine
  const handleGetSwineRecords = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    const requestedBarangay =
      (req.query.filter_barangay as string) ||
      (req.query.barangay as string) ||
      (req.query.barangayId as string);
    const search = req.query.search as string;
    const status = req.query.status as string;
    const farmerId = req.query.farmerId as string | undefined;
    const readyToSell = req.query.readyToSell !== undefined ? req.query.readyToSell === 'true' : (user.isAgent ? true : undefined);
    const isArchived = req.query.isArchived !== undefined ? req.query.isArchived === 'true' : false;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
    const perPage = req.query.per_page || req.query.perPage ? parseInt((req.query.per_page || req.query.perPage) as string, 10) : undefined;

    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Your account must be assigned to a barangay to view records.' });
    }

    if (farmerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(farmerId)) {
      return res.status(400).json({ success: false, error: 'Invalid farmer ID.' });
    }

    // Security check: non-admins cannot query other barangays or 'all'
    if (!user.isAdmin && !user.isAgent) {
      if (
        requestedBarangay &&
        requestedBarangay !== 'all' &&
        requestedBarangay !== user.barangayId &&
        requestedBarangay.toLowerCase() !== user.assignedBarangay.toLowerCase()
      ) {
        return res.status(403).json({
          success: false,
          error: `Access Denied: You are not authorized to view swine records outside your assigned barangay (${user.assignedBarangay || user.barangayId}).`,
        });
      }

      if (requestedBarangay === 'all') {
        return res.status(403).json({
          success: false,
          error: 'Access Denied: Non-admin users cannot query swine records for all barangays.',
        });
      }
    }

    const effectiveBarangay = (user.isAdmin || user.isAgent)
      ? (requestedBarangay && requestedBarangay !== 'all' ? requestedBarangay : undefined)
      : (user.assignedBarangay || user.barangayId);

    try {
      const { records, total } = await getAllSwineRecords({
        barangay: effectiveBarangay,
        farmerId,
        search,
        status,
        readyToSell,
        isArchived,
        page,
        perPage,
      });

      return res.json({
        success: true,
        count: records.length,
        total,
        data: records,
        scope: user.isAdmin ? (effectiveBarangay || 'all_permitted') : (user.assignedBarangay || user.barangayId),
      });
    } catch (err: any) {
      console.error('Database query error in swine records endpoint:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to connect to the Swine Registry database. Please check the backend connection.',
      });
    }
  };

  app.get('/api/swine-records', handleGetSwineRecords);
  app.get('/api/swine', handleGetSwineRecords);

  // Single Swine Record Access API
  const handleGetSingleSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    const { id } = req.params;

    try {
      const swine = await getSwineRecordById(id);
      if (!swine) {
        return res.status(404).json({ success: false, error: 'Swine record not found.' });
      }

      if (!user.isAdmin && !user.isAgent) {
        const matchId = Boolean(swine.barangay_id && user.barangayId && swine.barangay_id === user.barangayId);
        const matchName = Boolean(
          swine.barangay && user.assignedBarangay && swine.barangay.toLowerCase() === user.assignedBarangay.toLowerCase()
        );
        if (!matchId && !matchName) {
          return res.status(403).json({
            success: false,
            error: `Access Denied: You are not authorized to view this swine record from Barangay ${swine.barangay}. It is restricted to officers of that barangay.`,
          });
        }
      }

      return res.json({ success: true, data: swine, record: swine });
    } catch (err: any) {
      console.error('Error fetching single swine record:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to connect to the Swine Registry database. Please check the backend connection.',
      });
    }
  };

  app.get('/api/swine-records/:id', handleGetSingleSwine);
  app.get('/api/swine/:id', handleGetSingleSwine);

  // Create Swine Record API
  const handleCreateSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (user.isAgent) {
      return res.status(403).json({ success: false, error: 'Access Denied: Agent accounts are view-only.' });
    }
    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Your account must be assigned to a barangay before registering records.' });
    }

    const record = req.body;
    if (!record || typeof record !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid record payload' });
    }

    const { farmerContact, pigIdTag, earTagNo, birthDate } = record;
    if (farmerContact && !isValidPhilippinePhoneNumber(farmerContact)) {
      return res.status(400).json({
        success: false,
        field: 'farmerContact',
        error: 'Contact number must contain exactly 10 digits after +63. Example: +63 912 591 8781.',
      });
    }
    if (farmerContact) record.farmerContact = normalizePhilippinePhoneNumber(farmerContact);

    let tag = (pigIdTag || earTagNo || '').trim();
    if (!tag) {
      // Auto-generate authoritative ID if not supplied
      const currentYear = new Date().getFullYear();
      const { total } = await getAllSwineRecords();
      tag = `HIN-${currentYear}-${String(total + 1).padStart(4, '0')}`;
      // Auto-generate authoritative ID atomically from database sequence
      tag = await getNextAuthoritativePigIdTag();
    }

    if (tag && !PIG_ID_TAG_REGEX.test(tag)) {
      return res.status(400).json({
        success: false,
        field: 'pigIdTag',
        error: 'Invalid Pig ID Tag format. Expected format: HIN-YYYY-XXXX (e.g. HIN-2026-0001).',
      });
    }

    const effectiveBirthDate = birthDate || record.date_of_birth || record.dateOfBirth || record.dob;
    if (effectiveBirthDate) {
      const bDate = new Date(effectiveBirthDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (bDate.getTime() > today.getTime()) {
        return res.status(400).json({
          success: false,
          field: 'birthDate',
          error: 'Date of birth cannot be in the future.',
        });
      }
    }

    if (user.isFocal) {
      if (record.barangay && record.barangay.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase()) {
        return res.status(403).json({
          success: false,
          error: `Forbidden: Focal persons can only register swine records for their assigned barangay (${user.assignedBarangay}).`
        });
      }
      record.barangay = user.assignedBarangay;
      if (user.barangayId) record.barangay_id = user.barangayId;
    }

    const newRec = {
      ...record,
      id: record.id || `swine-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      pigIdTag: tag,
      earTagNo: tag,
      registeredBy: user.username,
      registeredAt: record.registeredAt || new Date().toISOString(),
    };

    try {
      const saved = await upsertSwineRecord(newRec);
      return res.status(201).json({ success: true, data: saved, record: saved });
    } catch (err: any) {
      const code = err?.code || err?.cause?.code || getDatabaseErrorCode(err);
      const message = err?.message || err?.cause?.message || 'Database save failed.';
      const detail = err?.detail || err?.cause?.detail;
      const hint = err?.hint || err?.cause?.hint;

      console.error('[SWINE SAVE ERROR]', {
        code,
        message,
        detail,
        hint,
        table: err?.table || err?.cause?.table,
        column: err?.column || err?.cause?.column,
      });

      return res.status(500).json({
        success: false,
        error: code ? `Database save failed (${code}): ${message}` : message,
        ...(code ? { database_error_code: code } : {}),
        ...(detail ? { database_error_detail: detail } : {}),
        ...(hint ? { database_error_hint: hint } : {}),
      });
    }
  };

  app.post('/api/swine-records', handleCreateSwine);
  app.post('/api/swine', handleCreateSwine);

  // Update Swine Record API
  const handleUpdateSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (user.isAgent) {
      return res.status(403).json({ success: false, error: 'Access Denied: Agent accounts are view-only.' });
    }
    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Your account must be assigned to a barangay before updating records.' });
    }

    const { id } = req.params;
    const record = req.body;

    const { farmerContact, birthDate } = record || {};
    if (farmerContact && !isValidPhilippinePhoneNumber(farmerContact)) {
      return res.status(400).json({
        success: false,
        field: 'farmerContact',
        error: 'Contact number must contain exactly 10 digits after +63 and start with 9 (e.g. +63 912 345 6789).',
      });
    }
    if (farmerContact) record.farmerContact = normalizePhilippinePhoneNumber(farmerContact);

    const effectiveBirthDate = birthDate || record.date_of_birth || record.dateOfBirth || record.dob;
    if (effectiveBirthDate) {
      const bDate = new Date(effectiveBirthDate);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (bDate.getTime() > today.getTime()) {
        return res.status(400).json({
          success: false,
          field: 'birthDate',
          error: 'Date of birth cannot be in the future.',
        });
      }
    }

    try {
      const existing = await getSwineRecordById(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Swine record not found.' });
      }

      if (user.isFocal) {
        if (existing.barangay && existing.barangay.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase()) {
          return res.status(403).json({
            success: false,
            error: `Forbidden: Focal persons cannot modify records outside their assigned barangay (${user.assignedBarangay}).`
          });
        }
        if (record.barangay && record.barangay.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase()) {
          return res.status(403).json({
            success: false,
            error: `Forbidden: Focal persons cannot reassign records to another barangay.`
          });
        }
      }

      // Preserve immutable Pig ID
      const preservedPigId = existing.pigIdTag || (existing as any).computedPigId || existing.earTagNo;
      const updated = {
        ...existing,
        ...record,
        id,
        farmerId: record.farmerId ?? existing.farmerId,
        pigIdTag: preservedPigId || record.pigIdTag,
        earTagNo: preservedPigId || record.earTagNo,
      };

      const saved = await upsertSwineRecord(updated);
      return res.json({ success: true, data: saved, record: saved });
    } catch (err: any) {
      console.error('Error updating swine record in database:', err);
      const databaseErrorCode = getDatabaseErrorCode(err);
      return res.status(500).json({
        success: false,
        error: databaseErrorCode
          ? `Database save failed (PostgreSQL ${databaseErrorCode}).`
          : 'Unable to connect to the Swine Registry database. Please check the backend connection.',
        ...(databaseErrorCode ? { database_error_code: databaseErrorCode } : {}),
      });
    }
  };

  app.put('/api/swine-records/:id', handleUpdateSwine);
  app.put('/api/swine/:id', handleUpdateSwine);

  // Toggle Sell Status API
  const handleToggleSell = async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const { readyToSell, priceEstimate } = req.body || {};

    try {
      const existing = await getSwineRecordById(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Swine record not found.' });
      }

      const updated = {
        ...existing,
        readyToSell: Boolean(readyToSell),
        status: readyToSell ? 'ready_to_sell' : (existing.status === 'ready_to_sell' ? 'healthy' : existing.status),
        priceEstimate: priceEstimate !== undefined ? String(priceEstimate) : existing.estimatedPricePhp,
      };

      const saved = await upsertSwineRecord(updated);
      return res.json({ success: true, data: saved, record: saved });
    } catch (err: any) {
      console.error('Error updating sell status:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to connect to the Swine Registry database. Please check the backend connection.',
      });
    }
  };

  app.patch('/api/swine-records/:id/sell', handleToggleSell);
  app.patch('/api/swine/:id/sell', handleToggleSell);

  // Delete Swine Record API (Admin only)
  const handleDeleteSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access Denied: Only administrators can delete swine records.' });
    }
    const { id } = req.params;
    try {
      await deleteSwineRecordById(id);
      return res.json({ success: true, message: 'Swine record deleted successfully.' });
    } catch (err: any) {
      console.error('Error deleting swine record:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to connect to the Swine Registry database. Please check the backend connection.',
      });
    }
  };

  app.delete('/api/swine-records/:id', handleDeleteSwine);
  app.delete('/api/swine/:id', handleDeleteSwine);

  // Bulk Delete Swine Records API (Admin only)
  const handleBulkDeleteSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access Denied: Only administrators can delete swine records.' });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or empty IDs list.' });
    }
    try {
      const deletedCount = await deleteSwineRecordsByIds(ids);
      return res.json({ success: true, deletedCount });
    } catch (err: any) {
      console.error('Error bulk deleting swine records:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to connect to the Swine Registry database. Please check the backend connection.',
      });
    }
  };

  app.post('/api/swine-records/bulk-delete', handleBulkDeleteSwine);
  app.post('/api/swine/bulk-delete', handleBulkDeleteSwine);

  // Batch Import Swine Records API
  const handleBatchImportSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (user.isAgent) {
      return res.status(403).json({ success: false, error: 'Access Denied: Agent accounts cannot import records.' });
    }

    const { records, fileName, duplicateHandling, newFieldsCreated } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ success: false, error: 'No swine records provided for import.' });
    }
    if (records.some((record: any) => !record || typeof record !== 'object' || Array.isArray(record))) {
      return res.status(400).json({ success: false, error: 'Import records must be JSON objects.' });
    }
    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Your account must be assigned to a barangay before importing records.' });
    }
    if (user.isFocal && records.some((record: any) => record.barangay &&
      record.barangay.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase())) {
      return res.status(403).json({ success: false, error: 'Focal persons can only import records for their assigned barangay.' });
    }
    const scopedRecords = user.isFocal
      ? records.map((record: any) => ({
          ...record,
          barangay: user.assignedBarangay,
          barangay_id: user.barangayId || record.barangay_id,
        }))
      : records;

    try {
      // Priority 8: Auto-register unknown JSON fields as dynamic registry fields without altering PostgreSQL columns
      try {
        const knownBaseKeys = new Set([
          'id', 'computedPigId', 'computed_pig_id', 'pigIdTag', 'pig_id_tag',
          'earTagNo', 'ear_tag_no', 'farmerName', 'farmer_name', 'farmName', 'farm_name',
          'farmerContact', 'farmer_contact', 'farmerAddress', 'farmer_address',
          'barangay', 'barangay_id', 'birthDate', 'birth_date', 'dateOfBirth', 'date_of_birth',
          'dob', 'ageDays', 'age_days', 'ageMonths', 'age_months', 'estimatedWeightKg', 'estimated_weight_kg',
          'actualWeightKg', 'actual_weight_kg', 'weightKg', 'weight_kg', 'swineType', 'swine_type',
          'farmScale', 'farm_scale', 'farmType', 'farm_type', 'asfZone', 'asf_zone',
          'biosecurityWarning', 'biosecurity_warning', 'status', 'readyToSell', 'ready_to_sell',
          'priceEstimate', 'price_estimate', 'estimatedPricePhp', 'photoUrl', 'photo_url',
          'isArchived', 'is_archived', 'registeredAt', 'registered_at', 'registeredBy', 'registered_by',
          'createdAt', 'created_at', 'updatedAt', 'updated_at', 'customFields', 'custom_fields',
          'biosecurity', 'notes', 'breed', 'gender', 'latitude', 'longitude', 'penCapacity',
          'rsbsaId', 'registry_id', 'isSynced', 'age', 'setbackCompliant',
          'distanceToWaterSourceMeters', 'distanceToTourismSchoolMeters', 'distanceToBuiltUpMeters'
        ]);

        const incomingUnknownKeys = new Set<string>();
        for (const rec of scopedRecords) {
          if (rec && typeof rec === 'object') {
            for (const key of Object.keys(rec)) {
              if (!knownBaseKeys.has(key) && rec[key] !== undefined && typeof rec[key] !== 'function') {
                incomingUnknownKeys.add(key);
              }
            }
            if (rec.customFields && typeof rec.customFields === 'object' && !Array.isArray(rec.customFields)) {
              for (const cKey of Object.keys(rec.customFields)) {
                if (!knownBaseKeys.has(cKey)) {
                  incomingUnknownKeys.add(cKey);
                }
              }
            }
          }
        }

        if (incomingUnknownKeys.size > 0) {
          const existingDbFields = await getAllSchemaFieldsFromDb();
          const existingKeys = new Set(existingDbFields.map(f => f.fieldKey.toLowerCase()));
          const existingIds = new Set(existingDbFields.map(f => f.id.toLowerCase()));

          for (const rawKey of incomingUnknownKeys) {
            const fieldKey = toFieldKey(rawKey);
            const fieldId = `field_${fieldKey}`;
            if (!existingKeys.has(fieldKey.toLowerCase()) && !existingIds.has(fieldId.toLowerCase())) {
              const sampleVal = scopedRecords.find((r: any) => r[rawKey] !== undefined)?.[rawKey];
              const fieldType = typeof sampleVal === 'number' ? 'number' : typeof sampleVal === 'boolean' ? 'boolean' : 'text';
              const label = rawKey
                .replace(/([A-Z])/g, ' $1')
                .replace(/[_-]/g, ' ')
                .trim()
                .replace(/^\w/, c => c.toUpperCase());

              await upsertSchemaFieldInDb({
                id: fieldId,
                fieldKey,
                label,
                fieldType,
                required: false,
                visible: true,
                sectionId: 'sec_custom',
                sectionTitle: 'Dynamic Custom Fields',
                fieldOrder: existingDbFields.length + 1,
              });
            }
          }
        }
      } catch (schemaErr) {
        console.warn('Auto-registering dynamic fields notice:', schemaErr);
      }

      const savedRecords = await batchUpsertSwineRecords(scopedRecords);

      // Record audit history if system settings table is available
      try {
        const histKey = 'swine_import_audit_history';
        const existingHist = (await getSystemSetting(histKey)) || [];
        const newHistEntry = {
          batchId: `BATCH-${Date.now()}`,
          fileName: fileName || 'Import.xlsx',
          importedBy: user.username || 'System Admin',
          importedAt: new Date().toISOString(),
          recordCount: savedRecords.length,
          newFields: newFieldsCreated || [],
          duplicatePolicy: duplicateHandling || 'update',
        };
        await setSystemSetting(histKey, [newHistEntry, ...(Array.isArray(existingHist) ? existingHist.slice(0, 30) : [])]);
      } catch (histErr) {
        console.warn('Import audit history recording notice:', histErr);
      }

      return res.status(200).json({
        success: true,
        count: savedRecords.length,
        data: savedRecords,
        message: `Successfully imported ${savedRecords.length} swine records.`,
      });
    } catch (err: any) {
      console.error('Error in batch import swine API:', err);
      return res.status(500).json({
        success: false,
        error: 'Database import failed. Please check the backend connection.',
      });
    }
  };

  app.post('/api/swine-records/import', handleBatchImportSwine);
  app.post('/api/swine/import', handleBatchImportSwine);

  // =========================================================================
  // 3. FARMERS API (DATABASE-DERIVED)
  // 3. FARMERS API (DATABASE-DERIVED, STRICTLY AUTHENTICATED & RBAC SCOPED)
  // =========================================================================
  app.get('/api/farmers', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAuthenticated) {
      return res.status(401).json({ success: false, error: 'Authentication required to view farmer registry.' });
    }

    if (user.isAgent) {
      return res.status(403).json({ success: false, error: 'Access Denied: Agents are not authorized to access farmer PII records.' });
    }

    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Access Denied: Focal person has no assigned barangay.' });
    }

    const requestedBarangay = (req.query.barangay as string) || (req.query.filter_barangay as string);
    if (!user.isAdmin) {
      if (
        requestedBarangay &&
        requestedBarangay !== 'all' &&
        requestedBarangay.toLowerCase() !== (user.assignedBarangay || '').toLowerCase()
      ) {
        return res.status(403).json({
          success: false,
          error: `Access Denied: You are not authorized to view farmer records outside your assigned barangay (${user.assignedBarangay}).`,
        });
      }
    }

    const effectiveBarangay = user.isAdmin
      ? (requestedBarangay && requestedBarangay !== 'all' ? requestedBarangay : undefined)
      : (user.assignedBarangay || user.barangayId);

    try {
      const { records } = await getAllSwineRecords({
        barangay: effectiveBarangay,
      });

      const farmerMap: Record<string, any> = {};

      records.forEach(r => {
        const key = r.farmerId ||
          `${(r.farmerName || '').trim().toLowerCase()}_${(r.farmerContact || '').replace(/\D/g, '')}_${(r.barangay || '').trim().toLowerCase()}`;
        if (!farmerMap[key]) {
          farmerMap[key] = {
            id: r.farmerId || key,
            farmerId: r.farmerId,
            farmerName: r.farmerName,
            contactNumber: r.farmerContact || 'Not provided',
            address: r.farmerAddress || r.farmName || r.barangay,
            barangay: r.barangay,
            barangayId: r.barangay_id,
            farmScale: r.farmScale,
            farmType: r.farmType,
            swineCount: 0,
            readyToSellCount: 0,
            pigs: [],
            biosecurity: r.biosecurity,
            status: 'ACTIVE',
            registeredAt: r.registeredAt,
          };
        }
        farmerMap[key].swineCount += 1;
        if (r.readyToSell || r.status === 'ready_to_sell') {
          farmerMap[key].readyToSellCount += 1;
        }
        farmerMap[key].pigs.push({
          id: r.id,
          pigIdTag: r.pigIdTag,
          breed: r.breed,
          swineType: r.swineType,
          status: r.status,
          readyToSell: r.readyToSell,
        });
      });

      const farmerList = Object.values(farmerMap);
      return res.json({
        success: true,
        count: farmerList.length,
        data: farmerList,
      });
    } catch (err: any) {
      console.error('Error fetching farmers from database:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to retrieve farmers from database.',
      });
    }
  });

  // =========================================================================
  // 4. BARANGAYS API (DATABASE-ENRICHED REAL-TIME STATISTICS)
  // =========================================================================
  const mapBarangayRow = (row: any, stats?: { totalSwine: number; readyToSell: number; farmers: Set<string> }) => ({
    ...(row.metadata || {}),
    id: String(row.id),
    name: row.name,
    code: row.code,
    latitude: Number(row.latitude || 0),
    longitude: Number(row.longitude || 0),
    riskLevel: row.metadata?.riskLevel || 'green',
    focalPerson: row.metadata?.focalPerson || '',
    focalPersonName: row.metadata?.focalPersonName || row.metadata?.focalPerson || '',
    contactNo: row.metadata?.contactNo || '',
    registeredSwineCount: stats?.totalSwine || 0,
    registeredFarmerCount: stats?.farmers.size || 0,
    readyToSellCount: stats?.readyToSell || 0,
    asfZone: (row.metadata?.riskLevel || 'green').toUpperCase(),
  });

  const seedBarangaysWhenEmpty = async () => {
    const existing = await pool.query('SELECT id FROM barangays LIMIT 1');
    if (existing.rows.length > 0) return;
    for (const barangay of HINUNANGAN_BARANGAYS) {
      const metadata = {
        riskLevel: barangay.defaultRiskLevel,
        focalPerson: barangay.focalPersonName,
        focalPersonName: barangay.focalPersonName,
        contactNo: barangay.contactNumber,
        isUrban: barangay.isUrban,
      };
      await pool.query(
        'INSERT INTO barangays (code, name, municipality, latitude, longitude, is_active, metadata) VALUES ($1, $2, $3, $4, $5, TRUE, $6::jsonb) ON CONFLICT (code) DO NOTHING',
        [barangay.code, barangay.name, 'Hinunangan', barangay.latitude, barangay.longitude, JSON.stringify(metadata)]
      );
    }
  };

  app.get('/api/barangays', async (_req, res) => {
    try {
      await seedBarangaysWhenEmpty();
      const barangayResult = await pool.query('SELECT * FROM barangays WHERE is_active = TRUE ORDER BY name');
      const { records } = await getAllSwineRecords();

      const countsByBarangay: Record<string, { totalSwine: number; readyToSell: number; farmers: Set<string> }> = {};

      records.forEach(r => {
        const bName = (r.barangay || '').trim().toLowerCase();
        if (!countsByBarangay[bName]) {
          countsByBarangay[bName] = { totalSwine: 0, readyToSell: 0, farmers: new Set() };
        }
        countsByBarangay[bName].totalSwine += 1;
        if (r.readyToSell || r.status === 'ready_to_sell') {
          countsByBarangay[bName].readyToSell += 1;
        }
        if (r.farmerName) {
          countsByBarangay[bName].farmers.add(r.farmerName.trim().toLowerCase());
        }
      });

      const enrichedBarangays = barangayResult.rows.map((row: any) => mapBarangayRow(
        row,
        countsByBarangay[row.name.toLowerCase()] || { totalSwine: 0, readyToSell: 0, farmers: new Set() }
      ));

      return res.json({
        success: true,
        count: enrichedBarangays.length,
        data: enrichedBarangays,
      });
    } catch (err: any) {
      console.error('Error loading barangays from database:', err);
      return res.status(500).json({ success: false, error: 'Unable to load barangays from database.' });
    }
  });

  app.post('/api/barangays', async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) {
      return res.status(403).json({ success: false, error: 'Only administrators can create barangays.' });
    }
    const { name, code, latitude, longitude, ...metadata } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, error: 'Barangay name and code are required.' });
    }
    try {
      const result = await pool.query(
        'INSERT INTO barangays (code, name, municipality, latitude, longitude, is_active, metadata) VALUES ($1, $2, $3, $4, $5, TRUE, $6::jsonb) RETURNING *',
        [code.trim(), name.trim(), 'Hinunangan', Number(latitude) || 0, Number(longitude) || 0, JSON.stringify(metadata)]
      );
      return res.status(201).json({ success: true, data: mapBarangayRow(result.rows[0]) });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.code === '23505' ? 'Barangay name or code already exists.' : 'Unable to save barangay to database.' });
    }
  });

  app.put('/api/barangays/:id', async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) {
      return res.status(403).json({ success: false, error: 'Only administrators can update barangays.' });
    }
    const { name, code, latitude, longitude, ...metadata } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({ success: false, error: 'Barangay name and code are required.' });
    }
    try {
      const result = await pool.query(
        'UPDATE barangays SET code = $2, name = $3, latitude = $4, longitude = $5, metadata = $6::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *',
        [req.params.id, code.trim(), name.trim(), Number(latitude) || 0, Number(longitude) || 0, JSON.stringify(metadata)]
      );
      if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Barangay not found.' });
      return res.json({ success: true, data: mapBarangayRow(result.rows[0]) });
    } catch {
      return res.status(500).json({ success: false, error: 'Unable to update barangay in database.' });
    }
  });

  app.delete('/api/barangays/:id', async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) {
      return res.status(403).json({ success: false, error: 'Only administrators can deactivate barangays.' });
    }
    try {
      const result = await pool.query(
        'UPDATE barangays SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Barangay not found.' });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, error: 'Unable to deactivate barangay in database.' });
    }
  });

  // =========================================================================
  // 5. DASHBOARD & GIS STATISTICS API (DATABASE-DRIVEN)
  // =========================================================================
  app.get('/api/dashboard/stats', async (req, res) => {
    const user = getUserSecurityContext(req);
    const effectiveBarangay = user.isAdmin ? undefined : (user.assignedBarangay || user.barangayId);

    try {
      const { records, total } = await getAllSwineRecords({
        barangay: effectiveBarangay,
      });

      const farmersSet = new Set<string>();
      const barangaysWithPigs = new Set<string>();
      let healthyCount = 0;
      let quarantinedCount = 0;
      let sickCount = 0;
      let readyToSellCount = 0;
      let backyardCount = 0;
      let commercialCount = 0;

      const swineByType: Record<string, number> = {};
      const swineByBarangay: Record<string, number> = {};
      const asfDistribution: Record<string, number> = { GREEN: 0, YELLOW: 0, RED: 0, PINK: 0 };
      const monthlyRegistrations: Record<string, number> = {};

      records.forEach(r => {
        if (r.farmerName) farmersSet.add(`${r.farmerName.trim().toLowerCase()}_${r.barangay}`);
        if (r.barangay) {
          barangaysWithPigs.add(r.barangay);
          swineByBarangay[r.barangay] = (swineByBarangay[r.barangay] || 0) + 1;
        }

        const st = (r.status || 'healthy').toLowerCase();
        if (st === 'healthy') healthyCount++;
        else if (st === 'quarantined') quarantinedCount++;
        else if (st === 'sick') sickCount++;

        if (r.readyToSell || st === 'ready_to_sell') readyToSellCount++;

        if ((r.farmScale || '').toUpperCase() === 'BACKYARD') backyardCount++;
        else commercialCount++;

        const type = (r.swineType || 'grower').toLowerCase();
        swineByType[type] = (swineByType[type] || 0) + 1;

        const zone = (r.asfZone || 'RED').toUpperCase();
        asfDistribution[zone] = (asfDistribution[zone] || 0) + 1;

        if (r.registeredAt) {
          const monthKey = r.registeredAt.substring(0, 7); // YYYY-MM
          monthlyRegistrations[monthKey] = (monthlyRegistrations[monthKey] || 0) + 1;
        }
      });

      const stats = {
        totalSwine: total,
        totalFarmers: farmersSet.size,
        totalBarangays: user.isAdmin ? HINUNANGAN_BARANGAYS.length : 1,
        activeBarangaysWithSwine: barangaysWithPigs.size,
        healthySwine: healthyCount,
        quarantinedSwine: quarantinedCount,
        sickSwine: sickCount,
        readyToSell: readyToSellCount,
        backyardFarms: backyardCount,
        commercialFarms: commercialCount,
        swineByType,
        swineByBarangay,
        asfDistribution,
        monthlyRegistrations,
      };

      return res.json({ success: true, data: stats, scope: user.isAdmin ? 'all' : user.assignedBarangay });
    } catch (err: any) {
      console.error('Error computing dashboard statistics:', err);
      return res.status(500).json({ success: false, error: 'Unable to retrieve dashboard statistics from database.' });
    }
  });

  app.get('/api/swine-records/stats/summary', async (req, res) => {
    const user = getUserSecurityContext(req);
    const effectiveBarangay = user.isAdmin ? undefined : (user.assignedBarangay || user.barangayId);

    try {
      const { records } = await getAllSwineRecords({
        barangay: effectiveBarangay,
      });

      const summary = {
        totalHogs: records.length,
        healthyHogs: records.filter(s => (s.status || '').toLowerCase() === 'healthy').length,
        underMonitoring: records.filter(s => (s.status || '').toLowerCase() === 'quarantined' || (s.status || '').toLowerCase() === 'sick').length,
        suspectedASF: records.filter(s => (s.status || '').toLowerCase() === 'sick').length,
        readyToSell: records.filter(s => s.readyToSell || s.status === 'ready_to_sell').length,
        backyardFarms: records.filter(s => (s.farmScale || '').toUpperCase() === 'BACKYARD').length,
        commercialFarms: records.filter(s => (s.farmScale || '').toUpperCase() !== 'BACKYARD').length,
        byBarangay: {} as Record<string, number>,
      };

      records.forEach(s => {
        const b = s.barangay || 'Unknown';
        summary.byBarangay[b] = (summary.byBarangay[b] || 0) + 1;
      });

      return res.json({
        success: true,
        data: summary,
        scope: user.isAdmin ? 'all_permitted' : (user.assignedBarangay || user.barangayId),
      });
    } catch (err: any) {
      console.error('Error computing swine stats:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to connect to the Swine Registry database. Please check the backend connection.',
      });
    }
  });

  // Database configuration test & update endpoints
  // Database configuration test & update endpoints (RESTRICTED TO SUPER ADMIN ONLY)
  app.post('/api/admin/database/test', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'Access Denied: Only Super Administrators can test database configurations.' });
    }

    const { connectionString } = req.body || {};
    if (!connectionString || typeof connectionString !== 'string') {
      return res.status(400).json({ success: false, error: 'Connection string is required.' });
    }

    const trimmedUri = connectionString.trim();
    try {
      const parsed = new URL(trimmedUri);
      if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        return res.status(400).json({ success: false, error: 'Invalid database connection protocol. Expected postgres:// or postgresql://.' });
      }
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata') {
        return res.status(400).json({ success: false, error: 'Connection to cloud metadata host is prohibited.' });
      }
    } catch {
      return res.status(400).json({ success: false, error: 'Malformed PostgreSQL connection URI format.' });
    }

    const result = await testDatabaseConnection(trimmedUri);
    return res.json(result);
  });

  app.post('/api/admin/database/save', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'Access Denied: Only Super Administrators can switch database connections.' });
    }

    const { connectionString } = req.body || {};
    if (!connectionString || typeof connectionString !== 'string') {
      return res.status(400).json({ success: false, error: 'Connection string is required.' });
    }

    const trimmedUri = connectionString.trim();
    try {
      const parsed = new URL(trimmedUri);
      if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
        return res.status(400).json({ success: false, error: 'Invalid database connection protocol. Expected postgres:// or postgresql://.' });
      }
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' || hostname === 'metadata') {
        return res.status(400).json({ success: false, error: 'Connection to cloud metadata host is prohibited.' });
      }
    } catch {
      return res.status(400).json({ success: false, error: 'Malformed PostgreSQL connection URI format.' });
    }

    const result = await updateDatabaseConnection(trimmedUri);
    return res.json(result);
  });

  // =========================================================================
  // 6. CERTIFICATES & MOVEMENT PERMITS (DATABASE-DRIVEN)
  // =========================================================================
  app.get('/api/certificates', async (req, res) => {
    const user = getUserSecurityContext(req);
    const requestedBarangay = (req.query.filter_barangay as string) || (req.query.barangay as string);

    try {
      const dbCerts = await getAllCertificates();
      let list = dbCerts;

      if (!user.isAdmin) {
        list = list.filter((c: any) => {
          const matchId = Boolean(c.barangay_id && user.barangayId && c.barangay_id === user.barangayId);
          const matchName = Boolean(
            c.farmerBarangay && user.assignedBarangay && c.farmerBarangay.toLowerCase() === user.assignedBarangay.toLowerCase()
          );
          const matchIssuer = Boolean(
            c.issuingBarangay && user.assignedBarangay && c.issuingBarangay.toLowerCase() === user.assignedBarangay.toLowerCase()
          );
          return matchId || matchName || matchIssuer;
        });
      } else if (requestedBarangay && requestedBarangay !== 'all') {
        list = list.filter((c: any) => (c.barangay || '').toLowerCase() === requestedBarangay.toLowerCase());
      }

      return res.json({ success: true, count: list.length, data: list });
    } catch (err: any) {
      console.error('Error fetching certificates:', err);
      return res.status(500).json({ success: false, error: 'Unable to retrieve certificates from database.' });
    }
  });

  app.post('/api/certificates', async (req, res) => {
    const user = getUserSecurityContext(req);
    const cert = req.body;

    if (!cert || (!cert.controlNumber && !cert.certificateNo)) {
      return res.status(400).json({ success: false, error: 'Invalid certificate payload' });
    }

    if (!user.isAdmin && user.assignedBarangay) {
      cert.barangay = user.assignedBarangay;
      cert.farmerBarangay = user.assignedBarangay;
      cert.issuingBarangay = user.assignedBarangay;
    }

    try {
      const saved = await upsertCertificate({
        ...cert,
        metadata: {
          ...(cert.metadata || {}),
          ...cert,
          createdBy: user.userId,
          createdByRole: user.role,
        },
        id: cert.id || `cert-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      });
      return res.status(201).json({ success: true, data: saved });
    } catch (err: any) {
      console.error('Error issuing certificate:', err);
      return res.status(500).json({ success: false, error: 'Failed to issue certificate to database.' });
    }
  });

  app.get('/api/certificates/:id', async (req, res) => {
    const user = getUserSecurityContext(req);
    const { id } = req.params;

    try {
      const cert = await getCertificateByIdOrControlNumber(id);
      if (!cert) {
        return res.status(404).json({ success: false, error: 'Certificate not found in database.' });
      }

      if (!user.isAdmin) {
        const certBrgy = (cert.barangay || cert.farmerBarangay || cert.issuingBarangay || '').toLowerCase();
        const userBrgy = (user.assignedBarangay || '').toLowerCase();
        if (certBrgy && certBrgy !== userBrgy) {
          return res.status(403).json({
            success: false,
            error: `Access Denied: Certificate belongs to Barangay ${cert.barangay || cert.farmerBarangay}, outside your assigned jurisdiction.`,
          });
        }
      }

      return res.json({ success: true, data: cert });
    } catch (err: any) {
      console.error('Error fetching certificate by id:', err);
      return res.status(500).json({ success: false, error: 'Unable to retrieve certificate from database.' });
    }
  });

  app.put('/api/certificates/:id', async (req, res) => {
    const user = getUserSecurityContext(req);
    const { id } = req.params;
    const cert = req.body;

    if (!cert) {
      return res.status(400).json({ success: false, error: 'Certificate data is required.' });
    }

    try {
      const existing = await getCertificateByIdOrControlNumber(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Certificate to update was not found.' });
      }

      if (!user.isAdmin) {
        const certBrgy = (existing.barangay || existing.farmerBarangay || existing.issuingBarangay || '').toLowerCase();
        const userBrgy = (user.assignedBarangay || '').toLowerCase();
        if (certBrgy && certBrgy !== userBrgy) {
          return res.status(403).json({
            success: false,
            error: 'Access Denied: Cannot modify certificates outside your assigned barangay.',
          });
        }
        cert.barangay = user.assignedBarangay;
        cert.farmerBarangay = user.assignedBarangay;
        cert.issuingBarangay = user.assignedBarangay;
      }

      const updated = await upsertCertificate({
        ...existing,
        ...cert,
        id: existing.id || id,
        controlNumber: existing.controlNumber || cert.controlNumber || id,
        metadata: {
          ...(existing.metadata || {}),
          ...(cert.metadata || {}),
          ...cert,
          updatedBy: user.userId,
          updatedByRole: user.role,
          updatedAt: new Date().toISOString(),
        },
      });

      return res.json({ success: true, data: updated });
    } catch (err: any) {
      console.error('Error updating certificate:', err);
      return res.status(500).json({ success: false, error: 'Unable to update certificate in database.' });
    }
  });

  app.delete('/api/certificates/:controlNumber', async (req, res) => {
    const user = getUserSecurityContext(req);
    const { controlNumber } = req.params;

    try {
      if (!user.isAdmin) {
        const existing = await getCertificateByIdOrControlNumber(controlNumber);
        if (existing) {
          const certBrgy = (existing.barangay || existing.farmerBarangay || existing.issuingBarangay || '').toLowerCase();
          const userBrgy = (user.assignedBarangay || '').toLowerCase();
          if (certBrgy && certBrgy !== userBrgy) {
            return res.status(403).json({ success: false, error: 'Cannot archive certificates outside your assigned barangay.' });
          }
        }
      }

      const archived = await archiveCertificateByControlNumber(controlNumber);
      if (!archived) return res.status(404).json({ success: false, error: 'Certificate not found.' });
      return res.json({ success: true, message: 'Certificate archived successfully.' });
    } catch (err: any) {
      console.error('Error archiving certificate:', err);
      return res.status(500).json({ success: false, error: 'Unable to archive certificate in database.' });
    }
  });

  // Official Reports API (Database-backed query across issued_certificates)
  app.get('/api/reports/official', async (req, res) => {
    const user = getUserSecurityContext(req);
    const requestedBarangay = (req.query.barangay as string) || (req.query.filter_barangay as string);
    const type = req.query.type as string;
    const startDate = (req.query.startDate as string) || (req.query.dateFrom as string);
    const endDate = (req.query.endDate as string) || (req.query.dateTo as string);

    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Your account must be assigned to a barangay to view reports.' });
    }

    const effectiveBarangay = user.isAdmin
      ? (requestedBarangay && requestedBarangay !== 'all' ? requestedBarangay : undefined)
      : (user.assignedBarangay || user.barangayId);

    try {
      const allCerts = await getAllCertificates();
      let filtered = allCerts.filter((c: any) => c.status !== 'ARCHIVED');

      if (effectiveBarangay) {
        filtered = filtered.filter((c: any) => {
          const b = (c.barangay || c.farmerBarangay || c.issuingBarangay || '').toLowerCase();
          return b === effectiveBarangay.toLowerCase();
        });
      }

      if (type && type !== 'all') {
        const t = type.toLowerCase();
        filtered = filtered.filter((c: any) =>
          (c.certificateType || '').toLowerCase().includes(t) ||
          (c.purpose || '').toLowerCase().includes(t) ||
          (c.formatType || '').toLowerCase() === t
        );
      }

      if (startDate) {
        filtered = filtered.filter((c: any) => (c.issueDate || '') >= startDate);
      }

      if (endDate) {
        filtered = filtered.filter((c: any) => (c.issueDate || '') <= endDate);
      }

      return res.json({ success: true, count: filtered.length, data: filtered });
    } catch (err: any) {
      console.error('Error fetching official reports:', err);
      return res.status(500).json({ success: false, error: 'Unable to retrieve official reports from database.' });
    }
  });

  // =========================================================================
  // 7. MESSAGES (DATABASE-DRIVEN)
  // =========================================================================
  app.get('/api/messages', async (req, res) => {
    const user = getUserSecurityContext(req);
    try {
      const list = await getAllMessages({
        role: user.role,
        barangay: user.assignedBarangay,
        userId: user.userId,
      });
      return res.json({ success: true, count: list.length, data: list });
    } catch (err: any) {
      console.warn('Error retrieving messages from database:', err?.message || err);
      return res.json({ success: true, count: 0, data: [] });
    }
  });

  app.post('/api/messages', async (req, res) => {
    const user = getUserSecurityContext(req);
    const payload = req.body;
    if (!payload || !payload.message) {
      return res.status(400).json({ success: false, error: 'Message content is required.' });
    }

    try {
      const newMsg = await createMessage({
        ...payload,
        senderId: user.userId,
        senderName: user.username,
        senderRole: user.role as any,
        barangay: user.assignedBarangay,
      });
      return res.status(201).json({ success: true, data: newMsg });
    } catch (err: any) {
      console.error('Error creating message:', err);
      return res.status(500).json({ success: false, error: 'Failed to send message.' });
    }
  });

  app.patch('/api/messages/:id/read', async (req, res) => {
    const { id } = req.params;
    try {
      await markMessageRead(id);
      return res.json({ success: true, message: 'Message marked as read.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update message.' });
    }
  });

  app.delete('/api/messages/:id', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAuthenticated) {
      return res.status(401).json({ success: false, error: 'Authentication required to delete messages.' });
    }
    const { id } = req.params;
    try {
      const allMsgs = await getAllMessages({ role: 'admin', userId: user.userId });
      const target = allMsgs.find(m => m.id === id);
      if (target && !user.isAdmin) {
        if (target.senderId !== user.userId && target.senderName !== user.username) {
          return res.status(403).json({ success: false, error: 'Access Denied: You cannot delete messages sent by another user.' });
        }
      }
      await deleteMessageById(id);
      return res.json({ success: true, message: 'Message deleted.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to delete message.' });
    }
  });

  // =========================================================================
  // 8. MEDIA FILES & UPLOAD (DATABASE-DRIVEN)
  // 8. MEDIA FILES & UPLOAD (DATABASE-DRIVEN & VALIDATED)
  // =========================================================================
  app.get('/api/media', async (req, res) => {
    const category = req.query.category as string;
    try {
      const items = await getAllMedia(category);
      return res.json({ success: true, count: items.length, data: items });
    } catch (err: any) {
      console.error('Error fetching media:', err);
      return res.status(500).json({ success: false, error: 'Unable to retrieve media from database.' });
    }
  });

  const handleMediaUpload = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (!user.isAuthenticated) {
      return res.status(401).json({ success: false, error: 'Authentication required to upload media.' });
    }
    if (!user.isAdmin && user.role !== 'super_admin') {
      return res.status(403).json({ success: false, error: 'Only administrators can upload shared media assets.' });
    }

    const { fileName, base64, mimeType, category, altText } = req.body || {};
    if (typeof base64 !== 'string' || typeof fileName !== 'string' || typeof mimeType !== 'string') {
      return res.status(400).json({ success: false, error: 'An image file, original filename, and MIME type are required.' });
    }

    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'media-image';
    let uploadedPath: string | null = null;

    try {
      const uploaded = await uploadLandingCmsAsset(
        sanitizedFileName,
        mimeType,
        base64,
        typeof category === 'string' ? category : 'other'
      );
      uploadedPath = uploaded.filePath;
      const item = await insertMedia({
        fileName: sanitizedFileName,
        filePath: uploaded.filePath,
        fileUrl: uploaded.fileUrl,
        mimeType,
        fileSize: uploaded.fileSize,
        category: category || 'OTHER',
        altText: altText || sanitizedFileName || 'Uploaded media asset',
        uploadedBy: user.username,
      });

      return res.status(201).json({ success: true, data: item, fileUrl: item.fileUrl, filePath: item.filePath });
    } catch (err: any) {
      if (uploadedPath) {
        try {
          await deleteLandingCmsAsset(uploadedPath);
        } catch (cleanupError) {
          console.error('Unable to clean up uploaded media after metadata save failure:', cleanupError);
        }
      }
      console.error('Error uploading media:', err);
      const status = err instanceof Error && /image|mime|payload|15 MB/i.test(err.message) ? 400 : 500;
      return res.status(status).json({ success: false, error: err instanceof Error ? err.message : 'Failed to upload media to Supabase Storage.' });
    }
  };

  app.post('/api/media/upload', handleMediaUpload);
  app.post('/api/media', handleMediaUpload);

  app.delete('/api/media/:id', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access Denied: Only administrators can delete media.' });
    }
    const { id } = req.params;
    try {
      const media = (await getAllMedia()).find(item => item.id === id);
      if (!media) return res.status(404).json({ success: false, error: 'Media record not found.' });
      if (media.filePath) await deleteLandingCmsAsset(media.filePath);
      const removed = await deleteMediaById(id);
      if (!removed) throw new Error('Media metadata could not be removed from the database.');
      return res.json({ success: true, message: 'Media removed from database.' });
    } catch (err: any) {
      console.error('Failed to delete media asset:', err);
      return res.status(500).json({ success: false, error: 'Failed to delete media.' });
    }
  });

  // =========================================================================
  // 9. SYSTEM SETTINGS, CMS & CUSTOM FORMS (DATABASE-DRIVEN)
  // =========================================================================
  app.get('/api/settings', async (req, res) => {
    const key = (req.query.key as string) || 'system_branding';
    try {
      const value = await getSystemSetting(key);
      return res.json({ success: true, key, value });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Unable to retrieve settings from database.' });
    }
  });

  app.put('/api/settings', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access Denied: Only administrators can update system settings.' });
    }
    const { key, value } = req.body || {};
    if (!key) {
      return res.status(400).json({ success: false, error: 'Setting key is required.' });
    }
    try {
      const saved = await setSystemSetting(key, value);
      return res.json({ success: true, key, value: saved });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update system settings.' });
    }
  });

  app.get('/api/landing-config', async (_req, res) => {
    try {
      const config = await getSystemSetting('landing_page_config', INITIAL_LANDING_CONFIG);
      return res.json({ success: true, config, data: config });
    } catch {
      return res.json({ success: true, config: INITIAL_LANDING_CONFIG, data: INITIAL_LANDING_CONFIG });
    }
  });

  app.put('/api/landing-config', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }
    try {
      const config = await setSystemSetting('landing_page_config', req.body);
      return res.json({ success: true, config, data: config });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update landing page config in database.' });
    }
  });

  // Alias for /api/landing/settings (GET, PUT, POST)
  app.get('/api/landing/settings', async (_req, res) => {
    try {
      const config = await getSystemSetting('landing_page_config', INITIAL_LANDING_CONFIG);
      return res.json({ success: true, config, data: config });
    } catch {
      return res.json({ success: true, config: INITIAL_LANDING_CONFIG, data: INITIAL_LANDING_CONFIG });
    }
  });

  app.put('/api/landing/settings', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }
    try {
      const config = await setSystemSetting('landing_page_config', req.body);
      return res.json({ success: true, config, data: config });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update landing page config in database.' });
    }
  });

  app.post('/api/landing/settings', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }
    try {
      const config = await setSystemSetting('landing_page_config', req.body);
      return res.json({ success: true, config, data: config });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update landing page config in database.' });
    }
  });

  app.get('/api/admin/sidebar-theme', async (_req, res) => {
    try {
      const theme = await getSystemSetting('sidebar_theme', DEFAULT_SIDEBAR_THEME);
      return res.json({ success: true, theme });
    } catch {
      return res.json({ success: true, theme: DEFAULT_SIDEBAR_THEME });
    }
  });

  app.put('/api/admin/sidebar-theme', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }
    try {
      const theme = await setSystemSetting('sidebar_theme', req.body);
      return res.json({ success: true, theme });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update sidebar theme in database.' });
    }
  });

  const LANDING_CMS_CONFIG_KEY = 'landing_cms_configuration_v1';

  app.get('/api/landing-cms/published', async (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      const stored = await getSystemSetting<any>(LANDING_CMS_CONFIG_KEY);
      return res.json({
        success: true,
        config: stored?.published || INITIAL_LANDING_CMS_CONFIG,
      });
    } catch (err: any) {
      console.error('LANDING_CMS_CONFIG_LOAD failed:', err?.message || 'Unknown database error');
      return res.status(500).json({ success: false, error: 'Unable to load published landing page configuration.' });
    }
  });

  app.get('/api/admin/landing-cms/draft', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access landing page drafts.' });
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    try {
      const stored = await getSystemSetting<any>(LANDING_CMS_CONFIG_KEY);
      return res.json({
        success: true,
        config: stored?.draft || stored?.published || INITIAL_LANDING_CMS_CONFIG,
      });
    } catch (err: any) {
      console.error('LANDING_CMS_DRAFT_LOAD failed:', err?.message || 'Unknown database error');
      return res.status(500).json({ success: false, error: 'Unable to load landing page draft.' });
    }
  });

  app.put('/api/admin/landing-cms/draft', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to save landing page drafts.' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, error: 'A valid landing page configuration is required.' });
    }
    try {
      const stored = await getSystemSetting<any>(LANDING_CMS_CONFIG_KEY);
      const config = { ...req.body, status: 'draft', lastUpdated: new Date().toISOString() };
      await setSystemSetting(LANDING_CMS_CONFIG_KEY, {
        published: stored?.published || INITIAL_LANDING_CMS_CONFIG,
        draft: config,
      });
      console.info('LANDING_CMS_CONFIG_SAVE success:', { updatedBy: admin.userId || admin.username, timestamp: new Date().toISOString() });
      return res.json({ success: true, config });
    } catch (err: any) {
      console.error('LANDING_CMS_CONFIG_SAVE failed:', err?.message || 'Unknown database error');
      return res.status(500).json({ success: false, error: 'Unable to save landing page draft.' });
    }
  });

  app.post('/api/admin/landing-cms/publish', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to publish landing page configuration.' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, error: 'A valid landing page configuration is required.' });
    }
    try {
      const config = {
        ...req.body,
        status: 'published',
        lastUpdated: new Date().toISOString(),
        updatedBy: admin.username,
      };
      await setSystemSetting(LANDING_CMS_CONFIG_KEY, { published: config, draft: config });
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      console.info('LANDING_CMS_CONFIG_PUBLISH success:', { updatedBy: admin.userId || admin.username, timestamp: new Date().toISOString() });
      return res.json({ success: true, config });
    } catch (err: any) {
      console.error('LANDING_CMS_CONFIG_PUBLISH failed:', err?.message || 'Unknown database error');
      return res.status(500).json({ success: false, error: 'Unable to publish landing page configuration.' });
    }
  });

  app.post('/api/admin/landing-cms/upload', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (!admin.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to upload landing page media.' });
    }
    const { fileName, mimeType, base64, category } = req.body || {};
    if (typeof base64 !== 'string' || !base64 || typeof fileName !== 'string') {
      return res.status(400).json({ success: false, error: 'A file name and image payload are required.' });
    }
    try {
      const uploaded = await uploadLandingCmsAsset(fileName, mimeType || 'application/octet-stream', base64, category || 'backgrounds');
      console.info('LANDING_CMS_IMAGE_UPLOAD success:', { storagePath: uploaded.filePath, timestamp: new Date().toISOString() });
      return res.status(201).json({ success: true, ...uploaded, fileName, mimeType: mimeType || 'application/octet-stream' });
    } catch (err: any) {
      console.error('LANDING_CMS_IMAGE_UPLOAD failed:', err?.message || 'Unknown storage error');
      return res.status(500).json({ success: false, error: err?.message || 'Unable to upload landing page media.' });
    }
  });

  // =========================================================================
  // 10. SUPER ADMIN MASTER CONFIGURATION & SYSTEM APPEARANCE
  // =========================================================================
  app.get('/api/config/master', async (_req, res) => {
    try {
      const config = (await getSystemSetting('master_system_config', DEFAULT_MASTER_CONFIG)) || DEFAULT_MASTER_CONFIG;
      const versions = (await getSystemSetting('master_config_versions', [])) || [];
      const auditLogs = (await getSystemSetting('master_config_audit_logs', [])) || [];
      return res.json({ success: true, config, versions, auditLogs });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to retrieve master configuration.' });
    }
  });

  app.post('/api/config/master/draft', async (req, res) => {
    try {
      const { draft } = req.body || {};
      if (draft) {
        await setSystemSetting('master_system_config_draft', draft);
      }
      return res.json({ success: true, message: 'Draft configuration saved.' });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to persist draft configuration.' });
    }
  });

  app.post('/api/config/master/publish', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }

    try {
      const { config, summary, updatedBy } = req.body || {};
      if (!config) {
        return res.status(400).json({ success: false, error: 'Configuration data is required.' });
      }

      const currentConfig = (await getSystemSetting('master_system_config', DEFAULT_MASTER_CONFIG)) || DEFAULT_MASTER_CONFIG;
      const currentVersions = (await getSystemSetting('master_config_versions', [])) || [];
      const currentLogs = (await getSystemSetting('master_config_audit_logs', [])) || [];

      const nextVersion = (currentConfig.version || 1) + 1;
      const now = new Date().toISOString();
      const author = updatedBy || user.username || 'Super Admin';

      const published = {
        ...config,
        version: nextVersion,
        updatedAt: now,
        updatedBy: author,
      };

      await setSystemSetting('master_system_config', published);
      await setSystemSetting('master_system_config_draft', published);

      // Version snapshot
      const versionEntry = {
        version: nextVersion,
        publishedAt: now,
        publishedBy: author,
        summary: summary || 'Published master appearance & role configurations',
        snapshot: published,
      };
      currentVersions.unshift(versionEntry);
      await setSystemSetting('master_config_versions', currentVersions);

      // Audit log
      const auditEntry = {
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        who: author,
        what: summary || `Published configuration version v${nextVersion}`,
        oldValue: `v${currentConfig.version || 1}`,
        newValue: `v${nextVersion}`,
        targetRole: 'Master Configuration',
        targetComponent: 'Full Theme Canvas',
        timestamp: now,
      };
      currentLogs.unshift(auditEntry);
      await setSystemSetting('master_config_audit_logs', currentLogs);

      return res.json({ success: true, config: published, version: nextVersion });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to publish master configuration.' });
    }
  });

  app.get('/api/config/master/versions', async (_req, res) => {
    try {
      const versions = (await getSystemSetting('master_config_versions', [])) || [];
      return res.json({ success: true, versions });
    } catch {
      return res.json({ success: true, versions: [] });
    }
  });

  app.post('/api/config/master/restore/:version', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'You do not have permission to access this resource.' });
    }

    try {
      const targetVer = parseInt(req.params.version, 10);
      const versions = (await getSystemSetting('master_config_versions', [])) || [];
      const match = versions.find((v: any) => v.version === targetVer);
      if (!match || !match.snapshot) {
        return res.status(404).json({ success: false, error: `Version v${targetVer} not found in rollback history.` });
      }

      const currentConfig = (await getSystemSetting('master_system_config', DEFAULT_MASTER_CONFIG)) || DEFAULT_MASTER_CONFIG;
      const currentLogs = (await getSystemSetting('master_config_audit_logs', [])) || [];
      const nextVersion = (currentConfig.version || 1) + 1;
      const now = new Date().toISOString();
      const author = user.username || 'Super Admin';

      const restored = {
        ...match.snapshot,
        version: nextVersion,
        updatedAt: now,
        updatedBy: `${author} (Restored from v${targetVer})`,
      };

      await setSystemSetting('master_system_config', restored);
      await setSystemSetting('master_system_config_draft', restored);

      // Add version entry
      versions.unshift({
        version: nextVersion,
        publishedAt: now,
        publishedBy: author,
        summary: `Restored baseline from v${targetVer}`,
        snapshot: restored,
      });
      await setSystemSetting('master_config_versions', versions);

      // Audit log
      currentLogs.unshift({
        id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        who: author,
        what: `Restored Configuration from Version v${targetVer}`,
        oldValue: `v${currentConfig.version || 1}`,
        newValue: `v${nextVersion}`,
        targetRole: 'Master Configuration',
        targetComponent: 'Full Rollback',
        timestamp: now,
      });
      await setSystemSetting('master_config_audit_logs', currentLogs);

      return res.json({ success: true, config: restored, version: nextVersion });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to restore configuration version.' });
    }
  });

  app.get('/api/config/master/audit-logs', async (_req, res) => {
    try {
      const auditLogs = (await getSystemSetting('master_config_audit_logs', [])) || [];
      return res.json({ success: true, auditLogs });
    } catch {
      return res.json({ success: true, auditLogs: [] });
    }
  });

  app.post('/api/config/master/audit-log', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAuthenticated || (!user.isSuperAdmin && !user.isAdmin)) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Only administrators can record system audit logs.' });
    }
    try {
      const entry = req.body;
      if (entry && entry.what) {
        const currentLogs = (await getSystemSetting<any[]>('master_config_audit_logs', [])) || [];
        const updatedLogs = [
          {
            ...entry,
            id: entry.id || `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            who: entry.who || user.username,
            timestamp: entry.timestamp || new Date().toISOString(),
          },
          ...(Array.isArray(currentLogs) ? currentLogs : []),
        ].slice(0, 150); // Bound to latest 150 entries
        await setSystemSetting('master_config_audit_logs', updatedLogs);
      }
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ success: false, error: 'Failed to record audit log.' });
    }
  });

  // Registry Schema Endpoints (GET, POST, PUT, DELETE)
  app.get(['/api/admin/registry-form-schema', '/api/registry-schema'], async (_req, res) => {
    try {
      const schema = await getFullRegistrySchemaFromDb();
      return res.json({ success: true, schema, data: schema });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err?.message || 'Unable to load registry schema from database.' });
    }
  });

  app.post(['/api/admin/registry-form-schema', '/api/registry-schema'], async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) {
      return res.status(403).json({ success: false, error: 'Only administrators can modify registry form fields.' });
    }
    try {
      if (req.body && Array.isArray(req.body.sections)) {
        const schema = await syncFullRegistrySchemaToDb(req.body);
        return res.json({ success: true, schema, data: schema });
      } else if (req.body && (req.body.label || req.body.fieldKey)) {
        const id = req.body.id || 'fld_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const field = await upsertSchemaFieldInDb({ ...req.body, id });
        const schema = await getFullRegistrySchemaFromDb();
        return res.json({ success: true, field, schema, data: schema });
      } else {
        const schema = await syncFullRegistrySchemaToDb(req.body);
        return res.json({ success: true, schema, data: schema });
      }
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update registry schema in database: ' + err.message });
    }
  });

  app.put(['/api/admin/registry-form-schema', '/api/registry-schema'], async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) {
      return res.status(403).json({ success: false, error: 'Only administrators can modify registry form fields.' });
    }
    try {
      const schema = await syncFullRegistrySchemaToDb(req.body);
      return res.json({ success: true, schema, data: schema });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update registry schema in database.' });
    }
  });

  app.put('/api/registry-schema/:id', async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) {
      return res.status(403).json({ success: false, error: 'Only administrators can modify registry form fields.' });
    }
    try {
      const { id } = req.params;
      const field = await upsertSchemaFieldInDb({ ...req.body, id });
      const schema = await getFullRegistrySchemaFromDb();
      return res.json({ success: true, field, schema, data: schema });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update registry schema field: ' + err.message });
    }
  });

  app.delete('/api/registry-schema/:id', async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) {
      return res.status(403).json({ success: false, error: 'Only administrators can modify registry form fields.' });
    }
    try {
      const { id } = req.params;
      await deleteSchemaFieldFromDb(id);
      const schema = await getFullRegistrySchemaFromDb();
      return res.json({ success: true, message: `Field ${id} deleted successfully.`, schema, data: schema });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to delete registry schema field: ' + err.message });
    }
  });

  // =========================================================================
  // 10. LEGAL DOCUMENTS & ASF REGULATIONS API
  // =========================================================================
  app.get('/api/legal-documents', (_req, res) => {
    res.json({ success: true, count: ALL_ASF_REGULATIONS.length, data: ALL_ASF_REGULATIONS });
  });

  // =========================================================================
  // 11. ENTERPRISE OFFLINE SYNCHRONIZATION API (IDEMPOTENT BATCH SYNC)
  // =========================================================================

  // GET /api/sync/status
  app.get('/api/sync/status', async (req, res) => {
    const user = getUserSecurityContext(req);
    try {
      const { total } = await getAllSwineRecords();
      return res.json({
        success: true,
        status: 'ONLINE',
        serverTime: new Date().toISOString(),
        role: user.role,
        scope: user.isAdmin ? 'ALL' : (user.assignedBarangay || user.barangayId),
        totalSwineInDb: total,
      });
    } catch {
      return res.json({
        success: true,
        status: 'ONLINE',
        serverTime: new Date().toISOString(),
      });
    }
  });

  // PULL: Download latest server data respecting role-based authorization
  const handleSyncPull = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Your account must be assigned to a barangay to synchronize records.' });
    }
    const since = (req.query.since as string) || (req.body && req.body.since) || undefined;
    const effectiveBarangay = user.isAdmin ? undefined : (user.assignedBarangay || user.barangayId);

    try {
      const { records: swineList } = await getAllSwineRecords({
        barangay: effectiveBarangay,
        readyToSell: user.isAgent ? true : undefined,
      });

      const certs = await getAllCertificates();
      const filteredCerts = user.isAdmin
        ? certs
        : certs.filter((c: any) => {
            const matchId = Boolean(c.barangay_id && user.barangayId && c.barangay_id === user.barangayId);
            const matchName = Boolean(
              c.farmerBarangay && user.assignedBarangay && c.farmerBarangay.toLowerCase() === user.assignedBarangay.toLowerCase()
            );
            return matchId || matchName;
          });

      const messages = await getAllMessages({
        role: user.role,
        barangay: user.assignedBarangay,
        userId: user.userId,
      });

      return res.json({
        success: true,
        serverTimestamp: new Date().toISOString(),
        data: {
          swineRecords: swineList,
          certificates: filteredCerts,
          messages,
          barangays: HINUNANGAN_BARANGAYS,
        },
      });
    } catch (err: any) {
      console.error('Error during sync pull:', err);
      return res.status(500).json({
        success: false,
        error: 'Database sync pull failed. Backend server unavailable.',
      });
    }
  };

  app.get('/api/sync/pull', handleSyncPull);
  app.post('/api/sync/pull', handleSyncPull);

  // PUSH: Process pending offline operations queue idempotently
  app.post('/api/sync/push', async (req, res) => {
    const user = getUserSecurityContext(req);
    const { operations } = req.body || {};

    if (!Array.isArray(operations) || operations.length === 0) {
      return res.json({ success: true, processedCount: 0, results: [] });
    }

    const results: Array<{
      clientOperationId: string;
      entityId: string;
      serverEntityId?: string;
      serverPigId?: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const op of operations) {
      const { clientOperationId, operation, entity, entityId, payload } = op;

      try {
        if (entity === 'swine') {
          if (user.isAgent) {
            results.push({
              clientOperationId,
              entityId,
              success: false,
              error: 'Agent accounts are restricted to view-only access.',
            });
            continue;
          }
          if (user.isFocal && !user.assignedBarangay) {
            results.push({ clientOperationId, entityId, success: false, error: 'Your account has no assigned barangay.' });
            continue;
          }

          if (operation === 'create') {
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              results.push({ clientOperationId, entityId, success: false, error: 'Invalid swine record payload.' });
              continue;
            }
            if (user.isFocal && payload.barangay && payload.barangay.trim().toLowerCase() !== user.assignedBarangay.toLowerCase()) {
              results.push({ clientOperationId, entityId, success: false, error: 'Record is outside your assigned barangay.' });
              continue;
            }
            let tag = (payload.pigIdTag || payload.earTagNo || '').trim();
            // If temporary local tag, generate authoritative backend Pig ID
            // If temporary local tag, generate authoritative backend Pig ID from sequence
            if (!tag || tag.startsWith('LOCAL-') || !PIG_ID_TAG_REGEX.test(tag)) {
              const currentYear = new Date().getFullYear();
              const { total } = await getAllSwineRecords();
              tag = `HIN-${currentYear}-${String(total + 1).padStart(4, '0')}`;
              tag = await getNextAuthoritativePigIdTag();
            }

            if (user.isFocal) {
              payload.barangay = user.assignedBarangay;
              if (user.barangayId) payload.barangay_id = user.barangayId;
            }

            const cleanRecord = {
              ...payload,
              id: uuidForSyncOperation(String(clientOperationId || entityId)),
              pigIdTag: tag,
              earTagNo: tag,
              registeredBy: payload.registeredBy || user.username,
            };

            const saved = await upsertSwineRecord(cleanRecord);
            results.push({
              clientOperationId,
              entityId,
              serverEntityId: saved.id,
              serverPigId: saved.pigIdTag,
              success: true,
            });
          } else if (operation === 'update') {
            const existing = await getSwineRecordById(entityId);
            if (!existing || (user.isFocal && existing.barangay.toLowerCase() !== user.assignedBarangay.toLowerCase()) ||
                (user.isFocal && payload?.barangay && payload.barangay.toLowerCase() !== user.assignedBarangay.toLowerCase())) {
              results.push({ clientOperationId, entityId, success: false, error: 'Record is outside your assigned barangay or no longer exists.' });
              continue;
            }
            const updated = await upsertSwineRecord({
              ...existing,
              ...(payload || {}),
              id: existing.id,
              barangay: existing.barangay,
              barangay_id: existing.barangay_id,
            });
            results.push({
              clientOperationId,
              entityId,
              serverEntityId: updated.id,
              success: true,
            });
          } else if (operation === 'delete') {
            if (user.isAdmin) {
              await deleteSwineRecordById(entityId);
              results.push({ clientOperationId, entityId, success: true });
            } else {
              results.push({
                clientOperationId,
                entityId,
                success: false,
                error: 'Only administrators can delete swine records.',
              });
            }
          } else if (operation === 'sell' || operation === 'archive') {
            const existing = await getSwineRecordById(entityId);
            if (existing && (!user.isFocal || existing.barangay.toLowerCase() === user.assignedBarangay.toLowerCase())) {
              const updated = {
                ...existing,
                ...payload,
                id: existing.id,
                barangay: existing.barangay,
                barangay_id: existing.barangay_id,
              };
              await upsertSwineRecord(updated);
              results.push({ clientOperationId, entityId, success: true });
            } else {
              results.push({
                clientOperationId,
                entityId,
                success: true,
                error: 'Record already updated or removed.',
              });
            }
          }
        } else if (entity === 'media') {
          const resolvedUrl = payload.fileUrl || payload.base64 || payload.dataUrlOrBase64;
          if (resolvedUrl) {
            const savedMedia = await insertMedia({
              fileName: payload.fileName || `media-${Date.now()}`,
              fileUrl: resolvedUrl,
              mimeType: payload.mimeType || 'image/jpeg',
              fileSize: payload.fileSize || 0,
              category: payload.category || 'OTHER',
              altText: payload.altText || 'Media Asset',
              uploadedBy: user.username,
            });
            results.push({
              clientOperationId,
              entityId,
              serverEntityId: savedMedia.id,
              success: true,
            });
          } else {
            results.push({ clientOperationId, entityId, success: false, error: 'Empty media content' });
          }
        } else if (entity === 'certificate') {
          if (!user.isAdmin && user.assignedBarangay) {
            payload.barangay = user.assignedBarangay;
            payload.farmerBarangay = user.assignedBarangay;
          }
          const savedCert = await upsertCertificate({
            ...payload,
            id: payload.id || `cert-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          });
          results.push({ clientOperationId, entityId, serverEntityId: savedCert.id, success: true });
        } else if (entity === 'message') {
          const newMsg = await createMessage({
            ...payload,
            senderId: user.userId,
            senderName: user.username,
            senderRole: user.role as any,
            barangay: user.assignedBarangay,
          });
          results.push({ clientOperationId, entityId, serverEntityId: newMsg.id, success: true });
        } else {
          results.push({ clientOperationId, entityId, success: true });
        }
      } catch (err: any) {
        console.error(`Sync error on operation ${clientOperationId}:`, err);
        results.push({
          clientOperationId,
          entityId,
          success: false,
          error: err?.message || 'Database transaction error',
        });
      }
    }

    return res.json({
      success: true,
      processedCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
      results,
    });
  });

  // =========================================================================
  // 12. DA HINUNANGAN PUBLIC ASSISTANT API (DEDICATED PUBLIC PORTAL ENDPOINT)
  // =========================================================================
  app.post('/api/public/assistant/chat', async (req, res) => {
    const { message = '' } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'A valid message string is required.' });
    }

    try {
      const lower = message.toLowerCase().trim();

      // 1. REFUSAL: Secrets / Passwords / API Keys / Database Credential requests
      if (
        lower.includes('password') ||
        lower.includes('api key') ||
        lower.includes('apikey') ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('database password') ||
        lower.includes('sql') ||
        lower.includes('credentials')
      ) {
        return res.json({
          success: true,
          reply: `🔒 **Security Notice**: System credentials, internal database settings, API keys, and administrative secrets are restricted and cannot be disclosed under any circumstances.`,
          suggestions: [
            'What is the Swine Registry?',
            'How do I register my swine?',
            'What are the official contact details?',
          ],
        });
      }

      // 2. REFUSAL: Personal records inquiry ("Show my records", "Show my swine records", etc.)
      if (
        lower.includes('my record') ||
        lower.includes('my swine') ||
        lower.includes('my pig') ||
        lower.includes('my farm') ||
        lower.includes('show my') ||
        lower.includes('view my') ||
        lower.includes('check my') ||
        lower.includes('my registration')
      ) {
        return res.json({
          success: true,
          reply: `Registry records are available through the authorized portal. Please sign in using your official account.`,
          action: {
            type: 'open_login',
            label: 'Official Login',
          },
          suggestions: [
            'What are the requirements?',
            'How do I register my swine?',
            'What are the official contact details?',
          ],
        });
      }

      // 3. REFUSAL: "Where" queries regarding individual swine, farmers, internal GIS locations, pins, coordinates
      const isWhereLocationOfFarmerOrSwine =
        (lower.includes('where is') || lower.includes('where are') || lower.includes('where can i find') || lower.includes('coordinates') || lower.includes('location of') || lower.includes('pin') || lower.includes('gps')) &&
        (lower.includes('farmer') || lower.includes('pig') || lower.includes('swine') || lower.includes('pen') || lower.includes('juan') || lower.includes('infected') || lower.includes('raiser') || lower.includes('map coordinates') || lower.includes('gis coordinates'));

      if (isWhereLocationOfFarmerOrSwine) {
        return res.json({
          success: true,
          reply: `I can provide publicly available information about the Hinunangan Swine Registry, but individual swine, farmer, surveillance, and internal GIS locations are restricted to authorized system users.`,
          suggestions: [
            'Where is Hinunangan?',
            'What barangays are covered?',
            'What are the official contact details?',
            'What is the Swine Registry?',
          ],
        });
      }

      // 4. REFUSAL: "Who" queries regarding ownership of specific swine or raiser identities
      const isWhoQuery =
        (lower.includes('who owns') || lower.includes('who is the owner') || lower.includes('who registered') || lower.includes('owner of') || (lower.startsWith('who') && (lower.includes('swine') || lower.includes('pig') || lower.includes('hin-') || lower.includes('ear tag'))));

      if (isWhoQuery) {
        return res.json({
          success: true,
          reply: `I can't provide private farmer, raiser, or registry information. That information is available only to authorized personnel.`,
          suggestions: [
            'What is the Swine Registry?',
            'What are the requirements?',
            'What are the official contact details?',
          ],
        });
      }

      // 5. General "Where is Hinunangan?"
      if (
        lower.includes('where is hinunangan') ||
        lower.includes('location of hinunangan') ||
        (lower.includes('where') && lower.includes('hinunangan') && !lower.includes('pig') && !lower.includes('farmer'))
      ) {
        return res.json({
          success: true,
          reply: `📍 **Municipality of Hinunangan, Southern Leyte**:
Hinunangan is a coastal municipality in the eastern part of Southern Leyte, Eastern Visayas (Region VIII), Philippines. It spans 40 official barangays, bordered by Silago to the north, Hinundayan and Anahawan to the south, and Leyte Gulf to the east.

The Municipal Agriculture Office (MAO) is located at the **Town Hall Compound, Poblacion, Hinunangan, Southern Leyte 6601**.`,
          suggestions: [
            'What barangays are covered?',
            'What are the official contact details?',
            'What is the Swine Registry?',
          ],
        });
      }

      // 6. "What is the Swine Registry?" / Purpose of the system
      if (
        lower.includes('what is the swine registry') ||
        lower.includes('what is this system') ||
        lower.includes('purpose') ||
        lower.includes('about the registry') ||
        lower.includes('about the system')
      ) {
        return res.json({
          success: true,
          reply: `📋 **DA Hinunangan Swine Registry & Biosurveillance System**:
The system is an official municipal platform managed by the **Department of Agriculture** and the **Municipal Agriculture Office (MAO) of Hinunangan**, in collaboration with the **Southern Leyte State University (SLSU) Extension Center**.

**Key Purposes**:
1. **Livestock Traceability**: Digitize pig populations, unique ear-tag identifiers, and health histories across all 40 barangays.
2. **ASF Defense**: Safeguard the municipality's African Swine Fever **Green Zone (Free)** status through strict biosecurity standards.
3. **Farmer Support**: Assist RSBSA-registered raisers with veterinary outreach, vaccination, and official transport clearances.
4. **Market Transparency**: Connect accredited local hog raisers with meat buyers through certified Ready-to-Sell listings.`,
          suggestions: [
            'How do I register my swine?',
            'What are the requirements?',
            'What barangays are covered?',
          ],
        });
      }

      // 7. "How do I register my swine?" / "How can I register a swine?"
      if (
        lower.includes('how can i register') ||
        lower.includes('how do i register') ||
        lower.includes('how to register') ||
        lower.includes('register my swine') ||
        lower.includes('register a swine') ||
        lower.includes('registration process')
      ) {
        return res.json({
          success: true,
          reply: `📝 **How to Register Your Swine in Hinunangan**:

1. **Check Eligibility**: Ensure you are an RSBSA-registered hog raiser or resident of any of the 40 barangays in Hinunangan.
2. **Prepare Swine Details**: Have your swine ready for physical tagging (breed, approximate age/DOB, and current liveweight).
3. **Comply with Basic Biosecurity**: Ensure your pen has perimeter barrier fencing, an active disinfectant footbath, potable water, and **zero swill feeding (kanin-baboy)**.
4. **Contact Your Focal Person**: Notify your **Barangay Agricultural Focal Person** during designated inspection schedules at your Barangay Hall, or visit the **Municipal Agriculture Office (MAO)** at the Town Hall Compound.
5. **Issuance**: Once verified and tagged, your swine will be entered into the official registry and issued a tracking clearance.`,
          suggestions: [
            'What are the requirements?',
            'What are the official contact details?',
            'What should I do if my pigs are sick?',
          ],
        });
      }

      // 8. "What are the requirements?"
      if (
        lower.includes('requirement') ||
        lower.includes('qualifications') ||
        lower.includes('what do i need') ||
        lower.includes('needed to register')
      ) {
        return res.json({
          success: true,
          reply: `📑 **Official Requirements for Swine Registration**:

• **Raiser Credentials**: Valid Government ID and Proof of Residency in Hinunangan (or RSBSA Farmer Reference Number).
• **Facility Standards**: Basic pen biosecurity compliance:
  - Secure pen enclosure/fence.
  - Footbath installed at pen entrance.
  - Deepwell or potable drinking water source.
  - Strictly **NO swill feeding** (food scraps/bahog).
• **Swine Information**: Breed classification (Landrace, Large White, Duroc, Native, or crossbreed), birth date/age, and current weight estimate.
• **Inspection & Ear Tagging**: Permitting the authorized Barangay Focal Person or MAO technician to attach the official ear tag and record pen georeference.`,
          suggestions: [
            'How do I register my swine?',
            'What are the official contact details?',
            'What is ASF?',
          ],
        });
      }

      // 9. "What is ASF?" / African Swine Fever info
      if (
        lower.includes('what is asf') ||
        lower.includes('african swine fever') ||
        lower.includes('asf virus') ||
        lower.includes('asf disease')
      ) {
        return res.json({
          success: true,
          reply: `🛡️ **About African Swine Fever (ASF)**:
African Swine Fever is a severe, highly contagious viral disease affecting domestic and wild pigs. It causes high fever, respiratory distress, internal bleeding, and near 100% mortality in infected swine.

• **Human Health**: ASF is **NOT** a public health threat and **cannot infect humans**. However, humans and vehicles can easily spread the virus on shoes, tires, clothes, and uncooked pork products.
• **Hinunangan Status**: Hinunangan strictly maintains **Green Zone (Free)** status through checkpoint vehicle disinfection and municipal monitoring.
• **Golden Rule**: **Never feed swill (kanin-baboy/food scraps)** to pigs, as swill is the #1 vector of ASF transmission.`,
          suggestions: [
            'What should I do if my pigs are sick?',
            'What are the requirements?',
            'What are the official contact details?',
          ],
        });
      }

      // 10. "What should I do if my pigs are sick?"
      if (
        lower.includes('sick') ||
        lower.includes('fever') ||
        lower.includes('dying') ||
        lower.includes('symptoms') ||
        lower.includes('emergency') ||
        lower.includes('report sick')
      ) {
        return res.json({
          success: true,
          reply: `🚨 **Emergency Protocol for Sick Swine**:

1. **Immediately Isolate**: Move the sick pig to a separate isolation pen away from other animals.
2. **DO NOT Sell or Transport**: Moving or selling sick pigs is strictly illegal under Municipal Ordinance and spreads disease.
3. **DO NOT Slaughter or Consume**: Do not butcher sick pigs for human or pet consumption.
4. **Disinfect**: Disinfect boots, pens, and equipment with bleach or veterinary disinfectant.
5. **Report Immediately**: Contact your **Barangay Agricultural Focal Person** or call the **Municipal Agriculture Emergency Hotline at (053) 578-2011 / 0917-888-9999** for free veterinary assessment.`,
          suggestions: [
            'What are the official contact details?',
            'What is ASF?',
            'What are the requirements?',
          ],
        });
      }

      // 11. "What programs and services are available?"
      if (
        lower.includes('programs') ||
        lower.includes('services') ||
        lower.includes('assistance') ||
        lower.includes('benefits') ||
        lower.includes('support')
      ) {
        return res.json({
          success: true,
          reply: `🌾 **DA Hinunangan Municipal Agricultural Programs & Services**:

• **Free Swine Ear Tagging & Micro-Profiling**: Official registry identification for livestock security.
• **Biosecurity Assistance & Farm Audits**: Assessment of pen biosecurity to protect against disease incursions.
• **Veterinary Technical Support**: Provided in partnership with Southern Leyte State University (SLSU) Extension Center.
• **Livestock Health Clearances & Transport Certificates**: Veterinary clearances for municipal and provincial livestock movement.
• **Ready-to-Sell Market Catalog**: Assisting verified local raisers in connecting with legitimate buyers.
• **Vaccination & Deworming Campaigns**: Periodic free municipal livestock deworming and immunization drives.`,
          suggestions: [
            'How do I register my swine?',
            'What are the requirements?',
            'What are the official contact details?',
          ],
        });
      }

      // 12. "What barangays are in Hinunangan? / What barangays are covered?"
      if (
        lower.includes('barangay') ||
        lower.includes('covered') ||
        lower.includes('coverage') ||
        lower.includes('list of barangay')
      ) {
        const bgNames = HINUNANGAN_BARANGAYS.map(b => b.name).join(', ');
        return res.json({
          success: true,
          reply: `🗺️ **Municipal Coverage (40 Barangays)**:
The DA Hinunangan Swine Registry covers all **40 official barangays** of Hinunangan, Southern Leyte:

${bgNames}

Every barangay has an assigned **Barangay Agricultural Focal Person** working alongside the Punong Barangay and Municipal Agriculture Office.`,
          suggestions: [
            'What are the official contact details?',
            'How do I register my swine?',
            'What is the Swine Registry?',
          ],
        });
      }

      // 13. "How can I contact the office? / What are the official contact details?"
      if (
        lower.includes('contact') ||
        lower.includes('phone') ||
        lower.includes('email') ||
        lower.includes('hotline') ||
        lower.includes('address') ||
        lower.includes('office') ||
        lower.includes('hours')
      ) {
        return res.json({
          success: true,
          reply: `📞 **Official Contact Information**:

• **Office**: Municipal Agriculture Office (MAO)
• **Location**: Hinunangan Town Hall Compound, Poblacion, Hinunangan, Southern Leyte 6601
• **Telephone**: (053) 578-2011
• **Emergency Hotline**: 0917-888-9999
• **Email**: agri.hinunangan@gmail.com
• **Official Facebook**: [facebook.com/LGUHinunanganOfficial](https://facebook.com/LGUHinunanganOfficial)
• **Office Hours**: Monday to Friday, 8:00 AM – 5:00 PM`,
          suggestions: [
            'What is the Swine Registry?',
            'How do I register my swine?',
            'What are the requirements?',
          ],
        });
      }

      // 14. Public Legal Decrees & Ordinances
      if (
        lower.includes('ordinance') ||
        lower.includes('decree') ||
        lower.includes('law') ||
        lower.includes('legal') ||
        lower.includes('resolution')
      ) {
        return res.json({
          success: true,
          reply: `⚖️ **Public Ordinances & Biosecurity Decrees**:

• **Hinunangan Municipal Ordinance No. 2025-59**: Mandates swine profiling, movement clearances, and the Babay ASF Biosecurity framework throughout Hinunangan.
• **Southern Leyte Provincial Ordinance 2021-018**: Enforces strict border quarantine inspection, mandatory vehicle disinfection at municipal checkpoints, and absolute prohibition of swill feeding.
• **Municipal Executive Order No. 12-2023**: Designates Barangay Agricultural Focal Persons to supervise local biosecurity compliance.`,
          suggestions: [
            'What is ASF?',
            'What are the requirements?',
            'What are the official contact details?',
          ],
        });
      }

      // 15. Gemini AI Engine (Strictly Grounded in Public System Portal Knowledge)
      if (process.env.GEMINI_API_KEY) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

          const publicSystemPrompt = `You are the official "DA Hinunangan Public Information Assistant" for the Municipal Agriculture Office of Hinunangan, Southern Leyte.

STRICT OPERATIONAL RULES:
1. ONLY INTERNAL SYSTEM TOPICS: You must strictly ONLY answer questions about the Municipality of Hinunangan, DA Hinunangan agricultural programs, public swine registry guidelines, ASF prevention, and office contact information. NEVER search for external random topics or generic internet info (Dili mogawas sa sistema).
2. DO NOT expose confidential internal data (individual farmer names, exact coordinates, or internal credentials).
3. If asked where to register, explain that swine raisers can register by visiting the Municipal Agriculture Office at Poblacion, Hinunangan or coordinating with their Barangay Biosecurity Focal Person.
4. MULTILINGUAL SUPPORT: Answer fluently in English, Tagalog, or Cebuano / Bisaya depending on what the user asks.
5. Keep answers concise, polite, and helpful.`;

          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: message,
            config: {
              systemInstruction: publicSystemPrompt,
              temperature: 0.2,
            },
          });

          if (response.text) {
            return res.json({
              success: true,
              reply: response.text.trim(),
              action: {
                type: 'open_login',
                label: 'Official Login',
              },
              suggestions: [
                'What is the Swine Registry?',
                'How do I register my swine?',
                'What are the official contact details?',
                'What barangays are covered?',
              ],
            });
          }
        } catch (aiErr) {
          console.warn('Public Gemini API call fallback:', aiErr);
        }
      }

      // 16. Default Public Greeting & Directory
      return res.json({
        success: true,
        reply: `👋 Hello! I am the **DA Hinunangan Public Information Assistant**.

I can answer publicly available questions regarding:
• **Swine Registry & Guidelines**: How to register your swine and RSBSA requirements.
• **Programs & Services**: Municipal agricultural assistance, veterinary visits, and clearances.
• **African Swine Fever (ASF)**: Prevention measures, swill feeding prohibition, and zoning.
• **Barangays & Office Contacts**: Official phone numbers, office location, and focal person coordination.

*Note: Individual swine records, raiser personal data, and internal GIS coordinates are restricted to authorized personnel. Authorized users may sign in via the portal.*`,
        action: {
          type: 'open_login',
          label: 'Official Login',
        },
        suggestions: [
          'What is the Swine Registry?',
          'How do I register my swine?',
          'What are the requirements?',
          'What are the official contact details?',
          'What barangays are covered?',
          'What should I do if my pigs are sick?',
        ],
      });
    } catch (err: any) {
      console.error('Public Assistant endpoint error:', err);
      return res.status(500).json({
        success: false,
        error: 'Public assistant service temporarily unavailable.',
      });
    }
  });

  // =========================================================================
  // 13. DA HINUNANGAN BIOSECURITY ASSISTANT API (ROLE-BASED & REAL-TIME)
  // =========================================================================
  app.post('/api/assistant/chat', async (req, res) => {
    const user = getUserSecurityContext(req);
    const { message = '' } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'A valid message string is required.' });
    }

    // Role-based authentication check
    if (!user.isAuthenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Unauthenticated visitors must use the Public Information Assistant at /api/public/assistant/chat.',
      });
    }

    try {
      const lower = message.toLowerCase().trim();

      // Security Check: Refuse requests asking for database passwords, API keys, tokens, internal SQL, or server secrets
      if (
        lower.includes('password') ||
        lower.includes('api key') ||
        lower.includes('apikey') ||
        lower.includes('token') ||
        lower.includes('secret') ||
        lower.includes('database password') ||
        lower.includes('sql') ||
        lower.includes('credentials')
      ) {
        return res.json({
          success: true,
          reply: `🔒 **Security Notice**: System credentials, internal database settings, API keys, and administrative secrets are restricted and cannot be disclosed under any circumstances.`,
          suggestions: [
            'Show today\'s registry status',
            'How many swine are registered?',
            'Open GIS Swine Map',
          ],
        });
      }

      // Super Admin Natural Language Configuration Commands
      if (user.isSuperAdmin) {
        const currentConfig = (await getSystemSetting('master_system_config', DEFAULT_MASTER_CONFIG)) || DEFAULT_MASTER_CONFIG;
        const configResult = interpretSuperAdminConfigCommand(message, currentConfig);
        if (configResult.isConfigCommand) {
          if (configResult.isSecurityViolation) {
            return res.json({
              success: true,
              reply: configResult.securityMessage || 'Security modification restricted.',
              suggestions: [
                'Change Admin sidebar to blue',
                'Set Focal Person font to Poppins',
                'Show today\'s registry status',
              ],
            });
          }

          if (configResult.proposedChange) {
            return res.json({
              success: true,
              reply: configResult.previewMessage || 'Proposed configuration change ready for review.',
              action: {
                type: 'confirm_config_change',
                actionId: 'apply_proposed_config',
                label: 'Apply Configuration Change',
                payload: configResult.proposedChange,
              },
              suggestions: [
                'Cancel',
                'Reset Admin appearance',
                'Show today\'s registry status',
              ],
            });
          }
        }
      }

      // Check cross-barangay queries for Focal Persons
      if (user.role === 'focal' && user.assignedBarangay) {
        const assignedLower = user.assignedBarangay.toLowerCase();
        const matchedBg = HINUNANGAN_BARANGAYS.find(
          b => lower.includes(b.name.toLowerCase()) && b.name.toLowerCase() !== assignedLower
        );
        if (matchedBg) {
          return res.json({
            success: true,
            reply: `I can only provide registry and GIS information for your assigned barangay/areas.`,
            suggestions: [
              `Show records for ${user.assignedBarangay}`,
              `How many ready to sell in ${user.assignedBarangay}?`,
              'Register a new swine',
            ],
          });
        }
      }

      // Agent / Buyer restrictions: Restricted to market-ready hogs, takeoff catalog, public ordinances, and contact info.
      // No access to confidential farmer/swine details outside takeoff.
      if (user.isAgent) {
        const isConfidentialQuery =
          lower.includes('farmer list') ||
          lower.includes('all farmers') ||
          lower.includes('audit') ||
          lower.includes('inspection record') ||
          lower.includes('sick pig') ||
          lower.includes('quarantined');

        if (isConfidentialQuery) {
          return res.json({
            success: true,
            reply: `As an accredited Agent / Buyer, your access is focused on the Ready for Take-Off market catalog, verified commercial hog availability, and transport clearance requirements.`,
            action: {
              type: 'navigate',
              tab: 'takeoff',
              label: 'View Ready for Take-Off Catalog',
            },
            suggestions: [
              'How many swine are ready to sell?',
              'What are the transport requirements?',
              'Show takeoff catalog',
            ],
          });
        }
      }

      const { records: allRecords } = await getAllSwineRecords();

      // Role-based record filtration
      let authorizedRecords = allRecords;
      if (user.role === 'focal') {
        const assigned = (user.assignedBarangay || '').toLowerCase().trim();
        if (assigned) {
          authorizedRecords = allRecords.filter(r =>
            (r.barangay || '').toLowerCase().trim() === assigned ||
            (r.barangay_id && r.barangay_id.toLowerCase().includes(assigned))
          );
        } else {
          authorizedRecords = [];
        }
      } else if (user.isAgent) {
        authorizedRecords = allRecords.filter(r =>
          !r.isArchived && (r.readyToSell || (r.weightKg && r.weightKg >= 75)) &&
          r.status !== 'sold' && r.status !== 'deceased'
        );
      }

      // 1. Swine Registration queries
      if (
        lower.includes('register') ||
        lower.includes('registration') ||
        lower.includes('add swine') ||
        lower.includes('new pig') ||
        lower.includes('how to register')
      ) {
        return res.json({
          success: true,
          reply: `📋 **DA Hinunangan Official Swine Registration Workflow**:

1. **Owner / Raiser Identification**: Collect the raiser's full legal name, contact number, and exact Barangay / Purok address.
2. **Swine Biometric Details**: Record the official Ear Tag / Pig ID, breed (Landrace, Large White, Duroc, Native, etc.), age in months, and current estimated weight (kg).
3. **Health & Biosecurity Verification**: Confirm vaccination status (Hog Cholera, Deworming), current health status (Healthy / Under Observation / Sick), and pen biosecurity standard.
4. **GIS GPS Pinning**: Capture the exact geocoordinates (latitude & longitude) of the farm or backyard pen to pin the swine on the Municipal Biosurveillance Map.

*Field Note: You can register swine even without internet access! The offline queue will synchronize your records automatically once connected.*`,
          action: {
            type: 'navigate',
            tab: 'records',
            label: 'Go to Swine Records to Register',
          },
          suggestions: [
            'How many swine are registered?',
            'How does offline mode work?',
            'Open GIS Swine Map',
          ],
        });
      }

      // 2. Ready for Take-Off / Market Inquiries
      if (
        lower.includes('ready to sell') ||
        lower.includes('take off') ||
        lower.includes('take-off') ||
        lower.includes('market') ||
        lower.includes('commercial') ||
        lower.includes('buyer')
      ) {
        const readyHogs = authorizedRecords.filter(
          r => !r.isArchived && (r.readyToSell || (r.weightKg && r.weightKg >= 75)) && r.status !== 'sold' && r.status !== 'deceased'
        );
        const avgWeight = readyHogs.length > 0
          ? Math.round(readyHogs.reduce((acc, h) => acc + (h.weightKg || 0), 0) / readyHogs.length)
          : 0;

        const scopeLabel = user.role === 'focal' && user.assignedBarangay
          ? `in Barangay ${user.assignedBarangay}`
          : 'municipal-wide across Hinunangan';

        return res.json({
          success: true,
          reply: `🚀 **Ready for Take-Off Status (${scopeLabel})**:

• **Eligible Market Hogs**: **${readyHogs.length} head** currently qualified for commercial sale.
• **Average Market Weight**: **${avgWeight} kg**
• **Criteria**: Swine tagged as ready-to-sell or weighing 75kg and above with valid health status.
• **Clearance Requirement**: Must possess a valid DA Veterinary Health Certificate and Barangay Transport Clearance before dispatch.`,
          action: {
            type: 'navigate',
            tab: 'takeoff',
            label: 'View Ready for Take-Off Catalog',
          },
          suggestions: [
            'How many swine are registered in total?',
            'How do I print a transport clearance?',
            'Show biosecurity status',
          ],
        });
      }

      // 3. Live Database Status & Count Inquiries
      if (
        lower.includes('how many') ||
        lower.includes('count') ||
        lower.includes('total') ||
        lower.includes('status') ||
        lower.includes('summary') ||
        lower.includes('dashboard')
      ) {
        const total = authorizedRecords.length;
        const activeRaisers = new Set(authorizedRecords.map(r => (r.ownerName || '').trim().toLowerCase()).filter(Boolean)).size;
        const readyHogs = authorizedRecords.filter(
          r => !r.isArchived && (r.readyToSell || (r.weightKg && r.weightKg >= 75)) && r.status !== 'sold' && r.status !== 'deceased'
        );
        const healthyCount = authorizedRecords.filter(r => (r.healthStatus || 'healthy').toLowerCase() === 'healthy').length;
        const underObservationCount = authorizedRecords.filter(r => (r.healthStatus || '').toLowerCase() === 'under observation').length;
        const avgWeight = total > 0
          ? Math.round(authorizedRecords.reduce((acc, r) => acc + (r.weightKg || 0), 0) / total)
          : 0;

        const scopeLabel = user.role === 'focal' && user.assignedBarangay
          ? `Barangay ${user.assignedBarangay}`
          : 'Municipality of Hinunangan';

        return res.json({
          success: true,
          reply: `📊 **Live Registry & Biosurveillance Summary (${scopeLabel})**:

• **Total Swine Registered**: **${total.toLocaleString()} head**
• **Registered Raisers**: **${activeRaisers.toLocaleString()} farmers**
• **Ready for Take-Off**: **${readyHogs.length} head**
• **Biosecurity Health**: **${healthyCount} healthy**, **${underObservationCount} under observation**
• **Average Weight**: **${avgWeight} kg**

All metrics reflect live, real-time records from the database.`,
          action: {
            type: 'navigate',
            tab: 'dashboard',
            label: 'View Full Dashboard Metrics',
          },
          suggestions: [
            'How many are ready to sell?',
            'Open GIS Swine Map',
            'How do I register a swine?',
          ],
        });
      }

      // 4. GIS & Spatial Mapping queries
      if (
        lower.includes('gis') ||
        lower.includes('map') ||
        lower.includes('gps') ||
        lower.includes('coordinates') ||
        lower.includes('location') ||
        lower.includes('pin')
      ) {
        return res.json({
          success: true,
          reply: `🗺️ **GIS Swine Biosurveillance Map**:

The interactive GIS mapping module provides spatial visualization for all registered pens and swine populations in Hinunangan:
• **Barangay Boundaries**: GeoJSON polygons outline each barangay's biosecurity zones.
• **Spatial Pins**: Color-coded pins indicate farm locations, health statuses (Green = Healthy, Yellow = Observation, Red = Quarantine/Infected).
• **Clustering & Heatmap**: High-density swine zones are automatically clustered for outbreak risk assessment.
• **GPS Pinning**: Field focal persons can click or tap anywhere on the map to automatically pin coordinates during registration.`,
          action: {
            type: 'navigate',
            tab: 'gis',
            label: 'Open GIS Swine Map',
          },
          suggestions: [
            'How does ASF biosecurity work?',
            'Show total swine records',
            'How to print reports?',
          ],
        });
      }

      // 5. ASF & Biosecurity Regulations queries
      if (
        lower.includes('asf') ||
        lower.includes('african swine fever') ||
        lower.includes('biosecurity') ||
        lower.includes('quarantine') ||
        lower.includes('zone') ||
        lower.includes('ordinance') ||
        lower.includes('decree')
      ) {
        return res.json({
          success: true,
          reply: `🛡️ **African Swine Fever (ASF) Biosecurity Protocol**:

Under Municipal Ordinance and National DA Administrative Orders (Babay ASF Program):
1. **Zoning Classification**:
   • **Red Zone (Infected)**: Confirmed outbreak within 1km radius. Strict lockdown on swine and pork movement.
   • **Pink Zone (Buffer)**: 7km containment perimeter with mandatory biosecurity checkpoints.
   • **Yellow Zone (Surveillance)**: Intensive random blood sampling and active surveillance.
   • **Green Zone (Free)**: Disease-free zone with standard biosecurity clearances.
2. **Preventive Farm Measures**:
   • Mandatory footbaths and disinfectant sprays at pen entrances.
   • Strict ban on swill feeding (bahog / kaning-baboy).
   • Restrict farm visitors and animal dealers without DA permits.`,
          action: {
            type: 'navigate',
            tab: 'biosecurity',
            label: 'Go to Barangay Biosecurity Module',
          },
          suggestions: [
            'View ASF Legal Decrees',
            'How to register a swine?',
            'Show today\'s registry status',
          ],
        });
      }

      // 6. Reports & Certificates queries
      if (
        lower.includes('report') ||
        lower.includes('print') ||
        lower.includes('certificate') ||
        lower.includes('export') ||
        lower.includes('pdf')
      ) {
        return res.json({
          success: true,
          reply: `📑 **Official DA Hinunangan Reports & Documentation**:

You can generate and print official livestock documentation directly:
• **Municipal Swine Inventory Summary**: Complete head count by barangay and breed.
• **Barangay Biosecurity Assessment Report**: Zone-level audit with risk indices.
• **Veterinary Health Clearance / Certificate**: Required document for hog transport and market take-off.
• **Export to Excel / PDF**: Instant downloadable tabular spreadsheets and printable letterhead reports.`,
          action: {
            type: 'navigate',
            tab: 'reports',
            label: 'Go to Print Official Reports',
          },
          suggestions: [
            'How many swine ready to sell?',
            'Show registry summary',
            'Open GIS Swine Map',
          ],
        });
      }

      // 7. Offline & PWA queries
      if (
        lower.includes('offline') ||
        lower.includes('pwa') ||
        lower.includes('no internet') ||
        lower.includes('sync') ||
        lower.includes('connection')
      ) {
        return res.json({
          success: true,
          reply: `📱 **Field Offline Mode & Automatic Synchronization**:

The DA Hinunangan Swine Registry is engineered as a Progressive Web App (PWA):
• **Field Operation**: You can register swine, pin GPS coordinates, and inspect farms even in remote puroks without mobile signal.
• **Offline Storage**: Records and photos are saved securely on your device via IndexedDB.
• **Automatic Sync**: When your device reconnects to Wi-Fi or cellular data, all pending records sync seamlessly with the central municipal database.`,
          suggestions: [
            'How to register a swine?',
            'Open GIS Swine Map',
            'Show today\'s registry status',
          ],
        });
      }

      // 8. Gemini AI Engine for Real-Time Contextual Explanation and Q&A (Strictly Grounded in System Data)
      if (process.env.GEMINI_API_KEY) {
        try {
          const { GoogleGenAI } = await import('@google/genai');
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

          const totalSwine = authorizedRecords.length;
          const readyCount = authorizedRecords.filter(
            r => !r.isArchived && (r.readyToSell || (r.weightKg && r.weightKg >= 75)) && r.status !== 'sold' && r.status !== 'deceased'
          ).length;
          const healthyCount = authorizedRecords.filter(r => (r.healthStatus || 'healthy').toLowerCase() === 'healthy').length;
          const underObsCount = authorizedRecords.filter(r => (r.healthStatus || '').toLowerCase() === 'under observation').length;
          const sickCount = authorizedRecords.filter(r => (r.healthStatus || '').toLowerCase() === 'sick').length;
          const raisersCount = new Set(authorizedRecords.map(r => (r.farmerName || r.ownerName || '').trim().toLowerCase()).filter(Boolean)).size;

          const scopeText = user.role === 'focal' && user.assignedBarangay
            ? `Assigned Barangay: ${user.assignedBarangay}`
            : 'Municipality of Hinunangan (All 40 Barangays)';

          const systemPrompt = `You are the official "DA Hinunangan Biosecurity Assistant" for the Municipal Agriculture Office of Hinunangan, Southern Leyte. User role: ${user.role} (${user.username}). Scope: ${scopeText}.

CRITICAL OPERATIONAL RULES:
1. ONLY INTERNAL SYSTEM TOPICS: You must strictly ONLY answer about the DA Hinunangan Swine Registry & Biosurveillance system, its data, swine records, barangays, and biosecurity rules. NEVER search for external random topics or discuss unrelated general internet information (Dili mogawas sa sistema).
2. DIRECT DATA & WHERE TO INPUT:
   - Where to input data ("asa mo input", "how to input", "register swine", "add record"): Direct the user to the "Swine Records" tab -> click the green "[+ Register Swine]" button (or "Swine Farm Registration" on the Dashboard). Explain the required fields: Raiser Details (Name, Contact, Address/Barangay, RSBSA ID), Swine Details (Ear Tag, Pig ID HIN-YYYY-XXXX, DOB/Age auto-calculation, Breed, Weight, Farm Scale, Health Status), Biosecurity Checklist, and GIS GPS Coordinates ("Pin GPS on Map").
   - Live system figures: Total Swine: ${totalSwine} head, Registered Raisers: ${raisersCount} farmers, Ready for Take-Off: ${readyCount} head, Healthy: ${healthyCount}, Under Observation: ${underObsCount}, Sick: ${sickCount}.
   - Ready-to-sell: Direct them to the "Ready for Take-Off" tab (eligible hogs with verified health).
   - Biosecurity / ASF: Direct them to "Barangay Biosecurity" and "ASF Legal Decrees". Hinunangan has 40 barangays categorized into ASF zones (Red = 1km infected lockdown, Pink = 7km buffer, Yellow = surveillance, Green = disease-free).
   - GIS Map: Direct them to the "GIS Swine Map" tab.
   - Reports: Direct them to "Print Official Reports" tab (export to PDF/Excel, printable certificates).
   - User Accounts: Direct them to "User Accounts" tab (accessible to both Super Admin and Admin to manage Focal Persons, Agents, and Admins).
3. MULTILINGUAL SUPPORT: Answer fluently in English, Tagalog, or Cebuano / Bisaya depending on what the user asks.
4. Keep answers concise, direct, helpful, and polite.`;

          const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: message,
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.2,
            },
          });

          if (response.text) {
            let action: any = undefined;
            if (lower.includes('input') || lower.includes('register') || lower.includes('add swine')) {
              action = { type: 'navigate', tab: 'records', label: 'Go to Swine Records to Input' };
            } else if (lower.includes('gis') || lower.includes('map')) {
              action = { type: 'navigate', tab: 'gis', label: 'Open GIS Swine Map' };
            } else if (lower.includes('take off') || lower.includes('takeoff') || lower.includes('ready to sell')) {
              action = { type: 'navigate', tab: 'takeoff', label: 'View Ready for Take-Off Catalog' };
            } else if (lower.includes('biosecurity') || lower.includes('asf')) {
              action = { type: 'navigate', tab: 'biosecurity', label: 'View Barangay Biosecurity' };
            } else if (lower.includes('report') || lower.includes('print')) {
              action = { type: 'navigate', tab: 'reports', label: 'Print Official Reports' };
            } else if (lower.includes('account') || lower.includes('user')) {
              action = { type: 'navigate', tab: 'accounts', label: 'Manage User Accounts' };
            }

            return res.json({
              success: true,
              reply: response.text.trim(),
              action,
              suggestions: [
                'Show today\'s registry status',
                'How many swine are ready to sell?',
                'How to register a swine?',
                'Open GIS Swine Map',
              ],
            });
          }
        } catch (aiErr) {
          console.warn('Authenticated Gemini API call fallback:', aiErr);
        }
      }

      // Default contextual response
      return res.json({
        success: true,
        reply: `👋 Hello **${user.username}**! I am the **DA Hinunangan Biosecurity & Registry Assistant**.

I can assist you with:
• **Live Database Metrics**: Check current swine population, ready-to-sell hogs, and raiser statistics.
• **Registration Assistance**: Step-by-step guidance on registering farmers and swine with GPS coordinates.
• **GIS Mapping**: Biosurveillance navigation, coordinate pinning, and barangay zone layers.
• **ASF Biosecurity Protocols**: Movement restrictions, zoning regulations, and quarantine standards.
• **Official Reports**: Generating inventory summaries and transport clearances.

How may I assist your agricultural operations today?`,
        suggestions: user.role === 'focal' && user.assignedBarangay
          ? [
              `Show records for ${user.assignedBarangay}`,
              `How many ready to sell in ${user.assignedBarangay}?`,
              'Register a new swine',
              'Open GIS Swine Map',
            ]
          : user.isAgent
          ? [
              'How many swine are ready to sell?',
              'View Ready for Take-Off catalog',
              'What are the transport requirements?',
            ]
          : [
              'Show today\'s registry status',
              'How many swine are ready to sell?',
              'How do I register a swine?',
              'Open GIS Swine Map',
            ],
      });
    } catch (err: any) {
      console.error('Biosecurity Assistant endpoint error:', err);
      return res.status(500).json({
        success: false,
        error: 'Assistant service temporarily unavailable.',
      });
    }
  });

  return app;
}

export const app = createApp();
