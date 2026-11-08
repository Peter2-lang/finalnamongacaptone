import assert from 'node:assert/strict';
import {test} from 'node:test';
import {assistantErrorCode,assistantErrorMessage} from './assistantErrors';
test('provider errors classify invalid credentials, quotas and timeouts without echoing secrets',()=>{
 assert.equal(assistantErrorCode({status:400,message:'API key not valid. Please pass a valid API key.'}),'provider_configuration');
 assert.equal(assistantErrorCode({status:504,message:'DEADLINE_EXCEEDED'}),'provider_timeout');
 assert.equal(assistantErrorCode({status:429}),'provider_quota');
 assert.equal(assistantErrorCode({name:'TimeoutError'}),'provider_timeout');
 for(const language of ['en','ceb','fil']){
  const admin=assistantErrorMessage('provider_configuration',language,true);assert.match(admin,/GEMINI_API_KEY/);
  const guest=assistantErrorMessage('provider_configuration',language,false);assert.doesNotMatch(guest,/GEMINI_API_KEY/);
 }
});
