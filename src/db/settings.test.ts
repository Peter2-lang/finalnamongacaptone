import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { pool } from './index.ts';
import { systemSettings } from './schema.ts';
import { getStoredSystemSetting, getSystemSetting, setSystemSetting } from './settings.ts';
import { getRequiredDatabaseColumns } from './requirements.ts';
import { readFileSync } from 'node:fs';

test('settings use normalized columns and preserve JSONB values without replacing identity', async () => {
 const columns=getTableColumns(systemSettings);
 assert.equal(columns.key.name,'setting_key');
 assert.equal(columns.value.name,'setting_value');
 assert.equal(columns.id.primary,true);
 assert.equal(columns.key.primary,false);
 const contract=getRequiredDatabaseColumns().filter(item=>item.table==='system_settings');
 assert.deepEqual(contract.map(item=>item.column).sort(),['id','setting_key','setting_value','updated_at']);
 const oldQuery=pool.query;
 const calls:Array<{text:string;params:unknown[]}>=[];
 let stored:unknown;
 pool.query=(async (config:any,params:unknown[]=[])=>{
  const text=typeof config==='string'?config:config.text;
  calls.push({text,params});
  if(text.startsWith('select'))return {rows:[[stored]]};
  return {rows:[]};
 }) as any;
 try {
  for(const value of [{nested:{list:[1,false,null,'text']}},[1,'two'],false,0,'{"literal":"JSON string"}',null]){
   stored=value;
   assert.deepEqual(await getStoredSystemSetting('sample'),value);
   assert.deepEqual(await setSystemSetting('sample',value),value);
   const write=calls.at(-1)!;
   assert.match(write.text,/"setting_key"/);
   assert.match(write.text,/"setting_value"/);
   assert.match(write.text,/on conflict \("setting_key"\)/i);
   assert.match(write.text,/::jsonb/);
   const update=write.text.split(/do update set/i)[1];
   assert.doesNotMatch(update,/"id"\s*=/);
   assert.equal(write.params.filter(param=>param===JSON.stringify(value)).length,2);
  }
  stored=false;
  assert.equal(await getSystemSetting('sample',true),false);
  stored=0;
  assert.equal(await getSystemSetting('sample',99),0);
  const before=calls.length;
  await assert.rejects(setSystemSetting('sample',undefined),/Failed to persist/);
  assert.equal(calls.length,before,'invalid JSON never reaches the database');
  for(const {text} of calls)assert.doesNotMatch(text,/"(?:key|value)"/);
 } finally {pool.query=oldQuery;}
});

test('raw settings readers and registry upserts use normalized columns',()=>{
 const registry=readFileSync(new URL('./registrySchema.ts',import.meta.url),'utf8');
 const templates=readFileSync(new URL('./certificateTemplates.ts',import.meta.url),'utf8');
 assert.match(registry,/INSERT INTO public\.system_settings \(setting_key, setting_value, updated_at\)/);
 assert.match(registry,/ON CONFLICT \(setting_key\) DO UPDATE SET setting_value = EXCLUDED\.setting_value/);
 assert.match(registry,/VALUES \(\$1, \$2::jsonb, NOW\(\)\)/);
 for(const source of [registry,templates]) {
  assert.match(source,/SELECT setting_value AS value FROM public\.system_settings WHERE setting_key =/);
  assert.doesNotMatch(source,/(?:FROM (?:public\.)?system_settings WHERE key|INTO (?:public\.)?system_settings \(key)/);
 }
});
