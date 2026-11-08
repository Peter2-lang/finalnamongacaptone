import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

for (const mode of ['production', 'development']) {
  const port = mode === 'production' ? 3187 : 3188;
  const child = spawn(process.execPath, mode === 'production' ? ['build/server.cjs'] : ['--import', 'tsx', 'server.ts'], {
    env: { ...process.env, NODE_ENV: mode, PORT: String(port), DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test' },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/not-a-route`);
        assert.match(response.headers.get('content-type') || '', /application\/json/);
        assert.equal((await response.json()).success, false);
        ready = true;
        break;
      } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    assert.ok(ready, `${mode} server did not start`);
    for (const path of ['/', '/records', '/gis', '/kamirani/audit-logs']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200, `${mode}: ${path}`);
      assert.match(response.headers.get('content-type') || '', /text\/html/);
    }
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.notEqual((await health.json()).database, 'connected');
    console.log(`${mode}: startup, SPA deep links, API JSON and database failure reporting verified`);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
  }
}
