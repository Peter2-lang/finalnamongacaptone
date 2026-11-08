import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundedModule} from './moduleLoading';
import {normalizePath,tabForPath} from './appRoutes';
test('a never-settling module import rejects with a recoverable deadline',async()=>{
 await assert.rejects(boundedModule(()=>new Promise(()=>{}),10),{name:'ModuleLoadTimeout'});
 assert.deepEqual(await boundedModule(async()=>({default:'loaded'}),10),{default:'loaded'});
 await assert.rejects(boundedModule(async()=>{throw new Error('Failed to fetch dynamically imported module');}),/dynamically imported/);
});
test('route resolution ignores filters and fragments without losing nested modules',()=>{
 assert.equal(tabForPath('/records?ui_page=3#table'),'records');assert.equal(tabForPath('/kamirani/layout?ui_page=1'),'layout_config');assert.equal(normalizePath('/GIS/?ui_barangay=Ambacon'),'gis'.replace(/^/,'/'));
});

test('explicit cache recovery reloads the same URL without clearing unrelated storage',async()=>{
 const {reloadCurrentPage}=await import('./moduleLoading');let reloads=0;const removed:string[]=[];let unregistered=0;
 const cache={keys:async()=>['workbox-precache-current','api-runtime-cache','unrelated-cache'],delete:async(k:string)=>{removed.push(k);return true;}};
 Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://app.invalid'}});
 Object.defineProperty(globalThis,'window',{configurable:true,value:{caches:cache,location:{reload:()=>reloads++}}});Object.defineProperty(globalThis,'caches',{configurable:true,value:cache});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serviceWorker:{getRegistrations:async()=>[{scope:'https://app.invalid/',unregister:async()=>{unregistered++;}},{scope:'https://app.invalid/other/',unregister:async()=>{throw new Error('Must not unregister other apps');}}]}}});
 await reloadCurrentPage();assert.equal(reloads,1);assert.equal(unregistered,1);assert.deepEqual(removed,['workbox-precache-current','api-runtime-cache']);
});

test('login return URLs keep UI parameters and remove authentication callback credentials',async()=>{
 const {safeReturnPath}=await import('./appRoutes');assert.equal(safeReturnPath({pathname:'/records',search:'?ui_page=2&access_token=private&code=private',hash:'#refresh_token=private'}),'/records?ui_page=2');
});
