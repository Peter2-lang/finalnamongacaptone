import {test} from 'node:test';
import assert from 'node:assert/strict';
import {csvCell,escapeHtml} from './exportEncoding';
test('CSV preserves quotes, commas and newlines in one cell and neutralizes spreadsheet formulas',()=>{
 assert.equal(csvCell('Farmer "One", Jr.\nHinunangan'),'"Farmer ""One"", Jr.\nHinunangan"');
 assert.equal(csvCell('=HYPERLINK("https://example.invalid")'),'"\'=HYPERLINK(""https://example.invalid"")"');
 assert.equal(csvCell(42),'42');assert.equal(csvCell(null),'""');
});
test('Word and GIS markup displays record text literally',()=>{
 assert.equal(escapeHtml('<img src=x onerror="bad()"> & Farmer'),'&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; Farmer');
});
