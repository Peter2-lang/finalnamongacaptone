import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasValidGisLocation } from './gisLocation.ts';
import { validateSwineMutation } from '../server/swineMutationValidation.ts';

test('farm GPS rejects missing, nonfinite and out-of-municipality coordinates', () => {
  for (const [latitude, longitude] of [[0, 0], [NaN, 125.2], [Infinity, 125.2], [10.4, Infinity], [14.6, 121]]) {
    assert.equal(hasValidGisLocation({latitude, longitude}), false);
  }
  assert.equal(hasValidGisLocation({latitude:10.401804141, longitude:125.18452409}), true);
});

test('backend enforces polygon and barangay consistency while preserving missing legacy GPS', () => {
  assert.doesNotThrow(() => validateSwineMutation({latitude:0,longitude:0}));
  assert.doesNotThrow(() => validateSwineMutation({latitude:null,longitude:null}));
  assert.doesNotThrow(() => validateSwineMutation({latitude:10.401804141,longitude:125.18452409,barangay:'Ambacon'}));
  assert.throws(() => validateSwineMutation({latitude:10.401804141,longitude:125.18452409,barangay:'Bangcas A'}), /differs/);
  assert.throws(() => validateSwineMutation({latitude:14.6,longitude:121}), /Hinunangan/);
});
