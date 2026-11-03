import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { once } from 'node:events';
import type { PoolClient } from 'pg';
import type { AddressInfo } from 'node:net';

// Intentionally absent DATABASE_URL must not crash the Vercel module import.
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL = 'https://testproject.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
const { default: app } = await import('./vercelEntry.ts');
const { pool } = await import('../db/index.ts');
const { supabaseAdminClient } = await import('../lib/supabaseServer.ts');
assert.ok(supabaseAdminClient);
supabaseAdminClient.auth.admin.listUsers = async () => ({ data: { users: [], aud: 'authenticated' }, error: null }) as any;
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); });

test('missing database configuration returns sanitized 503 JSON after cold start', async () => {
  const response = await fetch(base + '/api/health');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.status, 'unhealthy');
  assert.equal(body.database_error_kind, 'configuration_error');
  assert.doesNotMatch(JSON.stringify(body), /postgresql:\/\/|sb_secret|stack|password/i);
});

test('database authentication failure is unavailable rather than an HTTP 500 crash', async () => {
  pool.connect = async () => { throw Object.assign(new Error('private connection details'), { code: '28P01' }); };
  const response = await fetch(base + '/api/health');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.database_error_kind, 'authentication_failed');
  assert.doesNotMatch(JSON.stringify(body), /private connection details/);
});

test('TLS failures preserve safe exact codes and omit connection details', async () => {
  pool.connect = async () => { throw new Error('private SQL', { cause: Object.assign(new Error('postgresql://user:private-password@host/db'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) }); };
  const response = await fetch(base + '/api/health');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.database_error_kind, 'tls_error');
  assert.equal(body.database_error_code, 'SELF_SIGNED_CERT_IN_CHAIN');
  assert.equal(body.database_tls_reason, 'untrusted_certificate_chain');
  assert.doesNotMatch(JSON.stringify(body), /private|postgresql:|SELECT/);
});

test('schema failure releases connection and cannot report healthy', async () => {
  let released = false;
  pool.connect = async () => ({ query: async () => { throw Object.assign(new Error('private schema'), { code: '42703' }); }, release: () => { released = true; } } as unknown as PoolClient);
  const response = await fetch(base + '/api/health');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).database, 'schema_error');
  assert.equal(released, true);
});

test('healthy requires read-only schema probes and working auth', async () => {
  const queries: string[] = [];
  pool.connect = async () => ({ query: async (sql: string) => { queries.push(sql); return { rows: [] }; }, release() {} } as unknown as PoolClient);
  const response = await fetch(base + '/api/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'healthy');
  assert.equal(body.database, 'connected');
  assert.equal(body.cloud, 'online');
  assert.ok(queries.length > 5);
  assert.ok(queries.every(sql => sql.startsWith('SELECT ') && sql.endsWith('LIMIT 0')));
});

test('auth outage and project mismatch cannot report cloud connected', async () => {
  supabaseAdminClient.auth.admin.listUsers = async () => { throw new Error('private auth failure'); };
  let response = await fetch(base + '/api/health');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).authentication, 'unavailable');
  process.env.VITE_SUPABASE_URL = 'https://different.supabase.co';
  response = await fetch(base + '/api/health');
  assert.equal((await response.json()).configuration_error, 'project_mismatch');
});
