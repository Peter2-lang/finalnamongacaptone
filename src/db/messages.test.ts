import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mapDbToMessage} from './messages.ts';
test('message reads preserve subject, urgency and attachments with legacy compatibility',()=>{
 const current=mapDbToMessage({id:'m',text:'Full body',attachments:{subject:'Official subject',priority:'urgent',files:[{path:'private/file.pdf'}]}});
 assert.equal(current.subject,'Official subject');assert.equal(current.priority,'urgent');assert.deepEqual(current.attachments,[{path:'private/file.pdf'}]);
 const legacy=mapDbToMessage({id:'legacy',text:'Legacy body',attachments:[{path:'old/file'}]});
 assert.equal(legacy.subject,'Legacy body');assert.deepEqual(legacy.attachments,[{path:'old/file'}]);
});
