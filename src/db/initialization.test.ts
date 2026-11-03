import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initPostgresTables, pool } from './index.ts';

test('legacy schema initialization cannot execute SQL in any environment', async () => {
  const oldMode = process.env.NODE_ENV;
  const oldVercel = process.env.VERCEL;
  const connect = pool.connect;
  let attempts = 0;
  pool.connect = async () => { attempts++; throw new Error('Production initialization must not connect'); };
  try {
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'development';
    await assert.rejects(initPostgresTables(), { code: 'SCHEMA_INITIALIZATION_DISABLED' });
    process.env.NODE_ENV = 'production';
    await assert.rejects(initPostgresTables(), { code: 'SCHEMA_INITIALIZATION_DISABLED' });
    process.env.NODE_ENV = 'development';
    process.env.VERCEL = '1';
    await assert.rejects(initPostgresTables(), { code: 'SCHEMA_INITIALIZATION_DISABLED' });
    assert.equal(attempts, 0);
  } finally {
    pool.connect = connect;
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
    if (oldVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
  }
});

test('application database modules contain no executable schema DDL', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['index.ts','legalDocuments.ts','swine.ts']) {
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|SEQUENCE)\b/i,`${file} must keep DDL in reviewed SQL`);
  }
});
