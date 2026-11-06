import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceTemplatePlaceholders } from './templateReplacer.ts';

test('certificate placeholders do not invent absent transaction or farmer details', () => {
  const result = replaceTemplatePlaceholders(
    '{{resident_name}}|{{barangay}}|{{number_of_pigs}}|{{buyer_name}}|{{buyer_address}}|{{destination}}|{{purpose}}|{{or_number}}|{{amount_paid}}|{{swine_age}}',
    { municipality: 'Hinunangan', province: 'Southern Leyte' },
  );
  assert.equal(result, '—|—|—|—|—|—|—|—|—|—');
});

test('certificate placeholders preserve supplied receipt values including zero amounts', () => {
  const result = replaceTemplatePlaceholders('{{or_number}}|{{amount_paid}}', {
    or_number: 'OR-123',
    amount_paid: 0,
  });
  assert.equal(result, 'OR-123|0');
});
