import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mapDbToMessage} from './messages.ts';
test('message reads preserve subject, urgency and attachments with legacy compatibility',()=>{
 const current=mapDbToMessage({id:'m',text:'Full body',attachments:{subject:'Official subject',priority:'urgent',files:[{path:'private/file.pdf'}]}});
 assert.equal(current.subject,'Official subject');assert.equal(current.priority,'urgent');assert.deepEqual(current.attachments,[{path:'private/file.pdf'}]);
 const legacy=mapDbToMessage({id:'legacy',text:'Legacy body',attachments:[{path:'old/file'}]});
 assert.equal(legacy.subject,'Legacy body');assert.deepEqual(legacy.attachments,[{path:'old/file'}]);
});

test('message read receipts are scoped to the requesting user',()=>{
 const row={id:'m',senderId:'admin-1',text:'Broadcast',isRead:false,attachments:{readBy:['focal-1']}};
 assert.equal(mapDbToMessage(row,'focal-1').isRead,true);
 assert.equal(mapDbToMessage(row,'focal-2').isRead,false);
 assert.equal(mapDbToMessage(row,'admin-1').isRead,true);
 assert.deepEqual(mapDbToMessage(row,'focal-2').readBy,['focal-1']);
});
