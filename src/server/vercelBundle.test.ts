import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('production launcher imports and serves real health JSON without TypeScript sources or loaders', { timeout: 60_000 }, () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const stage = mkdtempSync(join(tmpdir(), 'swine-vercel-regression-'));
  try {
    execFileSync(process.execPath, ['scripts/build-backend.mjs', join(stage, 'build')], { cwd: root, stdio: 'pipe' });
    const metadata = JSON.parse(readFileSync(join(stage, 'build/vercel.meta.json'), 'utf8'));
    for (const required of ['src/server/vercelEntry.ts', 'src/server/env.ts', 'src/server/app.ts', 'src/server/databaseHealth.ts', 'src/server/supabaseStorage.ts', 'src/db/index.ts', 'src/lib/supabaseServer.ts']) {
      assert.ok(metadata.inputs[required], `${required} must be compiled into the backend artifact`);
    }
    for (const output of Object.values(metadata.outputs) as Array<{ imports: Array<{ path: string; external: boolean }> }>) {
      assert.ok(output.imports.every(item => item.external && !item.path.startsWith('.') && !item.path.startsWith('/')), 'runtime imports must be installed packages or Node builtins');
    }
    mkdirSync(join(stage, 'api'));
    copyFileSync(join(root, 'api/index.js'), join(stage, 'api/index.js'));
    writeFileSync(join(stage, 'package.json'), '{"type":"module"}');
    // Only installed packages are shared. No src/, tsx, .env, or TS files are staged.
    symlinkSync(join(root, 'node_modules'), join(stage, 'node_modules'), 'dir');
    writeFileSync(join(stage, 'smoke.mjs'), `
      import assert from 'node:assert/strict';
      import { once } from 'node:events';
      import app from './api/index.js';
      assert.equal(typeof app, 'function');
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = 'http://127.0.0.1:' + server.address().port;
      try {
        let response = await fetch(base + '/api/health');
        assert.equal(response.status, 503);
        assert.match(response.headers.get('content-type'), /application\\/json/);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        let body = await response.json();
        assert.equal(body.service, 'hinunangan-swine-registry');
        assert.equal(body.database_error_kind, 'configuration_error');
        assert.equal(body.status, 'unhealthy');
        process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/test';
        response = await fetch(base + '/api/health');
        assert.equal(response.status, 503);
        body = await response.json();
        assert.equal(body.database_error_kind, 'connection_refused');
        assert.equal(body.database, 'error');
        assert.doesNotMatch(JSON.stringify(body), /postgresql:\\/\\/|stack|password/);
        response = await fetch(base + '/api/users');
        assert.equal(response.status, 401);
        console.log('Plain Node import and actual Express health route passed with missing and refused database configuration.');
      } finally { await new Promise(resolve => server.close(resolve)); }
    `);
    const output = execFileSync(process.execPath, [join(stage, 'smoke.mjs')], {
      cwd: stage, encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(output, /Plain Node import and actual Express health route passed/);
  } finally { rmSync(stage, { recursive: true, force: true }); }
});
