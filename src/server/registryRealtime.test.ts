import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadRegistryRealtimeCapability} from './registryRealtime.ts';
test('Realtime availability requires publication, RLS and operation-specific policies, and fails closed', async () => {
  let sql='';
  assert.equal(await loadRegistryRealtimeCapability(async query=>{sql=query;return {rows:[{supported:true}]};}),true);
  assert.match(sql,/pg_publication_tables/);
  assert.match(sql,/relrowsecurity/);
  assert.match(sql,/cmd='SELECT'/);
  assert.match(sql,/cmd='ALL'/);
  assert.equal(await loadRegistryRealtimeCapability(async()=>({rows:[{supported:false}]})),false);
  assert.equal(await loadRegistryRealtimeCapability(async()=>({rows:[]})),false);
  assert.equal(await loadRegistryRealtimeCapability(async()=>{throw new Error('catalog unavailable');}),false);
});
