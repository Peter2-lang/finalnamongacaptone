import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canArchiveSwineRecord, canPermanentlyDeleteSwineRecord } from './swineArchivePermissions.ts';

const record = { barangay: 'Ambacon' };

test('super admins and admins can archive and restore; admins need an explicit delete grant', () => {
  for (const role of ['super_admin', 'admin']) {
    assert.equal(canArchiveSwineRecord({ role }, record, true), true);
    assert.equal(canArchiveSwineRecord({ role }, record, false), true);
  }
  assert.equal(canPermanentlyDeleteSwineRecord({ role: 'super_admin' }), true);
  assert.equal(canPermanentlyDeleteSwineRecord({ role: 'admin' }), false);
  assert.equal(canPermanentlyDeleteSwineRecord({
    role: 'admin',
    permissions: ['swine_records.permanent_delete'],
  }), true);
});

test('focal archive and restore grants are scoped to the assigned barangay', () => {
  const focal = {
    role: 'focal',
    assignedBarangay: 'Ambacon',
    permissions: ['swine_records.archive', 'swine_records.restore'],
  };
  assert.equal(canArchiveSwineRecord(focal, record, true), true);
  assert.equal(canArchiveSwineRecord(focal, record, false), true);
  assert.equal(canArchiveSwineRecord(focal, { barangay: 'Bugho' }, true), false);
  assert.equal(canPermanentlyDeleteSwineRecord(focal), false);
  assert.equal(canArchiveSwineRecord({ ...focal, permissions: [] }, record, true), false);
});

test('agents cannot archive, restore, or permanently delete', () => {
  const agent = {
    role: 'agent',
    permissions: ['swine_records.archive', 'swine_records.restore', 'swine_records.permanent_delete'],
  };
  assert.equal(canArchiveSwineRecord(agent, record, true), false);
  assert.equal(canArchiveSwineRecord(agent, record, false), false);
  assert.equal(canPermanentlyDeleteSwineRecord(agent), false);
});
