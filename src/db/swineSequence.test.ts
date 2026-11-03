import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pool } from './index.ts';
import { getNextAuthoritativePigIdTag } from './swine.ts';

test('tag allocation consumes the migrated sequence without DDL or guessed IDs', async () => {
  const original = pool.query;
  const queries: string[] = [];
  try {
    (pool as any).query = async (sql: string) => { queries.push(sql); return { rows:[{ seq:'9007199254740993' }] }; };
    assert.equal(await getNextAuthoritativePigIdTag(),`HIN-${new Date().getFullYear()}-9007199254740993`);
    (pool as any).query = async (sql: string) => { queries.push(sql); throw Object.assign(new Error('Missing sequence'),{code:'42P01'}); };
    await assert.rejects(getNextAuthoritativePigIdTag(),/allocation is unavailable/);
    assert.equal(queries.length,2);
    assert.ok(queries.every(sql => sql.startsWith('SELECT nextval(')));
  } finally { pool.query=original; }
});
