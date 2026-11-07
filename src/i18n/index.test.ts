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

test('static interface catalog has real entries in all three languages and never exposes raw keys',async()=>{
 const {interfaceLabels}=await import('./interfaceLabels');
 const {resolveTranslation,dictionaries}=await import('./index');
 for(const [english,labels] of Object.entries(interfaceLabels)){
  assert.ok(labels.ceb?.trim(),english);assert.ok(labels.fil?.trim(),english);
  for(const language of ['en','ceb','fil'] as const)assert.ok(dictionaries[language][`ui.${english}`]);
 }
 assert.equal(resolveTranslation('ceb','ui.Cancel'),'Kanselahon');
 assert.equal(resolveTranslation('fil','unmapped_key',undefined,'Farmer Name'),'Pangalan ng Magsasaka');
 assert.equal(resolveTranslation('fil','missing.deep_key'),'Missing deep key');
});
