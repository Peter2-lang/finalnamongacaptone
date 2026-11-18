import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { registerFarmerSwine } from './farmerSwineRegistration.ts';
import { pool } from './index.ts';
import { farmers } from './schema.ts';

test('existing farmer registration is atomic, scoped and idempotent', async () => {
  const farmerId = '00000000-0000-4000-8000-000000000010';
  const barangayId = '00000000-0000-4000-8000-000000000011';
  const batchId = '00000000-0000-4000-8000-000000000012';
  const user = { userId: '00000000-0000-4000-8000-000000000013', username: 'fixture',
    isAdmin: false, isSuperAdmin: false, isFocal: true, assignedBarangay: 'Ambacon' };
  const record = {
    id: '00000000-0000-4000-8000-000000000014',
    farmerId: user.userId,
    farmerName: 'Client-supplied name',
    earTagNo: 'Ear-14',
    swineType: 'grower',
    gender: 'female',
    breed: 'Native',
    birthDate: '2025-01-01',
    status: 'healthy',
    readyToSell: false,
  };
  const records = [record, { ...record, id: '00000000-0000-4000-8000-000000000015', earTagNo: 'Ear-15' }];
  const schema = { version: 1, sections: [], lastUpdated: '', updatedBy: '', isPublished: true };
  const farmer = { id: farmerId, barangayId, firstName: 'Existing', lastName: 'Farmer', metadata: {} };
  const calls: { sql: string; params: unknown[] }[] = [];
  const original = pool.connect;
  let receipt: unknown;
  let seq = 0;

  pool.connect = (async () => ({
    release() {},
    async query(query: string | { text: string }, params: unknown[] = []) {
      const sql = typeof query === 'string' ? query : query.text;
      calls.push({ sql, params });
      if (sql.includes('from "farmers"')) {
        return { rows: [[...Object.keys(getTableColumns(farmers)).map(key => farmer[key as keyof typeof farmer] ?? null), 'Ambacon']] };
      }
      if (sql.startsWith('SELECT nextval')) return { rows: [{ seq: ++seq }] };
      if (sql.includes('from "system_settings"')) return { rows: receipt ? [[receipt]] : [] };
      if (sql.startsWith('insert into "system_settings"')) receipt = JSON.parse(String(params[1]));
      return { rows: [] };
    },
  })) as typeof pool.connect;

  try {
    await assert.rejects(registerFarmerSwine(farmerId, batchId, records, { ...user, assignedBarangay: 'Other' }, schema), /assigned barangay/);
    await assert.rejects(registerFarmerSwine(farmerId, batchId, [record, { ...records[1], gender: '' }], user, schema), /Swine 2/);
    assert.equal(calls.filter(call => call.sql === 'rollback').length, 2);
    assert.equal(seq, 0);

    assert.equal(await registerFarmerSwine(farmerId, batchId, records, user, schema), 2);
    assert.equal(await registerFarmerSwine(farmerId, batchId, records, user, schema), 2);
    await assert.rejects(registerFarmerSwine(farmerId, batchId, [record], user, schema), /different entries/);
    assert.equal(seq, 2);
    const inserts = calls.filter(call => call.sql.startsWith('insert into "swine_records"'));
    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].params.filter(param => param === farmerId).length, 2);
    assert.equal(inserts[0].params.filter(param => param === 'Existing Farmer').length, 2);
    assert.ok(inserts[0].params.includes(`HIN-${new Date().getFullYear()}-0001`));
    assert.ok(inserts[0].params.includes(`HIN-${new Date().getFullYear()}-0002`));
    assert.ok(calls.some(call => call.sql === 'SET LOCAL ROLE registry_farmer_swine_writer'));
    assert.ok(calls.every(call => !call.sql.startsWith('insert into "farmers"')));
  } finally {
    pool.connect = original;
  }
});
