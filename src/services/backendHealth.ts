export interface BackendHealthResult {
  healthy: boolean;
  error: string | null;
  connectionFailure: boolean;
}

const databaseErrors: Record<string, string> = {
  configuration_error: 'The API is reachable, but DATABASE_URL is missing or invalid in the server environment.',
  authentication_failed: 'The API is reachable, but database authentication failed. Verify DATABASE_URL in Vercel.',
  host_not_found: 'The API is reachable, but the database host could not be resolved. Verify DATABASE_URL in Vercel.',
  connection_refused: 'The API is reachable, but the database refused the connection. Check the Supabase project and pooler address.',
  connection_timeout: 'The API is reachable, but the database connection timed out. Check Supabase availability and the pooler connection.',
  network_unreachable: 'The API is reachable, but it cannot reach the database. Check Supabase availability and network access.',
  tls_error: 'The API is reachable, but the database TLS connection failed. Check the server connection configuration.',
  permission_denied: 'The API is reachable, but its database account lacks the required permissions.',
};

/** Share in-flight checks so concurrent callers wait for a current result. */
export function createBackendHealthCheck(options: { fetcher?: typeof fetch; timeoutMs?: number; endpoint?: string } = {}) {
  let inFlight: Promise<BackendHealthResult> | undefined;
  const fetcher = options.fetcher || ((input, init) => fetch(input, init));
  async function check(): Promise<BackendHealthResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
    try {
      const response = await fetcher(options.endpoint || '/api/health', { method: 'GET', cache: 'no-store', signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      const validBody = body && typeof body === 'object' && 'service' in body && body.service === 'hinunangan-swine-registry' && 'database' in body;
      if (!response.ok && !(response.status === 503 && validBody)) {
        const hint = response.status === 404 ? 'Verify the API entry and rewrites in the latest deployment.'
          : response.status === 401 || response.status === 403 ? 'The health endpoint should allow public access. Check API authentication routing.'
          : 'Check Vercel function logs and server environment configuration.';
        const authFailure = body && typeof body === 'object' && 'error' in body &&
          typeof body.error === 'string' && /session|auth|profile/i.test(body.error);
        return {
          healthy: false,
          error: `Backend health check returned HTTP ${response.status}. ${hint}`,
          connectionFailure: response.status !== 401 && response.status !== 403 && !authFailure,
        };
      }
      if (!body || typeof body !== 'object' || !('service' in body) || body.service !== 'hinunangan-swine-registry' || !('database' in body)) {
        return { healthy: false, error: 'The health endpoint did not return the expected API JSON. Check the deployment routing; it may be serving a page instead.', connectionFailure: true };
      }
      if (body.database === 'schema_error' || ('schema' in body && (body.schema === 'not_ready' || body.schema === 'error')) || ('database_error_kind' in body && body.database_error_kind === 'schema_error')) return { healthy: false, error: 'The API is reachable, but the database schema check failed. Have an administrator review the schema and pending migrations before applying changes.', connectionFailure: false };
      if (body.database !== 'connected') {
        const kind = 'database_error_kind' in body && typeof body.database_error_kind === 'string' ? body.database_error_kind : '';
        const nonConnectionFailure = ['configuration_error', 'authentication_failed', 'permission_denied'].includes(kind);
        const connectionFailure = !nonConnectionFailure;
        return { healthy: false, error: databaseErrors[kind] || 'The API is reachable, but the database is unavailable. Check DATABASE_URL and the Supabase project status.', connectionFailure };
      }
      if ('connection_check' in body && body.connection_check === true) {
        return { healthy: response.ok, error: response.ok ? null : 'The authenticated database connectivity check failed.', connectionFailure: !response.ok };
      }
      if ('configuration_error' in body && body.configuration_error) return { healthy: false, error: body.configuration_error === 'project_mismatch'
        ? 'The API is reachable, but frontend, backend, and database Supabase projects do not match.'
        : 'The API is reachable, but Supabase authentication configuration is missing or invalid.', connectionFailure: false };
      if (!response.ok || ('schema' in body && body.schema !== 'ready') || !('status' in body) || body.status !== 'healthy' || !('cloud' in body) || body.cloud !== 'online' || !('authentication' in body) || body.authentication !== 'available') {
        return { healthy: false, error: 'The API is reachable, but required cloud authentication checks did not succeed. Check Supabase server configuration and availability.', connectionFailure: false };
      }
      return { healthy: true, error: null, connectionFailure: false };
    } catch {
      return { healthy: false, error: controller.signal.aborted
        ? 'The backend health check timed out. Check Vercel function logs and Supabase connectivity, then retry.'
        : 'The browser could not reach /api/health. Check your connection, the site address, and the Vercel deployment.', connectionFailure: true };
    } finally { clearTimeout(timeout); }
  }
  return (): Promise<BackendHealthResult> => inFlight ??= check().finally(() => { inFlight = undefined; });
}
