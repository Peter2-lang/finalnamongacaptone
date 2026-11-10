import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {storageService} from './storageService.ts';
import {indexedDbService} from './indexedDbService.ts';
import type {SwineRecord, UserAccount} from '../types.ts';
const items = new Map<string,string>();
globalThis.localStorage = {getItem:(key:string)=>items.get(key) ?? null,setItem:(key:string,value:string)=>items.set(key,value),removeItem:(key:string)=>items.delete(key)} as any;
globalThis.window = {indexedDB:globalThis.indexedDB,dispatchEvent:()=>true} as any;
Object.defineProperty(globalThis, 'navigator', {configurable:true,value:{onLine:true}});
const owner = {id:'owner',role:'admin',assignedBarangay:'Ambacon'} as UserAccount;

test('GIS cache is scoped to the authenticated account, role and barangay', () => {
  storageService.setCurrentUser(owner);
  storageService.saveSwineRecords([{id:'cached'} as SwineRecord]);
  assert.equal(storageService.getSwineRecords().length,1);
  for (const user of [null,{...owner,id:'other'},{...owner,role:'agent'},{...owner,assignedBarangay:'Bangcas A'}]) {
    storageService.setCurrentUser(user as UserAccount | null);
    assert.equal(storageService.getSwineRecords().length,0);
  }
  storageService.setCurrentUser(owner);
  assert.equal(storageService.getSwineRecords().length,1);
});

test('snapshot publishes active and archived records atomically and preserves queued edits and deletes', async () => {
  await indexedDbService.clear('swineRecords');
  await indexedDbService.clear('syncQueue');
  storageService.setCurrentUser(owner);
  const draft = {id:'edited',farmerName:'Pending edit',isSynced:false} as SwineRecord;
  storageService.saveSwineRecords([draft]);
  await indexedDbService.enqueueSyncItem('update','swine','edited',draft,2,owner.id,{record:draft});
  await indexedDbService.enqueueSyncItem('delete','swine','deleted',{},2,owner.id);
  const events: any[] = [];
  window.dispatchEvent = (event:any) => { if(event.type==='swine_records_updated') events.push(event.detail); return true; };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url:any) => new Response(JSON.stringify({success:true,total:2,data:String(url).includes('isArchived=true')
    ? [{id:'archived',isArchived:true},{id:'active',isArchived:false}]
    : [{id:'edited',farmerName:'Old server value'},{id:'deleted'}]}), {headers:{'content-type':'application/json'}});
  try {
    const {records} = await storageService.fetchAllVisibleSwineRecords();
    assert.equal(events.length,1);
    assert.deepEqual(records.map(record=>record.id).sort(),['active','archived','edited']);
    assert.equal(records.find(record=>record.id==='edited')?.farmerName,'Pending edit');
    assert.equal(records.find(record=>record.id==='edited')?.isSynced,false);
  } finally { globalThis.fetch = originalFetch; }
});
