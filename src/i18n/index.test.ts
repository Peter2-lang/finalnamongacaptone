import assert from 'node:assert/strict';
import { test } from 'node:test';
import { en } from './en.ts';
import { fil } from './fil.ts';
import { ceb } from './ceb.ts';
import { formatTranslation } from './index.ts';

test('Filipino and Cebuano dictionaries cover every English key', () => {
  for (const [language, dictionary] of Object.entries({ fil, ceb })) {
    assert.deepEqual(Object.keys(en).filter(key => !(key in dictionary)), [], language);
  }
});

test('interpolation preserves literal dollar values and unknown variables', () => {
  assert.equal(formatTranslation('Price: {{price}}, {name}, {unknown}', { price: '$&', name: 'Juan' }), 'Price: $&, Juan, {unknown}');
});
