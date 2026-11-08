import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

// No real credentials or external services: exercise actual Express middleware.
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
const { pool } = await import('../db/index.ts');
const originalConnect = pool.connect;
pool.connect = async () => { throw new Error('Test database intentionally unavailable'); };
const { app } = await import('./app.ts');
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test('sensitive APIs reject spoofed identities without a verified session', async () => {
  try {
    for (const [method, path] of [
      ['GET', '/api/users'], ['GET', '/api/messages'], ['GET', '/api/media'],
      ['GET', '/api/farmers'], ['GET', '/api/dashboard/stats'], ['GET', '/api/settings'],
      ['GET', '/api/config/master'], ['GET', '/api/admin/sidebar-theme'],
      ['GET', '/api/auth/superadmin-profile'],
      ['POST', '/api/assistant/chat'], ['POST', '/api/certificate-assets/upload'],
      ['POST', '/api/legal-documents'], ['PUT', '/api/legal-documents/id'],
      ['DELETE', '/api/legal-documents/id'], ['GET', '/api/legal-documents/audit-logs'],
    ]) {
      const response = await fetch(base + path, { method, headers: { 'x-user-role': 'super_admin', 'x-user-name': 'Attacker' } });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal((await response.json()).success, false);
    }
    const unknown = await fetch(base + '/api/does-not-exist');
    assert.match(unknown.headers.get('content-type') || '', /application\/json/);
    const malformed = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).success, false);
    // Upload route must be registered independently of module-data writes.
    const route = app._router.stack.find((layer: { route?: { path?: string } }) => layer.route?.path === '/api/certificate-assets/upload');
    assert.ok(route);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    pool.connect = originalConnect;
    await pool.end();
  }
});
