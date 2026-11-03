export interface BackendHealthResult {
  healthy: boolean;
  error: string | null;
}

const databaseErrors: Record<string, string> = {
  authentication_failed: 'The API is reachable, but database authentication failed. Verify DATABASE_URL in Vercel.',
  host_not_found: 'The API is reachable, but the database host could not be resolved. Verify DATABASE_URL in Vercel.',
  connection_refused: 'The API is reachable, but the database refused the connection. Check the Supabase project and pooler address.',
  connection_timeout: 'The API is reachable, but the database connection timed out. Check Supabase availability and the pooler connection.',
  network_unreachable: 'The API is reachable, but it cannot reach the database. Check Supabase availability and network access.',
  tls_error: 'The API is reachable, but the database TLS connection failed. Check the server connection configuration.',
  permission_denied: 'The API is reachable, but its database account lacks the required permissions.',
};

/** Share in-flight checks so concurrent callers wait for a current result. */
export function createBackendHealthCheck(options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
  let inFlight: Promise<BackendHealthResult> | undefined;
  const fetcher = options.fetcher || ((input, init) => fetch(input, init));
  async function check(): Promise<BackendHealthResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
    try {
      const response = await fetcher('/api/health', { method: 'GET', cache: 'no-store', signal: controller.signal });
      if (!response.ok) {
        const hint = response.status === 404 ? 'Verify the API entry and rewrites in the latest deployment.'
          : response.status === 401 || response.status === 403 ? 'The health endpoint should allow public access. Check API authentication routing.'
          : 'Check Vercel function logs and server environment configuration.';
        return { healthy: false, error: `Backend health check returned HTTP ${response.status}. ${hint}` };
      }
      const body: unknown = await response.json().catch(() => null);
      if (!body || typeof body !== 'object' || !('service' in body) || body.service !== 'hinunangan-swine-registry' || !('database' in body)) {
        return { healthy: false, error: 'The health endpoint did not return the expected API JSON. Check the deployment routing; it may be serving a page instead.' };
      }
      if (body.database === 'schema_error') return { healthy: false, error: 'The API is reachable, but the database schema check failed. Apply the pending Supabase migrations.' };
      if (body.database !== 'connected') {
        const kind = 'database_error_kind' in body && typeof body.database_error_kind === 'string' ? body.database_error_kind : '';
        return { healthy: false, error: databaseErrors[kind] || 'The API is reachable, but the database is unavailable. Check DATABASE_URL and the Supabase project status.' };
      }
      return { healthy: true, error: null };
    } catch {
      return { healthy: false, error: controller.signal.aborted
        ? 'The backend health check timed out. Check Vercel function logs and Supabase connectivity, then retry.'
        : 'The browser could not reach /api/health. Check your connection, the site address, and the Vercel deployment.' };
    } finally { clearTimeout(timeout); }
  }
  return (): Promise<BackendHealthResult> => inFlight ??= check().finally(() => { inFlight = undefined; });
}
