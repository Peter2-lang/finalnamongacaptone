import type { PoolConfig } from 'pg';

export function getDatabaseUrl(env = process.env): string | undefined {
  return env.DATABASE_URL?.trim() || env.SUPABASE_DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
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
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
  return {
    connectionString: url.toString(),
    ssl: remote ? { rejectUnauthorized: true, ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, '\n') } : {}) } : undefined,
    max: env.VERCEL || env.NODE_ENV === 'production' ? 1 : 5,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 8000,
    query_timeout: 9000,
    allowExitOnIdle: true,
  };
}
