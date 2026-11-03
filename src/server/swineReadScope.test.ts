import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSwineReadFilters,agentMayReadSwine } from './swineReadScope.ts';
test('agent query parameters cannot broaden ready-to-sell or archive scope',()=>{
 assert.deepEqual(resolveSwineReadFilters(true,'false','true'),{readyToSell:true,isArchived:false});
 assert.deepEqual(resolveSwineReadFilters(false,'false','true'),{readyToSell:false,isArchived:true});
 assert.equal(agentMayReadSwine({readyToSell:false,isArchived:false}),false);
 assert.equal(agentMayReadSwine({readyToSell:true,isArchived:true}),false);
 assert.equal(agentMayReadSwine({readyToSell:true,isArchived:false}),true);
});
