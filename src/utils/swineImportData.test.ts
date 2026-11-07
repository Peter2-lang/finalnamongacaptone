import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as XLSX from 'xlsx';
import {normalizeImportDataset, IMPORT_LIMITS, coerceImportValue} from './swineImportData';
import {analyzeImportColumns, detectDataTypeFromValues, validateImportRow} from './columnMatcher';
import {INITIAL_REGISTRY_FORM_SCHEMA} from '../data/initialFormSchema';
import {validateImportFieldDefinitions, validateImportRecordShape} from '../server/swineImportValidation';
const barangays=[{id:'00000000-0000-4000-8000-000000000001',name:'Canipaan'}];
const row={farmer_name:'Juan Dela Cruz',barangay:'Canipaan',swine_type:'Grower',weight:65,age_months:5,color:'White',vaccinated:true};
const validate=(data:any[],existing=new Set<string>())=>{
 const {rows,headers}=normalizeImportDataset(data);
 const mappings=analyzeImportColumns(headers,rows,INITIAL_REGISTRY_FORM_SCHEMA),seen=new Set<string>();
 return {mappings,results:rows.map((record,index)=>validateImportRow(index+1,record,mappings,barangays,existing,seen,'skip'))};
};
test('JSON array and structured exports detect the union of every field',()=>{
 for(const container of [[row,{...row,feeding_type:'Mixed Feeds'}],{records:[row,{...row,feeding_type:'Mixed Feeds'}]},{data:[{...row,custom_fields:{feeding_type:'Commercial'}}]}]){
  const result=normalizeImportDataset(container);assert.ok(result.headers.includes('feeding_type'));
 }
 const {mappings,results}=validate([row]);
 assert.equal(mappings.find(m=>m.fileHeader==='age_months')?.targetFieldKey,'age_months');
 assert.equal(results[0].isValid,true);
 assert.equal(results[0].mappedRecord.actualWeightKg,65);assert.equal(results[0].mappedRecord.ageMonths,5);
 assert.equal(results[0].mappedRecord.customFields?.vaccinated,true);
 assert.equal(results[0].mappedRecord.barangay_id,barangays[0].id);
});
test('invalid structures, prototype keys, collisions and oversized datasets are rejected',()=>{
 for(const input of [null,{},[],[row,null],[row,5],{records:{}},JSON.parse('[{"__proto__":{"bad":true}}]'),[{...row,customFields:{weight:1}}]])assert.throws(()=>normalizeImportDataset(input));
 assert.throws(()=>JSON.parse('{bad'));
 assert.throws(()=>normalizeImportDataset(Array.from({length:IMPORT_LIMITS.rows+1},()=>row)),/up to/);
 assert.throws(()=>normalizeImportDataset([{...row,color:'x'.repeat(IMPORT_LIMITS.cellChars+1)}]),/characters/);
});
test('type inference inspects late rows, preserves mixed types and does not invent single-option dropdowns',()=>{
 assert.equal(detectDataTypeFromValues([true,false]).type,'checkbox');
 assert.equal(detectDataTypeFromValues([65,70]).type,'number');
 assert.equal(detectDataTypeFromValues(['2026-03-12']).type,'date');
 assert.equal(detectDataTypeFromValues(['03/12/2026']).type,'text');
 assert.equal(detectDataTypeFromValues(['2026-02-30']).type,'text');
 const structured = detectDataTypeFromValues([{feed:'Mixed'}, {feed:'Commercial'}, {feed:'Mixed'}]);
 assert.equal(structured.type,'text'); assert.ok(structured.warning);
 assert.equal(detectDataTypeFromValues([new Date('2026-03-12T00:00:00Z')]).type,'date');
 assert.equal(detectDataTypeFromValues(['White','White','White']).type,'text');
 const {mappings}=validate(Array.from({length:40},(_,index)=>({...row,extra:index<39?5:'unmeasured'})));
 assert.equal(mappings.find(m=>m.fileHeader==='extra')?.detectedDataType,'text');assert.ok(mappings.find(m=>m.fileHeader==='extra')?.typeWarning);
 assert.equal(coerceImportValue(false,'checkbox'),false);assert.equal(coerceImportValue(0,'number'),0);assert.equal(coerceImportValue(null,'number'),null);
 assert.throws(()=>coerceImportValue('2026-02-30','date'));
});
test('validation rejects required values, unknown barangays, invalid numbers/dates and duplicate file tags',()=>{
 for(const bad of [{...row,farmer_name:''},{...row,barangay:'Unknown Village'},{...row,weight:'-3'},{...row,weight:'12kg'},{...row,birth_date:'2026-02-30'},{...row,age_months:-5},{...row,farmer_id:'bogus'}]) assert.equal(validate([bad]).results[0].isValid,false,JSON.stringify(bad));
 const {results}=validate([{...row,pig_id_tag:'HIN-2026-0010'},{...row,pig_id_tag:'HIN-2026-0010'}]);
 assert.equal(results[0].isValid,true);assert.equal(results[1].isValid,false);assert.equal(results[1].isDuplicate,true);
 assert.equal(validate([{...row,pig_id_tag:'HIN-2026-0010'}],new Set(['HIN-2026-0010'])).results[0].isValid,false);
});
test('XLSX, legacy XLS and CSV feed the same mapping and validation',()=>{
 for(const bookType of ['xlsx','xls','csv'] as const){
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([row,{...row,feeding_type:'Mixed'}]),'Records');
  const buffer=XLSX.write(workbook,{type:'buffer',bookType});
  const read=XLSX.read(buffer,{type:'buffer',cellDates:true});
  const rows=XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]],{raw:true,defval:''});
  const parsed=validate(rows);assert.equal(parsed.results.every(result=>result.isValid),true,bookType);
  assert.ok(parsed.mappings.find(mapping=>mapping.fileHeader==='feeding_type')?.isNewField);
 }
});
test('10,000 supported rows retain late optional keys and custom false/zero values',()=>{
 const rows=Array.from({length:10000},(_,index)=>({...row,farmer_name:`Farmer ${index}`,...(index===9999?{last_field:0}:{}),vaccinated:false}));
 const parsed=validate(rows);assert.ok(parsed.mappings.some(mapping=>mapping.fileHeader==='last_field'));
 assert.equal(parsed.results.length,10000);assert.equal(parsed.results.at(-1)?.mappedRecord.customFields?.last_field,0);
 assert.equal(parsed.results.at(-1)?.mappedRecord.customFields?.vaccinated,false);
});
test('server field definitions accept only additive safe fields and validate farmer references',()=>{
 assert.equal(validateImportFieldDefinitions([{fieldKey:'color',label:'Color',type:'text'}])[0].required,false);
 for(const fieldKey of ['__proto__','constructor','x; DROP TABLE users',''])assert.throws(()=>validateImportFieldDefinitions([{fieldKey,label:'Bad',type:'text'}]));
 assert.throws(()=>validateImportFieldDefinitions([{fieldKey:'a',label:'A',type:'sql'}]));
 assert.throws(()=>validateImportRecordShape({farmerName:'',barangay:'Canipaan'}));
 assert.throws(()=>validateImportRecordShape({farmerName:'A',barangay:'Canipaan',farmerId:'invalid'}));
});
