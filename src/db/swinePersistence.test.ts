import assert from 'node:assert/strict';
import {test} from 'node:test';
import {getTableColumns} from 'drizzle-orm';
import {pool} from './index.ts';
import {swineRecords} from './schema.ts';
import {batchUpsertSwineRecords,deleteSwineRecordById,mapDbToSwine} from './swine.ts';
const swineId='00000000-0000-4000-8000-000000000001';
const farmerId='00000000-0000-4000-8000-000000000002';
const record={id:swineId,pigIdTag:'HIN-2026-0001',earTagNo:'HIN-2026-0001',farmerName:'Fixture Farmer',farmerContact:'+639123456789',barangay:'Ambacon',birthDate:'2026-01-01'};
test('tag deletion never attempts a UUID cast or runs duplicate deletes',async()=>{
 const original=pool.query;const calls:any[]=[];
 (pool as any).query=async(config:any,params:any[])=>{calls.push({text:config.text||config,params});return {rows:[],rowCount:1};};
 try{await deleteSwineRecordById('HIN-2026-0001');assert.equal(calls.length,1);assert.doesNotMatch(calls[0].text,/where "swine_records"\."id" =/);}
 finally{pool.query=original;}
});
test('batch registration links farmers and rolls back the whole batch on invalid later records',async()=>{
 const original=pool.connect;const calls:Array<{text:string;params:any[]}>=[];let released=false;
 (pool as any).connect=async()=>({release:()=>{released=true;},query:async(config:any,params:any[]=[])=>{
  const text=typeof config==='string'?config:config.text;calls.push({text,params});
  if(text.includes('from "barangays"'))return {rows:[['barangay-1']]};
  if(text.includes('from "farmers"'))return {rows:[]};
  if(text.startsWith('insert into "farmers"'))return {rows:[[farmerId]]};
  if(text.startsWith('insert into "swine_records"'))return {rows:[Object.keys(getTableColumns(swineRecords)).map(key=>({...record,farmerId} as any)[key]??null)]};
  return {rows:[]};
 }});
 try {
  await assert.rejects(batchUpsertSwineRecords([record,{...record,id:'00000000-0000-4000-8000-000000000003',farmerName:''}]),/farmer name/);
  assert.ok(calls.some(call=>call.text==='begin'));
  assert.ok(calls.some(call=>call.text==='rollback'));
  assert.equal(calls.filter(call=>call.text==='commit').length,0);
  assert.ok(calls.some(call=>call.text.startsWith('insert into "farmers"')));
  const lookup=calls.find(call=>call.text.includes('from "farmers"'))!;
  assert.doesNotMatch(lookup.text,/\bor\b/i);assert.ok(lookup.params.includes(record.farmerContact));assert.equal(released,true);
 } finally {pool.connect=original;}
});

test('GIS mapping never invents a municipal location for missing coordinates',()=>{
 const missing=mapDbToSwine({id:'missing',customFields:{}});assert.equal(missing.latitude,0);assert.equal(missing.longitude,0);
 const located=mapDbToSwine({id:'located',customFields:{latitude:10.4,longitude:125.2}});assert.equal(located.latitude,10.4);assert.equal(located.longitude,125.2);
});
