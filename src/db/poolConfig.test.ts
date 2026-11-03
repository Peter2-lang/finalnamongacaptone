import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDatabasePoolConfig } from './poolConfig.ts';

test('missing or invalid URL cannot silently connect to localhost', () => {
  for (const value of ['', 'not-a-url', 'https://example.com/database']) {
    assert.throws(() => getDatabasePoolConfig({ DATABASE_URL: value }), /DATABASE_URL/);
  }
});

test('pooler TLS verifies identity and URI parameters cannot replace the configured CA', () => {
  const config = getDatabasePoolConfig({ DATABASE_URL: 'postgresql://postgres.test:example@aws-0-region.pooler.supabase.com:6543/postgres?sslmode=require', VERCEL: '1', DATABASE_SSL_CA: 'certificate\\ncontents' });
  assert.equal(config.max, 1);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, ca: 'certificate\ncontents' });
  assert.doesNotMatch(config.connectionString!, /sslmode/);
  assert.equal(config.statement_timeout, 8000);
});

test('legacy server database aliases remain supported', () => {
  assert.ok(getDatabasePoolConfig({ POSTGRES_URL: 'postgresql://test:test@localhost/test' }).connectionString);
});
