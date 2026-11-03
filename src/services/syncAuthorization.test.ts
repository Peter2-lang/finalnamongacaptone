import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requireSyncAuthorization,assertQueueOwnership} from './syncAuthorization.ts';

test('public health cannot authorize sync; session and active linked profile are required',async()=>{
 let profile:any={id:'profile',authUserId:'user',active:true,isActive:true,status:'active'};
 let session:any={access_token:'fixture',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user'}};
 let refreshes=0;
 const client:any={auth:{getSession:async()=>({data:{session}}),getUser:async()=>({data:{user:{id:'user'}}}),refreshSession:async()=>{refreshes++;return {data:{session:{...session,expires_at:Math.floor(Date.now()/1000)+3600}}};}}};
 const fetcher:any=async()=>new Response(JSON.stringify({success:true,data:profile}));
 assert.equal((await requireSyncAuthorization(client,fetcher)).userId,'user');
 session.expires_at=1;
 await requireSyncAuthorization(client,fetcher);assert.equal(refreshes,1);
 for(const override of [{active:false},{isActive:false},{status:'suspended'},{authUserId:'other'}]){
  const before=profile;profile={...before,...override};
  await assert.rejects(requireSyncAuthorization(client,fetcher),/sign in again/);profile=before;
 }
 session=null;await assert.rejects(requireSyncAuthorization(client,fetcher),/sign in again/);
 await assert.rejects(requireSyncAuthorization(null,fetcher),/sign in again/);
 assert.throws(()=>assertQueueOwnership([{ownerUserId:'other'}],'user'),/another account/);
 assert.throws(()=>assertQueueOwnership([{}],'user'),/no verified owner/);
 assert.doesNotThrow(()=>assertQueueOwnership([{ownerUserId:'user'}],'user'));
});
