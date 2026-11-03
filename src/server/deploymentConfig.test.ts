import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Vercel can discover its configured function before the application build', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const entry of Object.keys(config.functions)) {
    // Reading the source must succeed without running npm run build first.
    const source = readFileSync(new URL(`../../${entry}`, import.meta.url), 'utf8');
    assert.match(source, /export \{ default \} from '\.\.\/src\/server\/vercelEntry\.ts'/);
    assert.equal(manifest.scripts.build.includes(`--outfile=${entry}`), false);
    const route = `/${entry.replace(/\.(?:js|ts)$/, '')}`;
    assert.equal(config.rewrites.find((rewrite: { source: string }) => rewrite.source === '/api/(.*)').destination, route);
  }
  assert.equal(manifest.scripts.build.includes('--outfile=api/index.js'), false);
});


test('Vercel installs build tools even with production dependency defaults', () => {
  const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const command = config.installCommand.trim().split(/\s+/);
  assert.deepEqual(command.slice(0, 2), ['npm', 'ci']);
  assert.ok(command.includes('--include=dev'), 'production installs must explicitly include build-time dependencies');
});
