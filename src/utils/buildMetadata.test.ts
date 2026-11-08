import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wasBuildUpdated,initializeBuildTracking,markBuildReloaded,APP_BUILD_STORAGE_KEY} from './buildMetadata';
test('build changes are checked before initialization and reload at most once',()=>{
 const values=new Map<string,string>([[APP_BUILD_STORAGE_KEY,'previous-build']]);
 const storage={getItem:(k:string)=>values.get(k)||null,setItem:(k:string,v:string)=>values.set(k,v)};
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:storage});
 assert.equal(wasBuildUpdated(),true);initializeBuildTracking();assert.equal(wasBuildUpdated(),false);assert.equal(markBuildReloaded(),true);assert.equal(markBuildReloaded(),false);
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem(){throw new Error('storage unavailable');}}});assert.equal(markBuildReloaded(),false);
});
