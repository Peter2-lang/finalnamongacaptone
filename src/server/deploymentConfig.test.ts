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
