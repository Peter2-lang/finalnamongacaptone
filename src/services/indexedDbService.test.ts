import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {indexedDbService} from './indexedDbService.ts';
globalThis.window = {indexedDB:globalThis.indexedDB,dispatchEvent:()=>true} as any;

test('offline drafts, queued deletions, acknowledgement remapping and cloud merge preserve intent',async()=>{
 await indexedDbService.clear('swineRecords');await indexedDbService.clear('syncQueue');
 const draft={id:'local-1',pigIdTag:'LOCAL-1',isSynced:false,farmerName:'Fixture'};
 const create=await indexedDbService.enqueueSyncItem('create','swine',draft.id,draft,2,'owner',{record:draft});
 assert.equal((await indexedDbService.get<any>('swineRecords','local-1')).farmerName,'Fixture');
 await indexedDbService.enqueueSyncItem('update','swine',draft.id,{...draft,farmerName:'Edited'},2,'owner',{record:{...draft,farmerName:'Edited'}});
 await indexedDbService.acknowledgeSwineOperation(create,'server-1','HIN-2026-0001');
 const queue=await indexedDbService.getPendingSyncQueue();assert.equal(queue.length,1);assert.equal(queue[0].entityId,'server-1');
 assert.equal((await indexedDbService.get<any>('swineRecords','server-1')).isSynced,false);
 const merged=await indexedDbService.mergeCloudSwineRecords([{id:'server-1',farmerName:'Old server',isSynced:true}]);
 assert.equal((merged[0] as any).farmerName,'Edited');
 await indexedDbService.enqueueSyncItem('delete','swine','server-1',{},2,'owner',{deleteId:'server-1'});
 assert.deepEqual(await indexedDbService.mergeCloudSwineRecords([{id:'server-1',isSynced:true}]),[]);
 assert.equal((await indexedDbService.getPendingSyncQueue()).length,2);
});

test('acknowledged archive changes clear the pending dashboard marker and retain archived state',async()=>{
 await indexedDbService.clear('swineRecords');await indexedDbService.clear('syncQueue');
 const record={id:'archive-1',isArchived:true,isSynced:false,pendingArchiveSync:true};
 const queued=await indexedDbService.enqueueSyncItem('archive','swine',record.id,{isArchived:true},2,'owner',{record});
 await indexedDbService.acknowledgeSwineOperation(queued);
 const saved=await indexedDbService.get<any>('swineRecords',record.id);
 assert.equal(saved.isArchived,true);
 assert.equal(saved.pendingArchiveSync,false);
 assert.equal(saved.isSynced,true);
 assert.equal((await indexedDbService.getPendingSyncQueue()).length,0);
});
