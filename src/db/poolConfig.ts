import type { PoolConfig } from 'pg';
import { X509Certificate } from 'node:crypto';
import { checkServerIdentity } from 'node:tls';

export function getDatabaseUrl(env = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || env.SUPABASE_DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
}

/** Accept Vercel multiline PEM, escaped newlines, CRLF and optional outer quotes. */
export function parseDatabaseCa(value: string | undefined): string | undefined {
  let pem = value?.trim();
  if (!pem) return undefined;
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) pem = pem.slice(1, -1);
  pem = pem.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();
  const fail = (code: string): never => { throw Object.assign(new Error('DATABASE_SSL_CA must contain valid, current CA certificate PEM content.'), { code }); };
  if (pem.length > 128 * 1024) return fail('DATABASE_SSL_CA_INVALID');
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!certificates?.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) return fail('DATABASE_SSL_CA_INVALID');
  for (const certificate of certificates) {
    let parsed: X509Certificate;
    try { parsed = new X509Certificate(certificate); } catch { return fail('DATABASE_SSL_CA_INVALID'); }
    if (!parsed.ca) return fail('DATABASE_SSL_CA_NOT_CA');
    if (Date.parse(parsed.validTo) <= Date.now()) return fail('DATABASE_SSL_CA_EXPIRED');
    if (Date.parse(parsed.validFrom) > Date.now()) return fail('DATABASE_SSL_CA_NOT_YET_VALID');
  }
  return certificates.join('\n') + '\n';
}

/** Safe metadata for server logs: never return the URI, hostname, user or CA. */
export function getDatabaseConnectionInfo(env = process.env) {
  const source = ['DATABASE_URL', 'SUPABASE_DATABASE_URL', 'POSTGRES_URL'].find(key => env[key]?.trim()) || 'not_configured';
  let mode = 'not_configured';
  try {
    const url = new URL(getDatabaseUrl(env) || '');
    const port = url.port || '5432';
    mode = /\.pooler\.supabase\.com$/i.test(url.hostname)
      ? port === '6543' ? 'supabase_transaction_pooler' : port === '5432' ? 'supabase_session_pooler' : 'supabase_pooler_unknown_port'
      : /^db\.[^.]+\.supabase\.co$/i.test(url.hostname)
        ? port === '6543' ? 'supabase_dedicated_pooler' : 'supabase_direct'
        : 'postgres';
  } catch { if (source !== 'not_configured') mode = 'invalid_url'; }
  return { source, mode, customCaConfigured: Boolean(env.DATABASE_SSL_CA?.trim()), certificateVerification: true, hostnameVerification: true };
}

export function getDatabasePoolConfig(env = process.env): PoolConfig {
  const value = getDatabaseUrl(env);
  if (!value) throw Object.assign(new Error('DATABASE_URL is required.'), { code: 'CONFIGURATION_ERROR' });
  let url: URL;
  try {
    url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1)) throw new Error();
  } catch {
    throw Object.assign(new Error('DATABASE_URL must be a valid PostgreSQL URI.'), { code: 'CONFIGURATION_ERROR' });
  }
  const remote = !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  // pg connection-string SSL parameters override the SSL object, including its CA.
  // Configure TLS in one place and always verify the database server identity.
  for (const key of ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation', 'uselibpqcompat']) url.searchParams.delete(key);
  const ca = parseDatabaseCa(env.DATABASE_SSL_CA);
  return {
    connectionString: url.toString(),
    ssl: remote ? { rejectUnauthorized: true, checkServerIdentity, ...(ca ? { ca } : {}) } : undefined,
    sslnegotiation: 'postgres',
    max: env.VERCEL || env.NODE_ENV === 'production' ? 1 : 5,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 8000,
    query_timeout: 9000,
    allowExitOnIdle: true,
  };
}
