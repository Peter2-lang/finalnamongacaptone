import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findMissingConflictKeys, REQUIRED_CONFLICT_KEYS, type CatalogIndex } from './writeRequirements.ts';

const valid=():CatalogIndex[]=>REQUIRED_CONFLICT_KEYS.map(([table,column])=>({table_name:table,index_name:`${table}_key`,columns:[column],is_unique:true,is_valid:true,is_ready:true,is_immediate:true,predicate:null,expression:null}));
test('write contract rejects partial, deferred, invalid and composite conflict indexes',()=>{
 assert.deepEqual(findMissingConflictKeys(valid()),[]);
 for(const change of [{predicate:'is_active'},{is_immediate:false},{is_valid:false},{is_ready:false},{is_unique:false},{expression:'lower(code)'},{columns:['code','name']}]){
  const indexes=valid();Object.assign(indexes.find(item=>item.table_name==='certificate_templates')!,change);
  assert.deepEqual(findMissingConflictKeys(indexes),[{table:'certificate_templates',column:'code',reason:'no_usable_unconditional_unique_index_for_on_conflict'}]);
 }
});
