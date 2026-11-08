import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {getTableColumns} from 'drizzle-orm';
process.env.DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:5432/fixture';
process.env.SUPABASE_URL='https://auditfixture.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';
const {pool}=await import('../db/index.ts');
const {users,swineRecords}=await import('../db/schema.ts');
const {supabaseAuthClient}=await import('../lib/supabaseServer.ts');
const userId='00000000-0000-4000-8000-000000000001';
let role='admin',active=true,barangay='Ambacon', publicDatabaseError=false;
const queries:Array<{text:string;params:any[]}>=[];
const positional=(table:any,row:any)=>Object.keys(getTableColumns(table)).map(key=>row[key]??null);
const oldQuery=pool.query;
(pool as any).query=async(config:any,params:any[]=[])=>{
 const text=typeof config==='string'?config:config.text;queries.push({text,params});
 if(text.includes('AS farmers,') && publicDatabaseError)throw new Error('private connection details');
 if(text.includes('AS farmers,'))return {rows:[{farmers:0,barangays:[],audits:[]}]};
 if(text.includes('from "users"'))return {rows:[positional(users,{id:userId,uid:'fixture',email:'fixture@example.invalid',name:'Fixture',role,authUserId:userId,active,isActive:active,status:active?'active':'inactive',assignedBarangay:barangay,permissions:[]})]};
 if(text.includes('from "system_settings"'))return {rows:[]};
 if(text.includes('from "swine_records"'))return {rows:text.includes('count(*)')?[[0]]:[]};
 throw new Error('Unexpected fixture database query: '+text);
};
const oldGetUser=supabaseAuthClient!.auth.getUser;
supabaseAuthClient!.auth.getUser=async()=>({data:{user:{id:userId} as any},error:null});
const {createApp}=await import('./app.ts');
const assistantRequests:any[]=[];
let assistantReplies:any[]=[];
const server=createApp({assistantGenerate:async input=>{assistantRequests.push(input);const reply=assistantReplies.shift();if(reply instanceof Error)throw reply;return reply || {text:'A pig is a domesticated mammal raised for meat and breeding.'};}}).listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const request=(path:string,method='GET',body?:any)=>fetch(base+path,{method,headers:{Authorization:'Bearer isolated-fixture','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));pool.query=oldQuery;supabaseAuthClient!.auth.getUser=oldGetUser;await pool.end();});

test('four role profiles authorize scoped reads through the real middleware',async()=>{
 for(role of ['super_admin','admin','focal','agent']){
  const response=await request('/api/dashboard/stats');assert.equal(response.status,200,role);
  const data=await response.json();assert.equal(data.data.totalSwine,0);
  const query=queries.filter(q=>q.text.includes('from "swine_records"')&&!q.text.includes('count(*)')).at(-1)!;
  if(role==='focal')assert.ok(query.params.includes('Ambacon'));
  if(role==='agent')assert.ok(query.params.includes(true));
 }
});
test('agent writes and focal administrative and cross-barangay operations are denied',async()=>{
 role='admin';assert.equal((await request('/api/settings','PUT',{key:'api_configuration',value:{}})).status,403);
 assert.equal((await request('/api/swine-records/record','DELETE')).status,403,'admin needs an explicit permanent-delete grant');
 role='agent';
 for(const [path,method,body] of [['/api/swine-records','POST',{}],['/api/swine-records/record','PUT',{}],['/api/swine-records/record','DELETE',undefined],['/api/swine-records/import','POST',{records:[{}]}],['/api/messages','POST',{body:'Unauthorized broadcast'}]] as const){
  assert.equal((await request(path,method,body)).status,403,`${method} ${path}`);
 }
 assert.equal((await request('/api/swine-records/record/archive','PATCH',{isArchived:true})).status,403,'agent archive');
 role='focal';
 assert.equal((await request('/api/swine-records?barangay=Bugho')).status,403);
 assert.equal((await request('/api/barangays','POST',{})).status,403);
 assert.equal((await request('/api/messages','POST',{body:'Broadcast',targetBarangay:'all'})).status,403);
 barangay='';assert.equal((await request('/api/dashboard/stats')).status,403);barangay='Ambacon';
});
test('inactive profiles and unknown roles cannot enter protected endpoints',async()=>{
 role='admin';active=false;assert.equal((await request('/api/auth/profile')).status,403);active=true;
 role='unexpected-role';assert.equal((await request('/api/auth/profile')).status,403);
});

test('import preserves role restrictions and rejects excessive or unsafe batches before persistence',async()=>{
 role='focal';
 const record={farmerName:'Fixture Farmer',barangay:'Ambacon'};
 assert.equal((await request('/api/swine-records/import','POST',{records:[record],batchId:'fixture-import',newFields:[{fieldKey:'color',label:'Color',type:'text'}]})).status,403);
 assert.equal((await request('/api/swine-records/import','POST',{records:[{...record,barangay:'Bugho'}],batchId:'fixture-import'})).status,403);
 role='admin';
 assert.equal((await request('/api/swine-records/import','POST',{records:Array(101).fill(record),batchId:'fixture-import'})).status,400);
 assert.equal((await request('/api/swine-records/import','POST',{records:[record]})).status,400);
 assert.equal((await request('/api/swine-records/import','POST',{records:[record],batchId:'fixture-import',newFields:[{fieldKey:'constructor',label:'Unsafe',type:'text'}]})).status,400);
});

test('master configuration remains Super Admin-only with JSON denials',async()=>{
 for(role of ['admin','focal','agent']) {
  const response=await request('/api/config/master');assert.equal(response.status,403);assert.match(response.headers.get('content-type')||'',/application\/json/);assert.deepEqual(await response.json(),{success:false,error:'Super administrator access required.'});
 }
 role='super_admin';const response=await request('/api/config/master');assert.equal(response.status,200);assert.equal((await response.json()).success,true);
});

test('assistant APIs use verified roles, read scoped live counts and handle failures',async()=>{
 active=true;
 for(role of ['super_admin','admin','focal','agent']){
  barangay='Ambacon';
  assistantReplies=[{functionCalls:[{name:'query_registry',args:{period:'today'}}]},{text:'0 new records today in your authorized scope.'}];
  const response=await request('/api/assistant/chat','POST',{message:'How many new records today?',language:'ceb',role:'super_admin',barangay:'Canipaan',history:[{role:'user',content:'Hello'}]});
  assert.equal(response.status,200,role);const body=await response.json();assert.match(body.reply,/0/);assert.equal(body.source,'database');assert.equal(response.headers.get('cache-control'),'no-store');
  const query=queries.filter(item=>item.text.includes('from "swine_records"')&&!item.text.includes('count(*)')).at(-1)!;
  if(role==='focal')assert.ok(query.params.includes('Ambacon'));
  if(role==='agent')assert.ok(query.params.includes(true));
  assert.equal(assistantRequests.length,0);
 }
 role='focal';
 let denied=await request('/api/assistant/chat','POST',{message:'How many swine are registered in Canipaan?',role:'super_admin',barangay:'Canipaan'});assert.equal(denied.status,403);
 role='agent';
 denied=await request('/api/assistant/chat','POST',{message:'How many farmers are registered?',role:'admin'});assert.equal(denied.status,403);
 role='admin';
 assistantReplies=[new Error('provider offline')];
 let response=await request('/api/assistant/chat','POST',{message:'What is a pig?'});assert.equal(response.status,503);assert.doesNotMatch((await response.json()).error,/provider offline/);
 assistantReplies=[{text:'What is a pig?'}];
 response=await request('/api/assistant/chat','POST',{message:'What is a pig?'});assert.equal(response.status,503);
 assistantReplies=[{functionCalls:[{name:'query_registry',args:{period:'today'}}]},{text:'Sign in to access private registry statistics.'}];
 const before=queries.length;
 response=await fetch(base+'/api/public/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'How many new records today?',role:'super_admin'})});
 assert.equal(response.status,200);assert.match((await response.json()).reply,/Sign in/);assert.equal(queries.length,before+1);assert.ok(queries.at(-1)!.text.includes('AS farmers,'));
});

 test('public registry endpoint exposes only read-only aggregates without authentication',async()=>{
 const response=await fetch(base+'/api/public/registry-summary');
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.deepEqual(await response.json(),{coveredBarangays:0,registeredFarmers:0,activeSwine:0,readyToSell:0,assessedBarangays:0,compliancePercent:null,barangays:[]});
 const directory=await fetch(base+'/api/barangays');assert.equal(directory.status,200);assert.deepEqual(await directory.json(),{success:true,count:0,data:[]});
 const denied=await fetch(base+'/api/public/registry-summary',{method:'POST'});assert.equal(denied.status,401);
 });

test('public database failures are 503, never fabricated zero counts or private diagnostics',async()=>{
 publicDatabaseError=true;
 try { const response=await fetch(base+'/api/public/registry-summary');assert.equal(response.status,503);const body=await response.json();assert.equal(body.activeSwine,undefined);assert.equal(JSON.stringify(body).includes('private connection'),false); }
 finally {publicDatabaseError=false;}
});
