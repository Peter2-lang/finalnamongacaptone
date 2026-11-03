import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputDirectory = resolve(process.argv[2] || 'build');
await mkdir(outputDirectory, { recursive: true });

const options = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  packages: 'external',
  logLevel: 'info',
};

// The standalone server listens on a port; the Vercel entry only exports Express.
await build({ ...options, entryPoints: ['server.ts'], outfile: resolve(outputDirectory, 'server.cjs'), sourcemap: true });
const result = await build({
  ...options,
  entryPoints: ['src/server/vercelEntry.ts'],
  outfile: resolve(outputDirectory, 'vercel.cjs'),
  metafile: true,
});
await writeFile(resolve(outputDirectory, 'vercel.meta.json'), JSON.stringify(result.metafile, null, 2) + '\n');
