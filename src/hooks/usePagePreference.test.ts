import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPreference,choice,integer,tagQuery,recordReference} from './usePagePreference';
test('UI restoration validates URL/storage primitives, expires them and never restores records or names',()=>{
 const saved=new Map<string,string>();
 Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{search:'?ui_page=3'}}});
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:(k:string)=>saved.get(k)||null}});
 assert.equal(readPreference('scope','ui_page',1,integer(100)),3);
 (window as any).location.search='?ui_page=999999999';assert.equal(readPreference('scope','ui_page',1,integer(100)),1);
 (window as any).location.search='';saved.set('scope',JSON.stringify({at:Date.now(),value:2}));assert.equal(readPreference('scope','ui_page',1,integer(100)),2);
 assert.equal(readPreference('other-user','ui_page',1,integer(100)),1);
 saved.set('scope',JSON.stringify({at:Date.now()-9*3600000,value:2}));assert.equal(readPreference('scope','ui_page',1,integer(100)),1);
 assert.equal(tagQuery('Private Farmer Name'),undefined);assert.equal(tagQuery('HIN-2026-001'),'HIN-2026-001');assert.equal(recordReference({farmerName:'private'}),undefined);
 assert.equal(choice(['Ambacon'])('Canipaan'),undefined);
});
