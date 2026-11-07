import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateImportRow } from './columnMatcher.ts';

const barangays = [{ id: 'ambacon', name: 'Ambacon', latitude: 10.4, longitude: 125.2 }] as any;
const baseMappings = [
  { fileHeader: 'Farmer', targetFieldKey: 'farmer_name', matchStatus: 'matched_core' },
  { fileHeader: 'Barangay', targetFieldKey: 'barangay', matchStatus: 'matched_core' },
  { fileHeader: 'Latitude', targetFieldKey: 'latitude', matchStatus: 'matched_core' },
  { fileHeader: 'Longitude', targetFieldKey: 'longitude', matchStatus: 'matched_core' },
] as any;

test('missing import IDs and GPS coordinates are left for server allocation and unlocated records stay unmapped', () => {
  const result = validateImportRow(1, { Farmer: 'Test Farmer', Barangay: 'Ambacon' }, baseMappings, barangays, new Set(), new Set(), 'update');

  assert.equal(result.isValid, true);
  assert.equal(result.mappedRecord.pigIdTag, '');
  assert.equal(result.mappedRecord.earTagNo, '');
  assert.equal(result.mappedRecord.latitude, 0);
  assert.equal(result.mappedRecord.longitude, 0);
  assert.equal(result.warnings.some(warning => warning.field === 'coordinates'), false);
});

test('duplicate rename delegates the replacement ID to the authoritative server sequence', () => {
  const mappings = [...baseMappings, { fileHeader: 'Pig ID', targetFieldKey: 'pig_id_tag', matchStatus: 'matched_core' }] as any;
  const result = validateImportRow(1, { Farmer: 'Test Farmer', Barangay: 'Ambacon', 'Pig ID': 'HIN-2026-0042' }, mappings, barangays, new Set(['HIN-2026-0042']), new Set(), 'rename');

  assert.equal(result.isValid, true);
  assert.equal(result.mappedRecord.pigIdTag, '');
  assert.match(result.warnings[0]?.message || '', /official tag will be allocated/i);
});

test('partial or invalid import coordinates are rejected and not assigned a fabricated map point', () => {
  const result = validateImportRow(1, { Farmer: 'Test Farmer', Barangay: 'Ambacon', Latitude: '10.4' }, baseMappings, barangays, new Set(), new Set(), 'update');

  assert.equal(result.isValid, false);
  assert.equal(result.mappedRecord.latitude, 0);
  assert.equal(result.mappedRecord.longitude, 0);
  assert.match(result.errors.find(error => error.field === 'coordinates')?.message || '', /both valid latitude and longitude/i);
});
