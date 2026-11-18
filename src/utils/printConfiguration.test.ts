import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PRINT_CONFIGURATION as defaults,PAPER_SIZES,paperDimensions,validatePrintConfiguration} from './printConfiguration';
test('all supported papers produce physical dimensions in both orientations',()=>{
 for(const paper of Object.keys(PAPER_SIZES) as (keyof typeof PAPER_SIZES)[]){
  const portrait=paperDimensions({...defaults,paper});const landscape=paperDimensions({...defaults,paper,orientation:'landscape'});
  assert.deepEqual(landscape,[portrait[1],portrait[0]]);assert.ok(validatePrintConfiguration({...defaults,paper}));
 }
 assert.deepEqual(paperDimensions({...defaults,paper:'Long Bond'}),[215.9,330.2]);
});
test('reject malformed settings, script URLs, and invalid dimensions',()=>{
 for(const patch of [{paper:'unknown'},{margin:-1},{width:Infinity},{hiddenColumns:[-1]},{scale:0},{logos:[{url:'javascript:alert(1)',width:72,height:72,visible:true,aspect:true,alignment:'center',spacing:8}]}])assert.equal(validatePrintConfiguration({...defaults,...patch}),false);
 assert.equal(validatePrintConfiguration(null),false);
 assert.equal(validatePrintConfiguration({...defaults,title:'Official report'}),true);
});
