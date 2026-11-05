import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getTableColumns} from 'drizzle-orm';
import {pool} from './index';
import {persistSwineImportBatch,mapDbToSwine} from './swine';
import {getFullRegistrySchemaFromDb} from './registrySchema';
import {swineRecords,registrySchema,systemSettings} from './schema';

// Isolated PostgreSQL-protocol fixture: actual Drizzle transactions and SQL are
// exercised, with no credentials, network, or production records.
test('import stores additive fields and typed JSONB, reports failed rows, and receipts retries',async()=>{
 const originalConnect=pool.connect,originalQuery=pool.query;
 const fields:any[]=[];const saved:any[]=[];const receipts:any[]=[];const queries:string[]=[];
 const columns=(table:any)=>getTableColumns(table) as Record<string,{name:string}>;
 const positional=(table:any,row:any)=>Object.keys(columns(table)).map(key=>row[key]??null);
 const decode=(table:any,text:string,params:any[])=>{
  const names=text.match(/insert into "[^"]+" \((.*?)\) values/i)![1].split(',').map(value=>value.trim().replaceAll('"',''));
  const values=text.match(/\) values \((.*?)\)/i)![1].split(',').map(value=>value.trim());
  const result:any={};
  for(const [key,column] of Object.entries(columns(table))){
   const expression=values[names.indexOf(column.name)];
   const match=expression?.match(/^\$(\d+)/);let value=match?params[Number(match[1])-1]:null;
   if(['customFields','options','value'].includes(key)&&typeof value==='string')value=JSON.parse(value);
   result[key]=value;
  }
  return result;
 };
 const query=async(config:any,params:any[]=[])=>{
  const text=typeof config==='string'?config:config.text;queries.push(text);
  if(text.includes('from "system_settings"'))return {rows:receipts.filter(row=>row.key===params[0]).map(row=>positional(systemSettings,row))};
  if(text.includes('from "registry_schema"'))return {rows:fields.map(row=>positional(registrySchema,row))};
  if(text.includes('SELECT setting_value'))return {rows:receipts.filter(row=>row.key==='registry_form_schema').map(row=>({value:row.value}))};
  if(text.includes('from "barangays"'))return {rows:[['00000000-0000-4000-8000-000000000003']]};
  if(text.includes('from "farmers"'))return {rows:[['00000000-0000-4000-8000-000000000004']]};
  if(text.startsWith('insert into "registry_schema"')){fields.push(decode(registrySchema,text,params));return {rows:[]};}
  if(text.startsWith('insert into "system_settings"')){receipts.push(decode(systemSettings,text,params));return {rows:[]};}
  if(text.startsWith('insert into "swine_records"')){
   const row=decode(swineRecords,text,params);
   if(row.pigIdTag==='HIN-2026-0002')throw Object.assign(new Error('unique ear tag violation'),{code:'23505'});
   saved.push(row);return {rows:[positional(swineRecords,row)]};
  }
  return {rows:[]};
 };
 (pool as any).query=query;(pool as any).connect=async()=>({query,release:()=>{}});
 const field={id:'fld_import_feeding_type',fieldKey:'feeding_type',label:'Feeding Type',type:'text',visible:true,required:false,searchable:false} as const;
 const row={id:'00000000-0000-4000-8000-000000000001',pigIdTag:'HIN-2026-0001',earTagNo:'HIN-2026-0001',farmerId:'00000000-0000-4000-8000-000000000004',farmerName:'Isolated Farmer',barangay:'Canipaan',customFields:{feeding_type:'Mixed Feeds',vaccinated:false,score:0}};
 try{
  const result=await persistSwineImportBatch([row,{...row,id:'00000000-0000-4000-8000-000000000002',pigIdTag:'HIN-2026-0002',earTagNo:'HIN-2026-0002'}],[field],'sec_swine','fixture-receipt','hash',{sourceIndexes:[1,4],failures:[],skipped:[]});
  assert.equal(result.data.length,1);assert.equal(result.failures[0].index,4);assert.match(result.failures[0].reason,/already exists/);
  assert.equal(saved[0].customFields.feeding_type,'Mixed Feeds');assert.equal(saved[0].customFields.vaccinated,false);assert.equal(saved[0].customFields.score,0);
  assert.equal(fields.length,1);assert.ok(queries.some(sql=>sql.startsWith('rollback to savepoint')));assert.ok(queries.includes('commit'));
  assert.equal(mapDbToSwine(saved[0]).customFields?.feeding_type,'Mixed Feeds');
  const reloaded=await getFullRegistrySchemaFromDb();assert.ok(reloaded.sections.flatMap(section=>section.fields).some(item=>item.fieldKey==='feeding_type'));assert.equal(reloaded.sections.flatMap(section=>section.fields).find(item=>item.fieldKey==='feeding_type')?.searchable,false);
  const retried=await persistSwineImportBatch([row],[field],'sec_swine','fixture-receipt','hash',{sourceIndexes:[1],failures:[],skipped:[]});
  assert.equal(retried.data[0].id,result.data[0].id);assert.equal(saved.length,1);assert.equal(fields.length,1);
  await assert.rejects(persistSwineImportBatch([row],[],'sec_swine','fixture-receipt','changed',{sourceIndexes:[],failures:[],skipped:[]}),/different data/);
 }finally{pool.connect=originalConnect;pool.query=originalQuery;}
});
