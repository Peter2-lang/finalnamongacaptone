import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initPostgresTables, pool } from './index.ts';

test('legacy schema initialization cannot execute SQL in production or Vercel', async () => {
  const oldMode = process.env.NODE_ENV;
  const oldVercel = process.env.VERCEL;
  const connect = pool.connect;
  let attempts = 0;
  pool.connect = async () => { attempts++; throw new Error('Production initialization must not connect'); };
  try {
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
