import assert from 'node:assert/strict';
import { test } from 'node:test';
import { X509Certificate } from 'node:crypto';
import { checkServerIdentity, rootCertificates } from 'node:tls';
import { Client } from 'pg';
import { getDatabaseConnectionInfo, getDatabasePoolConfig, parseDatabaseCa } from './poolConfig.ts';

const ca = rootCertificates.find(pem => { const cert = new X509Certificate(pem); return cert.ca && Date.parse(cert.validFrom) < Date.now() && Date.parse(cert.validTo) > Date.now(); })!;
assert.ok(ca);
const url = 'postgresql://postgres.test:example@aws-0-region.pooler.supabase.com:6543/postgres';

test('missing or invalid URL cannot silently connect to localhost', () => {
  for (const value of ['', 'not-a-url', 'https://example.com/database']) assert.throws(() => getDatabasePoolConfig({ DATABASE_URL: value }), /DATABASE_URL/);
});

test('real CA PEM parses consistently with Vercel newline formats', () => {
  const expected = parseDatabaseCa(ca);
  for (const formatted of [ca, ca.replaceAll('\n', '\\n'), ca.replaceAll('\n', '\r\n'), ca.replaceAll('\n', '\\r\\n'), `"${ca.replaceAll('\n', '\\n')}"`]) {
    assert.equal(parseDatabaseCa(formatted), expected);
  }
  assert.equal(parseDatabaseCa('  '), undefined);
  for (const invalid of ['not-a-certificate', '/tmp/root.crt', ca + '\nprivate content', '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----']) {
    assert.throws(() => parseDatabaseCa(invalid), { code: 'DATABASE_SSL_CA_INVALID' });
  }
});

test('pg cannot override CA or verification through any supported SSL URI switch', () => {
  for (const params of ['sslmode=require', 'ssl=no-verify', 'ssl=0', 'sslmode=disable', 'sslmode=verify-ca&uselibpqcompat=true', 'sslrootcert=/nonexistent/root.crt&sslcert=/nonexistent/client.crt&sslkey=/nonexistent/client.key', 'sslnegotiation=direct']) {
    const config = getDatabasePoolConfig({ DATABASE_URL: url + '?' + params, VERCEL: '1', DATABASE_SSL_CA: ca });
    const client = new Client(config);
    const ssl = (client as any).connectionParameters.ssl;
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.checkServerIdentity, checkServerIdentity);
    assert.equal(ssl.ca, parseDatabaseCa(ca));
    assert.equal(config.sslnegotiation, 'postgres');
    assert.equal(config.max, 1);
    assert.equal(config.statement_timeout, 8000);
  }
});

test('default Node trust is preserved when no custom CA is configured', () => {
  const config = getDatabasePoolConfig({ DATABASE_URL: url });
  assert.equal((config.ssl as any).rejectUnauthorized, true);
  assert.equal((config.ssl as any).ca, undefined);
});

test('DATABASE_URL takes precedence and connection metadata reveals no credentials', () => {
  const env = { DATABASE_URL: url, POSTGRES_URL: 'postgresql://other:secret@localhost/test', DATABASE_SSL_CA: ca };
  assert.equal(getDatabaseConnectionInfo(env).source, 'DATABASE_URL');
  assert.equal(getDatabaseConnectionInfo(env).mode, 'supabase_transaction_pooler');
  for (const [value, mode] of [
    ['postgresql://test:secret@db.project.supabase.co:5432/postgres', 'supabase_direct'],
    [url.replace(':6543/', ':5432/'), 'supabase_session_pooler'],
    ['postgresql://test:secret@db.project.supabase.co:6543/postgres', 'supabase_dedicated_pooler'],
  ]) assert.equal(getDatabaseConnectionInfo({ DATABASE_URL: value }).mode, mode);
  assert.doesNotMatch(JSON.stringify(getDatabaseConnectionInfo(env)), /secret|example|postgresql:|BEGIN CERTIFICATE|pooler\.supabase/);
  assert.ok(getDatabasePoolConfig({ POSTGRES_URL: 'postgresql://test:test@localhost/test' }).connectionString);
});
