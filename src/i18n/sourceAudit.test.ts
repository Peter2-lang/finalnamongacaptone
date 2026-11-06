import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectUi,jsxText} from '../../scripts/i18n/ui-source.mjs';
import {validateBatch} from '../../scripts/i18n/catalog-validation.mjs';

test('localization candidates include interface text and templates, never input values or identifiers',()=>{
 const source='<div><h1>Register Swine</h1><p>{record.farmerName}</p><input value="Juan Dela Cruz" name="farmer_name" placeholder="Enter a name"/><option value="sold">Sold</option><span>{`Saved ${count} records`}</span></div>';
 const result=inspectUi('src/components/Example.tsx',source);
 const strings=result.sites.map((site:any)=>site.source);
 assert.ok(strings.includes('Register Swine'));assert.ok(strings.includes('Enter a name'));assert.ok(strings.includes('Saved {arg0} records'));
 assert.ok(!strings.includes('Juan Dela Cruz'));assert.ok(!strings.includes('farmer_name'));assert.ok(!strings.includes('record.farmerName'));
 assert.deepEqual(result.sites.find((site:any)=>site.kind==='template')?.values,['count']);
 assert.equal(jsxText('&ldquo;Swine&rdquo;'),'“Swine”');
});
test('official document bodies and code examples are preserved explicitly',()=>{
 const result=inspectUi('src/components/certificate/BarangayCertificateView.tsx','<p>TO WHOM IT MAY CONCERN:</p>');
 assert.equal(result.sites.length,0);assert.equal(result.preserved[0].reason,'official document body');
 const code=inspectUi('src/components/Example.tsx','<div><code>farmer_name</code><button>Save Changes</button></div>');
 assert.equal(code.preserved[0].reason,'literal/code content');assert.equal(code.sites[0].source,'Save Changes');
});
test('catalog batches reject incomplete, duplicated and placeholder-damaging translations',()=>{
 const sources=['Saved {arg0} records'];
 assert.doesNotThrow(()=>validateBatch(sources,[{source:sources[0],ceb:'Natipigan ang {arg0} ka rekord',fil:'Na-save ang {arg0} tala'}]));
 for(const bad of [[],[{source:'Unknown',ceb:'X',fil:'Y'}],[{source:sources[0],ceb:'Na-save',fil:'Na-save'}]])assert.throws(()=>validateBatch(sources,bad));
});

test('state-setter collection never changes stored values or enum states',()=>{
 const source="function Form(){setError('Invalid input.');setHealthStatus('healthy');return <p>Ready</p>}";
 const result=inspectUi('src/components/Form.tsx',source);
 assert.equal(result.sites.find((site:any)=>site.source==='Invalid input.')?.deferred,true);
 assert.equal(result.sites.some((site:any)=>site.source==='healthy'),false);
});
