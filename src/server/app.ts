import { loadPublicRegistrySummary } from './publicRegistry.ts';
import { assistantErrorCode, assistantErrorMessage } from './assistantErrors.ts';
import { answerAssistant, type Generate } from './assistantEngine.ts';
import type { ASFRegulatoryDocument } from '../types.ts';
import { validateImportFieldDefinitions, validateImportRecordShape } from './swineImportValidation.ts';
import { IMPORT_LIMITS, coerceImportValue, stableImportFingerprint } from '../utils/swineImportData.ts';
import { persistSwineImportBatch, permanentlyDeleteArchivedSwineRecord, SwinePermanentDeleteError, wasSwinePermanentlyDeleted } from '../db/swine.ts';
import { farmerIdentity } from '../utils/farmerIdentity.ts';
import { authorizeMessagePayload } from './messageAuthorization.ts';
import { normalizeBiosecurityAudits, scopeBiosecurityItems } from './biosecurityValidation.ts';
import { CLOUD_ITEM_KEYS, mutateModuleItem, visibleModuleItems } from './moduleItems.ts';
import { assertImmutableSwineIdentity, validateSwineMutation } from './swineMutationValidation.ts';
import { resolveSwineReadFilters, agentMayReadSwine } from './swineReadScope.ts';
import { canArchiveSwineRecord, canPermanentlyDeleteSwineRecord } from './swineArchivePermissions.ts';
import { hasVerifiableSourceAttachment, isLegalDocument, mutateLegalDocument } from '../db/legalDocuments.ts';
import express from 'express';
import { getDatabaseDiagnostic } from '../db/diagnostics.ts';
import { getDatabaseConnectionInfo, getDatabasePoolConfig } from '../db/poolConfig.ts';
import { getSchemaProbeFailure, verifyDatabaseSchema } from './databaseHealth.ts';
import { createHash, randomUUID } from 'node:crypto';
import { HINUNANGAN_BARANGAYS } from '../data/barangays.ts';
import {
  getAllSwineRecords,
  getSwineRecordById,
  setSwineArchiveStatus,
  upsertSwineRecord,
  batchUpsertSwineRecords,
  getNextAuthoritativePigIdTag,
} from '../db/swine.ts';
import { archiveCertificateByControlNumber, getAllCertificates, getCertificateByIdOrControlNumber, upsertCertificate } from '../db/certificates.ts';
import { getCertificateTemplates, saveCertificateTemplate } from '../db/certificateTemplates.ts';
import { filterCertificateTemplatesForUser, isCertificateTemplateIssuable } from '../utils/certificateTemplateFilters.ts';
import { formatCertificateTemplateDatabaseError } from '../utils/certificateTemplateDatabaseError.ts';
import { getAllUsers, getUserByAuthUserId, getUserByUsernameOrEmail, insertUserProfile, upsertUser, deleteUserByUid } from '../db/users.ts';
import { getAllMessages, createMessage, markMessageRead, deleteMessageById } from '../db/messages.ts';
import { getAllMedia, insertMedia, deleteMediaById } from '../db/media.ts';
import { getStoredSystemSetting, getSystemSetting, setSystemSetting } from '../db/settings.ts';
import { pool } from '../db/index.ts';
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
  createCertificateTemplateSourceSignedUrl,
  createLegalDocumentSignedUrl,
  verifyDirectCertificateTemplateSource,
  verifyDirectImage,
  verifyDirectLegalDocument,
  deleteLandingCmsAsset,
  uploadCertificateAsset,
  uploadLandingCmsAsset,
} from './supabaseStorage.ts';
import { interpretSuperAdminConfigCommand } from '../utils/configCommandInterpreter.ts';
import { isValidPhilippinePhoneNumber, normalizePhilippinePhoneNumber, toFieldKey } from '../utils/registryFieldUtils.ts';
import { getSupabaseProjectConfigurationError, getSupabaseAdminConfigError, getSupabaseAuthConfigStatus, supabaseAdminClient, supabaseAuthClient, supabaseAuthProjectRef } from '../lib/supabaseServer.ts';

export function createApp(options: { assistantGenerate?: Generate } = {}) {
  const app = express();
  app.set('case sensitive routing', true);

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

  const getDatabaseErrorCode = (error: unknown) => getDatabaseDiagnostic(error).code;
  const getDatabaseErrorKind = (error: unknown) => getDatabaseDiagnostic(error).kind;

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

  // Startup must never mutate the production schema. Review migrations separately.
  const authConfigurationError = getSupabaseProjectConfigurationError();
  if (authConfigurationError) console.error('[CONFIG] supabase_configuration_invalid', { kind: authConfigurationError });
  try { getDatabasePoolConfig(); } catch (error) {
    console.error('[CONFIG] database_configuration_invalid', { ...getDatabaseDiagnostic(error), connection: getDatabaseConnectionInfo() });
  }

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));

  app.use(async (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const isPublicRoute =
      req.path === '/api/health' ||
      (req.method === 'POST' && ['/api/auth/login', '/api/auth/superadmin-login', '/api/public/assistant/chat'].includes(req.path)) ||
      (req.method === 'GET' && ['/api/public/registry-summary', '/api/landing-cms/published', '/api/landing-config', '/api/landing/settings', '/api/legal-documents', '/api/barangays'].includes(req.path));

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
      if (!['super_admin', 'admin', 'focal', 'agent'].includes(profile.role)) {
        if (isPublicRoute) return next();
        return res.status(403).json({ success: false, error: 'This account does not have an authorized application role.' });
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
    let schemaStatus: 'not_checked' | 'ready' | 'not_ready' | 'error' = 'not_checked';
    let configurationError = getSupabaseProjectConfigurationError();
    const databaseProject = getConfiguredDatabaseProjectRef();
    if (databaseProject && supabaseAuthProjectRef && databaseProject !== supabaseAuthProjectRef) configurationError = 'project_mismatch';
    let databaseErrorCode: string | undefined;
    let databaseErrorKind: string | undefined;
    let databaseTlsReason: string | undefined;
    let schemaFailure: ReturnType<typeof getSchemaProbeFailure>;
    try {
      const client = await pool.connect();
      try {
        // Establish query connectivity independently of the application's columns.
        await client.query('SELECT 1');
        dbStatus = 'connected';
        try {
          await verifyDatabaseSchema(client);
          schemaStatus = 'ready';
        } catch (err: any) {
          schemaStatus = getDatabaseErrorKind(err) === 'schema_error' ? 'not_ready' : 'error';
          databaseErrorCode = getDatabaseErrorCode(err);
          databaseErrorKind = getDatabaseErrorKind(err);
          databaseTlsReason = getDatabaseDiagnostic(err).tlsReason;
          schemaFailure = getSchemaProbeFailure(err);
          if (['network_unreachable', 'connection_refused', 'connection_timeout', 'host_not_found', 'tls_error'].includes(databaseErrorKind || '')) dbStatus = 'error';
        }
      } finally {
        client.release();
      }
    } catch (err: any) {
      dbStatus = 'error';
      databaseErrorCode = getDatabaseErrorCode(err);
      databaseErrorKind = getDatabaseErrorKind(err);
      databaseTlsReason = getDatabaseDiagnostic(err).tlsReason;
    }
    let authAdminStatus: 'not_configured' | 'valid' | 'invalid' = 'not_configured';
    let authAdminError: string | undefined;
    if (supabaseAdminClient) {
      let authProbeTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const { error } = await Promise.race([
          supabaseAdminClient.auth.admin.listUsers({ page: 1, perPage: 1 }),
          new Promise<never>((_resolve, reject) => {
            authProbeTimeout = setTimeout(() => reject(new Error('Supabase Auth health check timed out.')), 3000);
          }),
        ]);
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
      } finally {
        clearTimeout(authProbeTimeout);
      }
    } else {
      authAdminError = getSupabaseAdminConfigError() || 'Supabase Auth Admin client is not initialized.';
    }

    const healthy = dbStatus === 'connected' && schemaStatus === 'ready' && !configurationError && authAdminStatus === 'valid';
    if (!healthy) console.error('[HEALTH] dependency_check_failed', {
      database: dbStatus, schemaStatus, code: databaseErrorCode, kind: databaseErrorKind,
      configuration: configurationError, auth: authAdminStatus,
      tlsReason: databaseTlsReason, connection: getDatabaseConnectionInfo(),
      schema: schemaFailure,
    });
    res.set('Cache-Control', 'no-store');
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      service: 'hinunangan-swine-registry',
      database: dbStatus,
      schema: schemaStatus,
      cloud: healthy ? 'online' : 'unavailable',
      authentication: authAdminStatus === 'valid' && !configurationError ? 'available' : 'unavailable',
      ...(configurationError ? { configuration_error: configurationError } : {}),
      ...(databaseErrorCode ? { database_error_code: databaseErrorCode } : {}),
      ...(databaseErrorKind ? { database_error_kind: databaseErrorKind } : {}),
      ...(databaseTlsReason ? { database_tls_reason: databaseTlsReason } : {}),
      ...(schemaFailure ? { schema_error: { table: schemaFailure.table, ...(schemaFailure.column ? { column: schemaFailure.column } : {}) } } : {}),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/connectivity', async (req, res) => {
    if (!(req as any).authenticatedUser?.userId) {
      return res.status(401).json({ success: false, error: 'An active authenticated session is required.' });
    }

    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      res.set('Cache-Control', 'no-store');
      return res.json({
        connection_check: true,
        service: 'hinunangan-swine-registry',
        database: 'connected',
      });
    } catch (error) {
      const diagnostic = getDatabaseDiagnostic(error);
      console.error('[CONNECTIVITY] authorized_database_probe_failed', {
        kind: diagnostic.kind,
        code: diagnostic.code,
      });
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({
        connection_check: true,
        service: 'hinunangan-swine-registry',
        database: 'error',
        database_error_kind: diagnostic.kind,
      });
    }
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
    return {
      role,
      barangayId,
      assignedBarangay,
      userId,
      username,
      permissions: authenticatedUser?.permissions || [],
      isSuperAdmin,
      isAdmin,
      isAgent,
      isFocal,
      isAuthenticated,
    };
  }

  async function validateCertificateSwineSelection(
    certificate: Record<string, any>,
    user: ReturnType<typeof getUserSecurityContext>,
    required: boolean,
  ): Promise<string | null> {
    const swineIds = certificate.swineIds;
    if (!Array.isArray(swineIds) || swineIds.length === 0) {
      return required ? 'Select at least one registered swine before issuing a certificate.' : null;
    }
    if (swineIds.length > 200 || swineIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ||
        new Set(swineIds).size !== swineIds.length) {
      return 'The selected swine list is invalid.';
    }
    if (user.isFocal && !user.assignedBarangay.trim()) {
      return 'Your account must be assigned to a barangay to issue certificates.';
    }

    const result = await pool.query<{
      id: string;
      farmerName: string;
      farmerAddress: string | null;
      barangay: string;
      isArchived: boolean;
    }>(
      `SELECT sr.id, sr.farmer_name AS "farmerName", f.farm_address AS "farmerAddress",
              b.name AS barangay, sr.is_archived AS "isArchived"
       FROM public.swine_records sr
       JOIN public.barangays b ON b.id = sr.barangay_id
       LEFT JOIN public.farmers f ON f.id = sr.farmer_id
       WHERE sr.id = ANY($1::uuid[])`,
      [swineIds],
    );
    if (result.rows.length !== swineIds.length || result.rows.some(row => row.isArchived)) {
      return 'One or more selected swine are unavailable or archived.';
    }
    const first = result.rows[0];
    if (result.rows.some(row =>
      row.farmerName.trim().toLowerCase() !== first.farmerName.trim().toLowerCase() ||
      row.barangay.trim().toLowerCase() !== first.barangay.trim().toLowerCase()
    )) {
      return 'A certificate may include only swine belonging to one farmer in one barangay.';
    }
    if (certificate.farmerName?.trim().toLowerCase() !== first.farmerName.trim().toLowerCase()) {
      return 'The selected swine do not belong to the displayed farmer.';
    }
    if (user.isFocal && first.barangay.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase()) {
      return 'Only swine from your assigned barangay may be included in a certificate.';
    }
    if (certificate.barangay?.trim().toLowerCase() !== first.barangay.trim().toLowerCase()) {
      return 'The certificate barangay must match the selected swine records.';
    }
    if (Number(certificate.numberOfHeads) !== swineIds.length) {
      return 'The certificate head count must match the number of selected swine.';
    }
    certificate.farmerAddress = first.farmerAddress || certificate.farmerAddress || '';
    return null;
  }

  async function validateCertificateTemplateIssuance(
    certificate: Record<string, any>,
    user: ReturnType<typeof getUserSecurityContext>,
  ): Promise<string | null> {
    if (typeof certificate.templateId !== 'string' || !certificate.templateId.trim()) return null;
    const storedTemplates = await getCertificateTemplates();
    const template = filterCertificateTemplatesForUser(storedTemplates, user)
      .find(item => item.id === certificate.templateId);
    if (!template) return 'The certificate template is unavailable or outside your authorized barangay.';
    if (!isCertificateTemplateIssuable(template)) {
      return 'This certificate template is still a draft or inactive and cannot be issued.';
    }
    return null;
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
    const sourceUrl = user.isAdmin && template.sourceDocument?.storagePath && supabaseAdminClient
      ? await createCertificateTemplateSourceSignedUrl(supabaseAdminClient, template.sourceDocument.storagePath)
      : undefined;
    return {
      ...template,
      sourceDocument: template.sourceDocument
        ? { ...template.sourceDocument, url: sourceUrl }
        : undefined,
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
    ...CLOUD_ITEM_KEYS,
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
      if (CLOUD_ITEM_KEYS.has(req.params.key)) value = visibleModuleItems(Array.isArray(value)?value:[],req.params.key,user);
      if (req.params.key.startsWith('biosecurity_') && !user.isAdmin) {
        if (!user.isFocal || !user.assignedBarangay) return res.status(403).json({success:false,error:'An assigned focal person or administrator is required.'});
        value = scopeBiosecurityItems(Array.isArray(value) ? value : [], user.assignedBarangay);
      }
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
    if (CLOUD_ITEM_KEYS.has(req.params.key)) return res.status(400).json({success:false,error:'Save one module item at a time.'});
    if (req.params.key.startsWith('biosecurity_') && !user.isAdmin && (!user.isFocal || !user.assignedBarangay)) {
      return res.status(403).json({success:false,error:'An assigned focal person or administrator is required.'});
    }
    if (!sharedModuleDataKeys.has(req.params.key) ||
      (req.params.key === 'certificate_templates'
        ? !user.isAdmin
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
      if (req.params.key === 'certificate_templates' && req.body.data.sourceDocument) {
        const source = req.body.data.sourceDocument;
        if (!user.isAdmin || !supabaseAdminClient ||
            typeof source.fileName !== 'string' || typeof source.mimeType !== 'string' ||
            typeof source.storagePath !== 'string') {
          return res.status(user.isAdmin ? 503 : 403).json({
            success: false,
            error: user.isAdmin ? 'Certificate source storage is unavailable or its metadata is invalid.' : 'Administrator access is required.',
          });
        }
        try {
          await verifyDirectCertificateTemplateSource(supabaseAdminClient, source.storagePath, source.fileName, source.mimeType);
        } catch (error) {
          console.error('[certificate-template] persisted source validation failed', error);
          return res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'The imported source file is unavailable.',
          });
        }
      }
      if (req.params.key.startsWith('biosecurity_')) {
        let items = req.body.data;
        if (user.isFocal && scopeBiosecurityItems(items,user.assignedBarangay).length !== items.length) {
          return res.status(403).json({success:false,error:'Biosecurity records must stay within your assigned barangay.'});
        }
        try { if (req.params.key === 'biosecurity_audits') items = normalizeBiosecurityAudits(items); }
        catch (error) { return res.status(400).json({success:false,error:(error as Error).message}); }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.params.key]);
          const stored = await client.query('SELECT setting_value FROM public.system_settings WHERE setting_key = $1 FOR UPDATE',[req.params.key]);
          const existing = stored.rows[0]?.setting_value || [];
          if (user.isFocal && req.params.key === 'biosecurity_audits') {
            items = items.map((item:any) => {
              const previous = existing.find((old:any) => old.id === item.id);
              // Focal edits require fresh administrative approval; untouched rows keep approval.
              return JSON.stringify(previous) === JSON.stringify(item) ? item : { ...item, reviewStatus: 'draft' };
            });
          }
          if (user.isFocal) {
            const other = existing.filter((item:any)=>!scopeBiosecurityItems([item],user.assignedBarangay).length);
            if (items.some((item:any)=>other.some((row:any)=>row.id===item.id))) {
              await client.query('ROLLBACK');
              return res.status(403).json({success:false,error:'A biosecurity record ID belongs to another barangay.'});
            }
            items = [...other,...items];
          }
          await client.query('INSERT INTO public.system_settings (id, setting_key, setting_value, updated_at) VALUES ($1,$2,$3::jsonb,NOW()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()',[randomUUID(),req.params.key,JSON.stringify(items)]);
          await client.query('COMMIT');
          return res.json({success:true,data:user.isFocal?scopeBiosecurityItems(items,user.assignedBarangay):items});
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }
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

  const handleModuleItem = async (req: express.Request,res: express.Response) => {
    const user=getUserSecurityContext(req);
    if (!user.isAdmin && (!user.isFocal || !user.assignedBarangay || req.params.key==='marketing_alerts')) return res.status(403).json({success:false,error:'You do not have permission to change this module.'});
    try { return res.json({success:true,data:await mutateModuleItem(req.params.key,req.params.id,req.body,req.method==='DELETE',user)}); }
    catch(error) { return res.status(400).json({success:false,error:error instanceof Error?error.message:'Module save failed.'}); }
  };
  app.put('/api/module-data/:key/items/:id',handleModuleItem);
  app.delete('/api/module-data/:key/items/:id',handleModuleItem);

  // =========================================================================
  // 2. SWINE RECORDS - STRICT DATABASE SOURCE OF TRUTH
  // =========================================================================

  app.post('/api/storage/upload-url', async (req, res) => {
    const user = getUserSecurityContext(req);
    const { target, fileName, mimeType, documentId } = req.body || {};
    if (target === 'certificate-template') {
      if (!user.isAdmin) return res.status(403).json({ success: false, error: 'Only administrators can import certificate templates.' });
      if (!supabaseAdminClient) return res.status(503).json({ success: false, error: 'Supabase Storage is unavailable.' });
      const extension = typeof fileName === 'string' ? fileName.split('.').pop()?.toLowerCase() : '';
      const extensionsByType: Record<string, string[]> = {
        'application/pdf': ['pdf'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
        'image/jpeg': ['jpg', 'jpeg'],
        'image/png': ['png'],
      };
      if (typeof fileName !== 'string' || !extensionsByType[mimeType]?.includes(extension || '')) {
        return res.status(400).json({ success: false, error: 'Choose a PDF, DOCX, JPEG, or PNG certificate.' });
      }
      try {
        const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'certificate-source';
        const filePath = `shared/certificate-imports/${randomUUID()}-${safeFileName}`;
        const signed = await supabaseAdminClient.storage.from('certificates').createSignedUploadUrl(filePath);
        if (signed.error) throw signed.error;
        return res.json({ success: true, bucket: 'certificates', filePath, token: signed.data.token });
      } catch (error) {
        console.error('[certificate-template] unable to prepare source upload', error);
        return res.status(503).json({ success: false, error: 'Unable to prepare a private certificate source upload.' });
      }
    }
    if (target === 'legal-document') {
      if (!user.isAdmin) return res.status(403).json({ success: false, error: 'Only administrators can upload legal documents.' });
      if (!supabaseAdminClient) return res.status(503).json({ success: false, error: 'Supabase Storage is unavailable.' });
      const legalTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg',
        'image/png',
      ];
      const extension = typeof fileName === 'string' ? fileName.split('.').pop()?.toLowerCase() : '';
      const extensionsByType: Record<string, string[]> = {
        'application/pdf': ['pdf'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
        'image/jpeg': ['jpg', 'jpeg'],
        'image/png': ['png'],
      };
      if (typeof documentId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(documentId) ||
          typeof fileName !== 'string' || !extensionsByType[mimeType]?.includes(extension || '') ||
          !legalTypes.includes(mimeType)) {
        return res.status(400).json({ success: false, error: 'Choose a PDF, DOCX, JPEG, or PNG file and a valid legal document.' });
      }
      try {
        const existing = await pool.query('SELECT id FROM public.legal_documents WHERE id = $1', [documentId]);
        if (!existing.rows.length) return res.status(404).json({ success: false, error: 'Save the legal document record before uploading an attachment.' });
        const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'legal-document';
        const filePath = `legal-documents/${documentId}/${randomUUID()}-${safeFileName}`;
        const signed = await supabaseAdminClient.storage.from('documents').createSignedUploadUrl(filePath);
        if (signed.error) throw signed.error;
        return res.json({ success: true, bucket: 'documents', filePath, token: signed.data.token });
      } catch (error) {
        console.error('[legal-documents] unable to prepare upload', error);
        return res.status(503).json({ success: false, error: 'Unable to prepare a private legal document upload.' });
      }
    }
    if (!user.isAdmin && !(target === 'certificate' && user.isFocal && user.assignedBarangay)) return res.status(403).json({ success: false, error: 'Upload permission denied.' });
    if (!supabaseAdminClient) return res.status(503).json({ success: false, error: 'Supabase Storage is unavailable.' });
    if (!['certificate', 'landing', 'media'].includes(target) || typeof fileName !== 'string' || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) return res.status(400).json({ success: false, error: 'Choose a supported image and upload target.' });
    const bucket = target === 'certificate' ? 'certificates' : (process.env.SUPABASE_LANDING_MEDIA_BUCKET || 'landing-page-media');
    const prefix = target === 'certificate'
      ? user.isAdmin ? 'shared/certificate-assets/' : `barangays/${user.assignedBarangay.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '_')}/certificate-assets/`
      : `direct/${user.userId}/`;
    const filePath = `${prefix}${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)}`;
    try {
      const signed = await supabaseAdminClient.storage.from(bucket).createSignedUploadUrl(filePath);
      if (signed.error) throw signed.error;
      return res.json({ success: true, bucket, filePath, token: signed.data.token });
    } catch { return res.status(503).json({ success: false, error: 'Unable to prepare a Storage upload.' }); }
  });

  app.post('/api/certificate-template-sources/complete', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) return res.status(403).json({ success: false, error: 'Only administrators can import certificate templates.' });
    if (!supabaseAdminClient) return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
    const { filePath, fileName, mimeType } = req.body || {};
    if (typeof filePath !== 'string' || typeof fileName !== 'string' || typeof mimeType !== 'string') {
      return res.status(400).json({ success: false, error: 'Uploaded certificate source metadata is incomplete.' });
    }
    try {
      const result = await verifyDirectCertificateTemplateSource(supabaseAdminClient, filePath, fileName, mimeType);
      return res.status(201).json({ success: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify the uploaded certificate source.';
      return res.status(/invalid|choose|empty|large|match/i.test(message) ? 400 : 503)
        .json({ success: false, error: message });
    }
  });

  async function completedDirectImage(req: express.Request, certificate = false) {
    if (!supabaseAdminClient) throw new Error('Supabase Storage is unavailable.');
    const user = getUserSecurityContext(req);
    const { filePath, fileName, mimeType } = req.body;
    if (typeof filePath !== 'string' || typeof fileName !== 'string' || typeof mimeType !== 'string') throw new Error('Invalid uploaded image metadata.');
    const prefix = certificate
      ? user.isAdmin ? 'shared/certificate-assets/' : `barangays/${user.assignedBarangay.trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '_')}/certificate-assets/`
      : `direct/${user.userId}/`;
    return verifyDirectImage(supabaseAdminClient, certificate ? 'certificates' : (process.env.SUPABASE_LANDING_MEDIA_BUCKET || 'landing-page-media'), filePath, fileName, mimeType, prefix);
  }

      app.post('/api/certificate-assets/upload', async (req, res) => {
        const user = getUserSecurityContext(req);
        if (!user.isAdmin && !user.isFocal) {
          return res.status(403).json({ success: false, error: 'Only Admin, Super Admin, or Focal Person accounts can upload certificate images.' });
        }
        if (!supabaseAdminClient) {
          return res.status(503).json({ success: false, error: getSupabaseAdminConfigError() });
        }
        const { fileName, base64, mimeType } = req.body || {};
        if (typeof fileName !== 'string' || (typeof base64 !== 'string' && typeof req.body.filePath !== 'string') || typeof mimeType !== 'string') {
          return res.status(400).json({ success: false, error: 'An image file, filename, and MIME type are required.' });
        }
        try {
          const asset = req.body.filePath ? await completedDirectImage(req, true) : await uploadCertificateAsset(
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

  // Next authoritative Pig ID Generator
  // Next authoritative Pig ID Generator using atomic database sequence
  app.get('/api/swine-records/next-id', async (_req, res) => {
    try {
      const nextPigId = await getNextAuthoritativePigIdTag();
      return res.json({ success: true, nextPigId });
    } catch (err: any) {
      console.error('Error generating next pig ID:', err);
      return res.status(503).json({ success: false, error: 'Unable to allocate an authoritative Pig ID. Please retry when the database is available.' });
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
    const {readyToSell,isArchived} = resolveSwineReadFilters(user.isAgent,req.query.readyToSell,req.query.isArchived);
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

      if (user.isAgent && !agentMayReadSwine(swine)) return res.status(403).json({ success:false,error:'Agent accounts may only view active ready-to-sell records.' });

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
    try { validateSwineMutation(record); }
    catch (error) { return res.status(400).json({success:false,error:(error as Error).message}); }
    if (!record || typeof record !== 'object') {
      return res.status(400).json({ success: false, error: 'Invalid record payload' });
    }
    if (record.isArchived === true) {
      return res.status(400).json({ success: false, error: 'New records must be active. Use the authorized archive action after registration.' });
    }
    record.isArchived = false;

    const { farmerContact, pigIdTag, earTagNo, birthDate } = record;
    if (!record.farmerName?.trim() || (!user.isFocal && !record.barangay?.trim())) {
      return res.status(400).json({success:false,error:'Farmer name and barangay are required.'});
    }
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
      // Auto-generate authoritative ID atomically from database sequence
      try { tag = await getNextAuthoritativePigIdTag(); }
      catch { return res.status(503).json({success:false,error:'Swine tag allocation is unavailable. Please retry after the database connection is restored.'}); }
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
      id: randomUUID(),
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

      const userMessage = code === '23502'
        ? 'A required database field is missing. Please select a valid barangay and complete the required fields.'
        : code === '23503'
          ? 'The selected barangay or related record is no longer valid. Please reselect it and try again.'
          : code === '23505'
            ? 'A record with this unique identifier already exists. Check the Pig ID Tag and try again.'
            : code === '23514'
              ? 'One or more values do not meet the database validation rules. Review the form and try again.'
              : /^(08|53|57)/.test(String(code || '')) || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(String(code || ''))
                ? 'Unable to connect to the database. Your form data is preserved; please retry when the connection is restored.'
                : /barangay .* is not registered/i.test(message)
                  ? 'Please select a valid barangay before saving the swine record.'
                  : message;
      const status = code === '23505' ? 409
        : ['23502', '23503', '23514'].includes(String(code)) || userMessage.startsWith('Please select') ? 400
          : userMessage.startsWith('Unable to connect') ? 503 : 500;
      return res.status(status).json({
        success: false,
        error: code ? `Database save failed (${code}): ${userMessage}` : userMessage,
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
    try { validateSwineMutation(record); }
    catch (error) { return res.status(400).json({success:false,error:(error as Error).message}); }
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      return res.status(400).json({ success: false, error: 'Invalid record payload.' });
    }

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
      if (Object.hasOwn(record, 'isArchived') && record.isArchived !== existing.isArchived) {
        return res.status(400).json({ success: false, error: 'Use the authorized archive or restore action to change archive status.' });
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

      try { assertImmutableSwineIdentity(existing, record); }
      catch (error) { return res.status(400).json({success:false,error:(error as Error).message}); }
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
    const user = getUserSecurityContext(req);
    if (!user.isAdmin && !user.isFocal) return res.status(403).json({ success: false, error: 'Your role cannot update swine records.' });
    const { id } = req.params;
    const { readyToSell, priceEstimate } = req.body || {};

    try {
      const existing = await getSwineRecordById(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Swine record not found.' });
      }

      if (user.isFocal && (!user.assignedBarangay || existing.barangay.toLowerCase() !== user.assignedBarangay.toLowerCase())) return res.status(403).json({ success: false, error: 'Record is outside your assigned barangay.' });
      if (typeof readyToSell !== 'boolean') return res.status(400).json({ success: false, error: 'readyToSell must be a boolean.' });

      const updated = {
        ...existing,
        readyToSell: Boolean(readyToSell),
        status: readyToSell ? 'ready_to_sell' : (existing.status === 'ready_to_sell' ? 'healthy' : existing.status),
        estimatedPricePhp: priceEstimate !== undefined ? String(priceEstimate) : existing.estimatedPricePhp,
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

  const handleSetSwineArchiveStatus = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    const { id } = req.params;
    const { isArchived } = req.body || {};
    if (user.isAgent || !user.isAuthenticated) {
      return res.status(403).json({ success: false, error: 'Your role cannot archive or restore swine records.' });
    }
    if (user.isFocal && !user.assignedBarangay) {
      return res.status(403).json({ success: false, error: 'Your account has no assigned barangay.' });
    }
    if (typeof isArchived !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isArchived must be a boolean.' });
    }

    try {
      const existing = await getSwineRecordById(id);
      if (!existing) return res.status(404).json({ success: false, error: 'Swine record not found.' });
      if (!canArchiveSwineRecord(user, existing, isArchived)) {
        return res.status(403).json({ success: false, error: 'You are not authorized to archive or restore this record.' });
      }

      const saved = await setSwineArchiveStatus(existing.id, isArchived);
      if (!saved) return res.status(404).json({ success: false, error: 'Swine record no longer exists.' });
      return res.json({ success: true, data: saved, record: saved });
    } catch (err: any) {
      console.error('Error changing swine archive status:', err);
      return res.status(500).json({ success: false, error: 'Unable to save the swine archive status.' });
    }
  };

  app.patch('/api/swine-records/:id/archive', handleSetSwineArchiveStatus);
  app.patch('/api/swine/:id/archive', handleSetSwineArchiveStatus);

  // Permanent deletion is only available for archived records with an explicit grant.
  const handleDeleteSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (!canPermanentlyDeleteSwineRecord(user)) {
      return res.status(403).json({ success: false, error: 'Permanent deletion requires an explicit administrator permission.' });
    }
    const { id } = req.params;
    try {
      await permanentlyDeleteArchivedSwineRecord(id, user.userId);
      return res.json({ success: true, message: 'Swine record deleted successfully.' });
    } catch (err: any) {
      if (err instanceof SwinePermanentDeleteError) {
        return res.status(err.status).json({ success: false, error: err.message });
      }
      if (err?.code === '23503') {
        return res.status(409).json({
          success: false,
          error: 'The database rejected deletion because a retained relationship or audit actor reference would be invalid.',
        });
      }
      console.error('Error deleting swine record:', err);
      return res.status(500).json({
        success: false,
        error: 'Unable to safely delete the archived swine record or write its audit event.',
      });
    }
  };

  app.delete('/api/swine-records/:id', handleDeleteSwine);
  app.delete('/api/swine/:id', handleDeleteSwine);

  // Bulk hard deletion is intentionally disabled; records must be individually confirmed.
  const handleBulkDeleteSwine = async (_req: express.Request, res: express.Response) => {
    return res.status(410).json({
      success: false,
      error: 'Bulk permanent deletion is disabled. Archive records or permanently delete one archived record at a time.',
    });
  };

  app.post('/api/swine-records/bulk-delete', handleBulkDeleteSwine);
  app.post('/api/swine/bulk-delete', handleBulkDeleteSwine);

  // Batch Import Swine Records API
  const handleBatchImportSwine = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    if (user.isAgent) {
      return res.status(403).json({ success: false, error: 'Access Denied: Agent accounts cannot import records.' });
    }

    const { records, fileName, duplicateHandling = 'skip', newFields, sectionId, batchId } = req.body;
    if (!Array.isArray(records) || !records.length || records.length > IMPORT_LIMITS.batch) return res.status(400).json({success:false,error:`Send 1–${IMPORT_LIMITS.batch} records per batch.`});
    if (!['skip','update','rename','error'].includes(duplicateHandling)) return res.status(400).json({success:false,error:'Invalid duplicate policy.'});
    let fields;
    try { fields = validateImportFieldDefinitions(newFields); }
    catch (error) { return res.status(400).json({success:false,error:(error as Error).message}); }
    if (fields.length && !user.isAdmin) return res.status(403).json({success:false,error:'Only administrators can create custom registry fields. Ask an administrator to publish these fields first.'});
    if (user.isFocal && !user.assignedBarangay) return res.status(403).json({success:false,error:'Your account must be assigned to a barangay before importing records.'});
    if (user.isFocal && records.some((record:any) => typeof record?.barangay !== 'string' || record.barangay.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase())) return res.status(403).json({success:false,error:'Focal persons can only import records for their assigned barangay.'});
    if (typeof batchId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(batchId)) return res.status(400).json({success:false,error:'A stable import batch ID is required.'});
    try {
      const requestHash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
      const receiptKey = `swine_import:${createHash('sha256').update(`${user.userId}:${batchId}`).digest('hex')}`;
      const previous = await getStoredSystemSetting<any>(receiptKey);
      if (previous) {
        if (previous.requestHash !== requestHash) return res.status(409).json({success:false,error:'Batch ID was already used with different data.'});
        return res.json({success:true,count:previous.result.data.length,...previous.result,newFieldsCreated:previous.result.newFields,schema:await getFullRegistrySchemaFromDb()});
      }
      const schema = await getFullRegistrySchemaFromDb();
      const definitions = [...schema.sections.flatMap(section => section.fields), ...fields];
      const preparedRecords: any[] = [];
      const sourceIndexes: number[] = [];
      const failures: {index:number; reason:string; duplicate?:boolean}[] = [];
      const skipped: number[] = [];
      const seenTags = new Set<string>(), seenIds = new Set<string>(), seenRows = new Set<string>();
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        try {
          validateImportRecordShape(record);
          validateSwineMutation(record);
          for (const [key, value] of Object.entries(record.customFields || {})) {
            const definition = definitions.find(field => field.fieldKey === key || field.id === key);
            if (!definition) throw new Error(`Custom field ${key} has not been registered. Review mappings and confirm field creation.`);
            const converted = coerceImportValue(value, definition.type);
            record.customFields[key] = converted;
            if (definition.type === 'dropdown' && converted != null && converted !== '' && definition.options?.length && !definition.options.includes(String(converted))) throw new Error(`Invalid option for ${definition.label}.`);
          }
          const identityTags = [record.pigIdTag, record.earTagNo].filter(Boolean).map((tag:string) => tag.trim().toUpperCase());
          const fingerprint = stableImportFingerprint({...record, id: undefined, registeredAt:undefined, updatedAt:undefined, isSynced:undefined});
          if ((record.id && seenIds.has(record.id)) || identityTags.some((tag:string) => seenTags.has(tag)) || seenRows.has(fingerprint)) {
            failures.push({index, reason:'Duplicate record within this batch.', duplicate:true}); continue;
          }
          identityTags.forEach((tag:string) => seenTags.add(tag));
          if (record.id) seenIds.add(record.id);
          seenRows.add(fingerprint);
          const matches = (await Promise.all([record.id, ...identityTags].filter(Boolean).map(id => getSwineRecordById(id)))).filter(Boolean);
          if (new Set(matches.map(match => match!.id)).size > 1) throw new Error('Record ID and ear tag refer to different existing swine.');
          const existing = matches[0];
          const candidateCustomFields = {...existing?.customFields,...record.customFields};
          for (const definition of definitions.filter(field => field.isCustom && field.required && field.visible !== false)) {
            const value = candidateCustomFields[definition.fieldKey || definition.id] ?? candidateCustomFields[definition.id];
            if (value === undefined || value === null || value === '') throw new Error(`${definition.label} is required.`);
          }
          if (existing) {
            if (user.isFocal && existing.barangay.trim().toLowerCase() !== user.assignedBarangay.trim().toLowerCase()) throw new Error('Existing record is outside your assigned barangay.');
            if (duplicateHandling === 'skip') { skipped.push(index); continue; }
            if (duplicateHandling === 'error') { failures.push({index, reason:'Record already exists.', duplicate:true}); continue; }
            if (duplicateHandling === 'rename') {
              const tag = await getNextAuthoritativePigIdTag();
              preparedRecords.push({...record,id:randomUUID(),pigIdTag:tag,earTagNo:tag,computedPigId:tag});
            } else {
              assertImmutableSwineIdentity(existing, {...record, id: existing.id});
              preparedRecords.push({...existing,...record,id:existing.id,customFields:{...existing.customFields,...record.customFields}});
            }
          } else {
            const tag = record.pigIdTag || record.earTagNo || await getNextAuthoritativePigIdTag();
            if (!PIG_ID_TAG_REGEX.test(tag)) throw new Error('Invalid Pig ID Tag in import.');
            if (record.earTagNo && record.pigIdTag && record.earTagNo !== record.pigIdTag) throw new Error('Pig ID and ear tag must identify the same swine.');
            preparedRecords.push({...record,id:randomUUID(),pigIdTag:tag,earTagNo:tag});
          }
          sourceIndexes.push(index);
        } catch (error) { failures.push({index,reason:(error as Error).message}); }
      }
      const persisted = await persistSwineImportBatch(preparedRecords, fields, schema.sections.find(section => section.id === sectionId)?.id || schema.sections[0]?.id || 'sec_swine_info', receiptKey, requestHash, {sourceIndexes,failures,skipped},schema);
      try {
        const history = await getSystemSetting<any[]>('swine_import_audit_history') || [];
        const entry = {batchId,fileName:fileName || 'Import',importedBy:user.username,importedAt:new Date().toISOString(),recordCount:persisted.data.length,newFields:persisted.newFields,duplicatePolicy:duplicateHandling};
        await setSystemSetting('swine_import_audit_history',[entry,...(Array.isArray(history) ? history.filter(item => item.batchId !== batchId).slice(0,30) : [])]);
      } catch (error) { console.warn('Import audit history could not be updated:',error); }
      return res.json({success:true,count:persisted.data.length,data:persisted.data,failures:persisted.failures,skipped:persisted.skipped,newFieldsCreated:persisted.newFields,schema:await getFullRegistrySchemaFromDb()});
    } catch (error) {
      console.error('Swine import failed:', error);
      return res.status(500).json({success:false,error: (error as Error).message || 'Database import failed. No success has been confirmed; retry this batch.'});
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

  // Reference data is installed only through separately approved migrations.
  app.get('/api/barangays', async (_req, res) => {
    try {
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
    const effectiveBarangay = user.isAdmin || user.isAgent ? undefined : (user.assignedBarangay || user.barangayId);
    if(user.isFocal && !user.assignedBarangay)return res.status(403).json({success:false,error:'An assigned barangay is required.'});
    try {
      const { records, total } = await getAllSwineRecords({
        barangay: effectiveBarangay,readyToSell:user.isAgent?true:undefined,isArchived:false,
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
        farmersSet.add(farmerIdentity(r));
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
    if (user.isFocal && !user.assignedBarangay) return res.status(403).json({success:false,error:'An assigned barangay is required.'});
    const effectiveBarangay = user.isAdmin || user.isAgent ? undefined : user.assignedBarangay;

    try {
      const { records } = await getAllSwineRecords({
        barangay: effectiveBarangay, readyToSell: user.isAgent ? true : undefined, isArchived: false,
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
    if (!getUserSecurityContext(req).isSuperAdmin) return res.status(403).json({ success: false, error: 'Super administrator access required.' });
    try {
      await pool.query('SELECT 1');
      return res.json({ success: true, message: 'Configured database is connected.' });
    } catch { return res.status(503).json({ success: false, error: 'Configured database is unavailable.' }); }
  });
  app.post('/api/admin/database/save', (_req, res) => {
    return res.status(409).json({ success: false, error: 'Manage DATABASE_URL through server environment variables, then redeploy.' });
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

    if (!user.isAdmin && !user.isFocal) {
      return res.status(403).json({ success: false, error: 'Only administrators and assigned Focal Persons can issue certificates.' });
    }
    if (!cert || (!cert.controlNumber && !cert.certificateNo)) {
      return res.status(400).json({ success: false, error: 'Invalid certificate payload' });
    }

    if (!user.isAdmin && user.assignedBarangay) {
      cert.barangay = user.assignedBarangay;
      cert.farmerBarangay = user.assignedBarangay;
      cert.issuingBarangay = user.assignedBarangay;
    }

    try {
      const templateError = await validateCertificateTemplateIssuance(cert, user);
      if (templateError) return res.status(403).json({ success: false, error: templateError });
      const selectionError = await validateCertificateSwineSelection(cert, user, true);
      if (selectionError) return res.status(user.isFocal && /assigned barangay|your assigned/i.test(selectionError) ? 403 : 400)
        .json({ success: false, error: selectionError });
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

    if (!user.isAdmin && !user.isFocal) {
      return res.status(403).json({ success: false, error: 'Only administrators and assigned Focal Persons can update certificates.' });
    }
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

      const candidate = { ...existing, ...cert };
      if (candidate.templateId !== existing.templateId) {
        const templateError = await validateCertificateTemplateIssuance(candidate, user);
        if (templateError) return res.status(403).json({ success: false, error: templateError });
      }
      const selectionError = await validateCertificateSwineSelection(candidate, user, false);
      if (selectionError) return res.status(user.isFocal && /assigned barangay|your assigned/i.test(selectionError) ? 403 : 400)
        .json({ success: false, error: selectionError });

      const updated = await upsertCertificate({
        ...existing,
        ...candidate,
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

    if (!user.isAdmin && !user.isFocal) {
      return res.status(403).json({ success: false, error: 'Only administrators and assigned Focal Persons can archive certificates.' });
    }
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
      return res.status(503).json({ success: false, error: 'Messages database unavailable.' });
    }
  });

  app.post('/api/messages', async (req, res) => {
    const user = getUserSecurityContext(req);
    let payload = req.body;
    if (!payload || ![payload.message, payload.content, payload.body].some(value => typeof value === 'string' && value.trim())) {
      return res.status(400).json({ success: false, error: 'Message content is required.' });
    }
    try { payload = authorizeMessagePayload(payload, user); }
    catch (error) { return res.status(403).json({success:false,error:(error as Error).message}); }

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
    const user = getUserSecurityContext(req);
    if (!user.isAuthenticated || !user.userId) {
      return res.status(401).json({ success: false, error: 'Authentication required to mark messages as read.' });
    }
    try {
      const visible = await getAllMessages({ role: user.role, barangay: user.assignedBarangay, userId: user.userId });
      if (!visible.some(message => message.id === id)) return res.status(404).json({ success: false, error: 'Message not found in your scope.' });
      if (!await markMessageRead(id, user.userId)) throw new Error('Unable to update message');
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
      if (!target) return res.status(404).json({success:false,error:'Message not found.'});
      if (target && !user.isAdmin) {
        if (target.senderId !== user.userId) {
          return res.status(403).json({ success: false, error: 'Access Denied: You cannot delete messages sent by another user.' });
        }
      }
      if (!await deleteMessageById(id)) throw new Error('Message could not be deleted.');
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
    if ((typeof base64 !== 'string' && typeof req.body.filePath !== 'string') || typeof fileName !== 'string' || typeof mimeType !== 'string') {
      return res.status(400).json({ success: false, error: 'An image file, original filename, and MIME type are required.' });
    }

    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'media-image';
    let uploadedPath: string | null = null;

    try {
      const uploaded = req.body.filePath ? await completedDirectImage(req) : await uploadLandingCmsAsset(
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
    if (!['system_branding', 'api_configuration'].includes(key)) return res.status(403).json({ success: false, error: 'This setting is restricted.' });
    try {
      const value = await getSystemSetting(key);
      return res.json({ success: true, key, value });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Unable to retrieve settings from database.' });
    }
  });

  app.put('/api/settings', async (req, res) => {
    const admin = getUserSecurityContext(req);
    if (req.body?.key === 'api_configuration' && !admin.isSuperAdmin) {
      return res.status(403).json({success:false,error:'Super administrator access required for API configuration.'});
    }
    if (!admin.isAdmin) {
      return res.status(403).json({ success: false, error: 'Access Denied: Only administrators can update system settings.' });
    }
    const { key, value } = req.body || {};
    if (!['system_branding', 'api_configuration'].includes(key)) {
      return res.status(400).json({ success: false, error: 'A supported setting key is required.' });
    }
    try {
      const saved = await setSystemSetting(key, value);
      return res.json({ success: true, key, value: saved });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Failed to update system settings.' });
    }
  });

  app.get('/api/public/registry-summary', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { return res.json(await loadPublicRegistrySummary()); }
    catch { return res.status(503).json({ success: false, error: 'Public registry data temporarily unavailable.' }); }
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
    if ((!base64 && typeof req.body.filePath !== 'string') || typeof fileName !== 'string') {
      return res.status(400).json({ success: false, error: 'A file name and image payload are required.' });
    }
    try {
      const uploaded = req.body.filePath ? await completedDirectImage(req) : await uploadLandingCmsAsset(fileName, mimeType || 'application/octet-stream', base64, category || 'backgrounds');
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
  app.use('/api/config', (req, res, next) => {
    if (!getUserSecurityContext(req).isSuperAdmin) return res.status(403).json({ success: false, error: 'Super administrator access required.' });
    next();
  });

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
      return res.status(503).json({ success: false, error: 'Configuration history unavailable.' });
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
      return res.status(503).json({ success: false, error: 'Configuration audit unavailable.' });
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
  app.get('/api/legal-documents', async (_req, res) => {
    try {
      const result = await pool.query('SELECT document FROM legal_documents ORDER BY updated_at DESC, id');
      const user = getUserSecurityContext(_req);
      const allDocuments = result.rows.map(row => row.document as ASFRegulatoryDocument);
      const documents = user.isAdmin
        ? allDocuments
        : allDocuments.filter(document => document.status === 'verified' && !document.isArchived);
      return res.json({ success: true, count: documents.length, data: documents });
    } catch {
      return res.status(503).json({ success: false, error: 'Legal documents database unavailable.' });
    }
  });

  app.post('/api/legal-documents/:id/attachments', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) return res.status(403).json({ success: false, error: 'Only administrators can upload legal document attachments.' });
    if (!supabaseAdminClient) return res.status(503).json({ success: false, error: 'Supabase Storage is unavailable.' });
    const { id } = req.params;
    const { filePath, fileName, mimeType } = req.body || {};
    if (typeof filePath !== 'string' || typeof fileName !== 'string' || typeof mimeType !== 'string') {
      return res.status(400).json({ success: false, error: 'Uploaded file metadata is required.' });
    }

    let verifiedFile: Awaited<ReturnType<typeof verifyDirectLegalDocument>>;
    try {
      verifiedFile = await verifyDirectLegalDocument(supabaseAdminClient, filePath, fileName, mimeType, id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify uploaded legal document.';
      return res.status(/choose|contents|non-empty|larger|outside|invalid/i.test(message) ? 400 : 503)
        .json({ success: false, error: message });
    }

    try {
      const result = await pool.query<{ document: ASFRegulatoryDocument }>(
        'SELECT document FROM public.legal_documents WHERE id = $1',
        [id],
      );
      const existing = result.rows[0]?.document;
      if (!existing) {
        await supabaseAdminClient.storage.from('documents').remove([filePath]);
        return res.status(404).json({ success: false, error: 'Legal document not found.' });
      }
      const previousAttachments = Array.isArray(existing.sourceDocuments) ? existing.sourceDocuments : [];
      const version = previousAttachments.reduce((max, attachment) => Math.max(max, Number(attachment.version) || 0), 0) + 1;
      const attachment = {
        id: randomUUID(),
        name: fileName,
        originalFileName: fileName,
        storagePath: filePath,
        fileType: mimeType,
        fileSize: verifiedFile.fileSize,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user.username,
        version,
        checksum: '',
        isCurrent: true,
        url: '',
      };
      const updated: ASFRegulatoryDocument = {
        ...existing,
        status: existing.status === 'verified' || existing.status === 'active' ? 'for_verification' : existing.status || 'for_verification',
        sourceCompleteness: existing.status === 'verified' || existing.status === 'active'
          ? 'metadata_only'
          : existing.sourceCompleteness || 'metadata_only',
        sourceDocuments: [
          ...previousAttachments.map(item => ({ ...item, isCurrent: false })),
          attachment,
        ],
      };
      const saved = await mutateLegalDocument(pool, 'update', id, updated, user);
      if (!saved) throw new Error('Legal document changed before the attachment could be saved.');
      const savedDocument = await pool.query<{ document: ASFRegulatoryDocument }>(
        'SELECT document FROM public.legal_documents WHERE id = $1',
        [id],
      );
      if (!savedDocument.rows[0]?.document) throw new Error('Saved document attachment could not be reloaded.');
      return res.status(201).json({
        success: true,
        data: {
          document: savedDocument.rows[0].document,
          attachment: { ...attachment, url: verifiedFile.fileUrl },
        },
      });
    } catch (error) {
      const cleanup = await supabaseAdminClient.storage.from('documents').remove([filePath]);
      if (cleanup.error) console.error('[legal-documents] unable to clean up failed upload', cleanup.error.message);
      console.error('[legal-documents] attachment metadata save failed', error);
      return res.status(503).json({ success: false, error: 'Unable to save legal document attachment metadata.' });
    }
  });

  app.get('/api/legal-documents/:id/attachments/:attachmentId/url', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!supabaseAdminClient) return res.status(503).json({ success: false, error: 'Supabase Storage is unavailable.' });
    try {
      const result = await pool.query<{ document: ASFRegulatoryDocument }>(
        'SELECT document FROM public.legal_documents WHERE id = $1',
        [req.params.id],
      );
      const document = result.rows[0]?.document;
      if (!document) return res.status(404).json({ success: false, error: 'Legal document not found.' });
      if (!user.isAdmin && (document.status !== 'verified' || document.isArchived)) {
        return res.status(403).json({ success: false, error: 'Only verified legal documents are available to this account.' });
      }
      const attachment = (document.sourceDocuments || []).find(item => item.id === req.params.attachmentId);
      if (!attachment?.storagePath) return res.status(404).json({ success: false, error: 'Document attachment not found.' });
      const url = await createLegalDocumentSignedUrl(supabaseAdminClient, attachment.storagePath, document.id);
      return res.json({ success: true, data: { url } });
    } catch (error) {
      console.error('[legal-documents] unable to sign attachment', error);
      return res.status(503).json({ success: false, error: 'Unable to open legal document attachment.' });
    }
  });

  app.get('/api/legal-documents/audit-logs', async (req, res) => {
    if (!getUserSecurityContext(req).isAdmin) return res.status(403).json({ success: false, error: 'Administrator access required.' });
    try {
      const result = await pool.query(`SELECT id, document_id AS "documentId", document_title AS "documentTitle",
        action, actor_name AS "user", actor_role AS role, created_at AS timestamp, details
        FROM legal_document_audit_logs ORDER BY created_at DESC LIMIT 1000`);
      return res.json({ success: true, data: result.rows });
    } catch {
      return res.status(503).json({ success: false, error: 'Legal audit database unavailable.' });
    }
  });

  const writeLegalDocument = (operation: 'create' | 'update' | 'delete'): express.RequestHandler => async (req, res) => {
    const user = getUserSecurityContext(req);
    if (!user.isAdmin) { res.status(403).json({ success: false, error: 'Administrator access required.' }); return; }
    if (operation !== 'delete' && (!isLegalDocument(req.body) || (operation === 'update' && req.body.id !== req.params.id))) {
      res.status(400).json({ success: false, error: 'A valid document with matching ID, title, official number, type and articles is required.' }); return;
    }
    if (operation !== 'delete' && req.body.status === 'verified') {
      if (!hasVerifiableSourceAttachment(req.body)) {
        res.status(400).json({ success: false, error: 'A verified legal document requires a current uploaded source and an explicit complete or excerpt classification.' });
        return;
      }
      if (!supabaseAdminClient) {
        res.status(503).json({ success: false, error: 'Supabase Storage is unavailable; the legal source could not be verified.' });
        return;
      }
      const attachment = req.body.sourceDocuments.find((item: { isCurrent?: boolean }) => item.isCurrent === true);
      try {
        await createLegalDocumentSignedUrl(supabaseAdminClient, attachment.storagePath, req.body.id);
      } catch (error) {
        console.error('[legal-documents] verification source unavailable', error);
        res.status(503).json({ success: false, error: 'The current legal source file is unavailable in private Supabase Storage.' });
        return;
      }
    }
    const id = operation === 'create' ? req.body.id : req.params.id;
    try {
      const found = await mutateLegalDocument(pool, operation, id, operation === 'delete' ? undefined : req.body, user);
      if (!found) { res.status(404).json({ success: false, error: 'Legal document not found.' }); return; }
      if (operation === 'delete') {
        res.status(200).json({ success: true, data: null });
        return;
      }
      const saved = await pool.query<{ document: ASFRegulatoryDocument }>(
        'SELECT document FROM public.legal_documents WHERE id = $1',
        [id],
      );
      if (!saved.rows[0]?.document) throw new Error('Saved legal document could not be reloaded.');
      res.status(operation === 'create' ? 201 : 200).json({ success: true, data: saved.rows[0].document });
    } catch (error) {
      const conflict = getDatabaseErrorCode(error) === '23505';
      res.status(conflict ? 409 : 503).json({ success: false, error: conflict ? 'A document with this ID already exists.' : 'Unable to save legal document.' });
    }
  };
  app.post('/api/legal-documents', writeLegalDocument('create'));
  app.put('/api/legal-documents/:id', writeLegalDocument('update'));
  app.delete('/api/legal-documents/:id', writeLegalDocument('delete'));

  // =========================================================================
  // 11. ENTERPRISE OFFLINE SYNCHRONIZATION API (IDEMPOTENT BATCH SYNC)
  // =========================================================================

  // GET /api/sync/status
  app.get('/api/sync/status', async (req, res) => {
    const user = getUserSecurityContext(req);
    if (user.isFocal && !user.assignedBarangay) return res.status(403).json({success:false,error:'An assigned barangay is required.'});
    try {
      const { total } = await getAllSwineRecords({barangay:user.isFocal?user.assignedBarangay:undefined,readyToSell:user.isAgent?true:undefined,isArchived:false});
      return res.json({
        success: true,
        status: 'ONLINE',
        serverTime: new Date().toISOString(),
        role: user.role,
        scope: user.isAdmin ? 'ALL' : (user.assignedBarangay || user.barangayId),
        totalSwineInDb: total,
      });
    } catch {
      return res.status(503).json({success:false,status:'UNAVAILABLE',error:'Unable to read synchronization status from the database.'});
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
        isArchived: user.isAgent ? false : undefined,
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

    const resolvedSwineIds = new Map<string, string>();
    for (const op of operations) {
      const { clientOperationId, operation, entity, payload } = op && typeof op==='object' ? op : {};
      const originalEntityId = op?.entityId;
      const entityId = entity === 'swine' ? resolvedSwineIds.get(originalEntityId) || originalEntityId : originalEntityId;

      try {
        if (typeof clientOperationId !== 'string' || !clientOperationId || typeof entityId !== 'string') throw new Error('Stable operation and entity IDs are required.');
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
            if (payload.isArchived === true) {
              results.push({ clientOperationId, entityId, success: false, error: 'Offline creates cannot create archived records.' });
              continue;
            }
            if (user.isFocal && payload.barangay && payload.barangay.trim().toLowerCase() !== user.assignedBarangay.toLowerCase()) {
              results.push({ clientOperationId, entityId, success: false, error: 'Record is outside your assigned barangay.' });
              continue;
            }
            const authoritativeId = uuidForSyncOperation(`${user.userId}:${clientOperationId}`);
            const replay = await getSwineRecordById(authoritativeId);
            if (replay) {
              resolvedSwineIds.set(originalEntityId, replay.id);
              results.push({ clientOperationId, entityId, serverEntityId: replay.id, serverPigId: replay.pigIdTag, success: true });
              continue;
            }
            if (await wasSwinePermanentlyDeleted(authoritativeId)) {
              resolvedSwineIds.set(originalEntityId, authoritativeId);
              results.push({ clientOperationId, entityId, serverEntityId: authoritativeId, success: true });
              continue;
            }
            let tag = (payload.pigIdTag || payload.earTagNo || '').trim();
            // If temporary local tag, generate authoritative backend Pig ID
            // If temporary local tag, generate authoritative backend Pig ID from sequence
            if (!tag || tag.startsWith('LOCAL-') || !PIG_ID_TAG_REGEX.test(tag)) {
              tag = await getNextAuthoritativePigIdTag();
            }

            if (user.isFocal) {
              payload.barangay = user.assignedBarangay;
              if (user.barangayId) payload.barangay_id = user.barangayId;
            }

            const cleanRecord = {
              ...payload,
              id: authoritativeId,
              pigIdTag: tag,
              earTagNo: tag,
              registeredBy: payload.registeredBy || user.username,
            };

            const saved = await upsertSwineRecord(cleanRecord);
            resolvedSwineIds.set(originalEntityId, saved.id);
            results.push({
              clientOperationId,
              entityId,
              serverEntityId: saved.id,
              serverPigId: saved.pigIdTag,
              success: true,
            });
          } else if (operation === 'update') {
            const existing = await getSwineRecordById(entityId);
            if (!existing) {
              results.push({ clientOperationId, entityId, success: true });
              continue;
            }
            if ((user.isFocal && existing.barangay.toLowerCase() !== user.assignedBarangay.toLowerCase()) ||
                (user.isFocal && payload?.barangay && payload.barangay.toLowerCase() !== user.assignedBarangay.toLowerCase())) {
              results.push({ clientOperationId, entityId, success: false, error: 'Record is outside your assigned barangay or no longer exists.' });
              continue;
            }
            if (payload && typeof payload === 'object' &&
                Object.hasOwn(payload, 'isArchived') && payload.isArchived !== existing.isArchived) {
              results.push({
                clientOperationId,
                entityId,
                success: false,
                error: 'Use an authorized archive or restore operation to change archive status.',
              });
              continue;
            }
            const patch = entityId !== originalEntityId
              ? {...payload,id:existing.id,pigIdTag:existing.pigIdTag,earTagNo:existing.earTagNo}
              : payload || {};
            assertImmutableSwineIdentity(existing,patch);
            const updated = await upsertSwineRecord({
              ...existing,
              ...patch,
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
            const existing = await getSwineRecordById(entityId);
            if (!existing) {
              results.push({ clientOperationId, entityId, success: true });
              continue;
            }
            if (!canArchiveSwineRecord(user, existing, true)) {
              results.push({
                clientOperationId,
                entityId,
                success: false,
                error: 'The queued removal was not synchronized because this account cannot archive the record.',
              });
              continue;
            }
            const archived = existing.isArchived ? existing : await setSwineArchiveStatus(existing.id, true);
            if (!archived) {
              results.push({ clientOperationId, entityId, success: false, error: 'Record no longer exists.' });
              continue;
            }
            results.push({ clientOperationId, entityId, serverEntityId: archived.id, success: true });
          } else if (operation === 'archive') {
            const existing = await getSwineRecordById(entityId);
            if (!existing) {
              results.push({ clientOperationId, entityId, success: true });
              continue;
            }
            if (typeof payload?.isArchived !== 'boolean') {
              results.push({ clientOperationId, entityId, success: false, error: 'Archive state is invalid.' });
              continue;
            }
            if (!canArchiveSwineRecord(user, existing, payload.isArchived)) {
              results.push({ clientOperationId, entityId, success: false, error: 'You are not authorized to archive or restore this record.' });
              continue;
            }
            const updated = await setSwineArchiveStatus(existing.id, payload.isArchived);
            if (!updated) {
              results.push({ clientOperationId, entityId, success: false, error: 'Record no longer exists.' });
              continue;
            }
            results.push({ clientOperationId, entityId, serverEntityId: updated.id, success: true });
          } else if (operation === 'sell') {
            const existing = await getSwineRecordById(entityId);
            if (existing && (!user.isFocal || existing.barangay.toLowerCase() === user.assignedBarangay.toLowerCase())) {
              assertImmutableSwineIdentity(existing,payload||{});
              const updated = {
                ...existing,
                readyToSell: payload?.readyToSell,
                estimatedPricePhp: payload?.priceEstimate,
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
                success: false,
                error: 'Record is unavailable or outside your assigned barangay.',
              });
            }
          } else throw new Error('Unsupported swine synchronization operation.');
        } else if (entity === 'media') {
          if (!user.isAdmin) throw new Error('Administrator access required for media.');
          const resolvedUrl = payload.fileUrl || payload.base64 || payload.dataUrlOrBase64;
          if (resolvedUrl) {
            const savedMedia = await insertMedia({
              id: uuidForSyncOperation(`${user.userId}:${clientOperationId}`),
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
          if (!user.isAdmin && (!user.isFocal || !user.assignedBarangay)) throw new Error('Certificate writes require an administrator or assigned focal person.');
          if (!user.isAdmin && user.assignedBarangay) {
            payload.barangay = user.assignedBarangay;
            payload.farmerBarangay = user.assignedBarangay;
          }
          const selectionError = await validateCertificateSwineSelection(payload, user, true);
          if (selectionError) throw new Error(selectionError);
          const savedCert = await upsertCertificate({
            ...payload,
            metadata: {
              ...(payload.metadata || {}),
              ...payload,
              createdBy: user.userId,
              createdByRole: user.role,
            },
            id: uuidForSyncOperation(`${user.userId}:${clientOperationId}`),
          });
          results.push({ clientOperationId, entityId, serverEntityId: savedCert.id, success: true });
        } else if (entity === 'message') {
          const authorizedPayload = authorizeMessagePayload(payload || {}, user);
          const newMsg = await createMessage({
            ...authorizedPayload,
            id: uuidForSyncOperation(`${user.userId}:${clientOperationId}`),
            senderId: user.userId,
            senderName: user.username,
            senderRole: user.role as any,
            barangay: user.assignedBarangay,
          });
          results.push({ clientOperationId, entityId, serverEntityId: newMsg.id, success: true });
        } else {
          results.push({ clientOperationId, entityId, success: false, error: 'Unsupported sync entity.' });
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
  const chatRequests = new Map<string, { count: number; reset: number }>();
  const limitChat: express.RequestHandler = (req, res, next) => {
    const now = Date.now();
    for (const [key, entry] of chatRequests) if (entry.reset <= now) chatRequests.delete(key);
    const key = getUserSecurityContext(req).userId || req.ip || 'public';
    const entry = chatRequests.get(key) || { count: 0, reset: now + 60_000 };
    if (++entry.count > 20) { res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000)); res.status(429).json({ success: false, error: 'Too many requests. Please try again in a minute.' }); return; }
    chatRequests.set(key, entry);
    const message: unknown = req.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > 8000) { res.status(400).json({ success: false, error: 'Enter a message of 1–8000 characters.' }); return; }
    next();
  };
  app.post(['/api/public/assistant/chat', '/api/assistant/chat'], limitChat);

  const handleAssistant = async (req: express.Request, res: express.Response) => {
    const user = getUserSecurityContext(req);
    const publicMode = req.path === '/api/public/assistant/chat';
    if (!publicMode && !user.isAuthenticated) return res.status(401).json({success:false,error:'Authentication required.'});
    try {
      // Preserve the existing explicit Super Admin configuration preview flow.
      if (!publicMode && user.isSuperAdmin) {
        const command = interpretSuperAdminConfigCommand(req.body.message, DEFAULT_MASTER_CONFIG);
        if (command.isConfigCommand) {
          if (command.isSecurityViolation) return res.json({success:true,reply:command.securityMessage || 'Security modification restricted.'});
          const currentConfig = await getSystemSetting('master_system_config', DEFAULT_MASTER_CONFIG) || DEFAULT_MASTER_CONFIG;
          const proposal = interpretSuperAdminConfigCommand(req.body.message,currentConfig);
          if (proposal.proposedChange) return res.json({success:true,reply:proposal.previewMessage,action:{type:'confirm_config_change',actionId:'apply_proposed_config',label:'Apply Configuration Change',payload:proposal.proposedChange}});
        }
      }
      const result = await answerAssistant(req.body,publicMode ? {role:'guest'} : user, {generate:options.assistantGenerate});
      return res.json(result);
    } catch (error) {
      const code=assistantErrorCode(error);
      console.warn('[ASSISTANT] request unavailable',{code});
      return res.status(503).json({success:false,error:assistantErrorMessage(code,req.body?.language,!publicMode&&user.isAdmin),code});
    }
  };
  app.post('/api/public/assistant/chat',handleAssistant);
  app.post('/api/assistant/chat',handleAssistant);

  app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'API route not found.' });
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500;
    res.status(status >= 400 && status <= 599 ? status : 500).json({
      success: false,
      error: status === 413 ? 'Request too large. Upload files directly to Supabase Storage.' : status === 400 ? 'Invalid request body.' : 'The request could not be completed.',
    });
  });
  return app;
}

export const app = createApp();
