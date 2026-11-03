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
let role='admin',active=true,barangay='Ambacon';
const queries:Array<{text:string;params:any[]}>=[];
const positional=(table:any,row:any)=>Object.keys(getTableColumns(table)).map(key=>row[key]??null);
const oldQuery=pool.query;
(pool as any).query=async(config:any,params:any[]=[])=>{
 const text=typeof config==='string'?config:config.text;queries.push({text,params});
 if(text.includes('from "users"'))return {rows:[positional(users,{id:userId,uid:'fixture',email:'fixture@example.invalid',name:'Fixture',role,authUserId:userId,active,isActive:active,status:active?'active':'inactive',assignedBarangay:barangay,permissions:[]})]};
 if(text.includes('from "swine_records"'))return {rows:text.includes('count(*)')?[[0]]:[]};
 throw new Error('Unexpected fixture database query: '+text);
};
const oldGetUser=supabaseAuthClient!.auth.getUser;
supabaseAuthClient!.auth.getUser=async()=>({data:{user:{id:userId} as any},error:null});
const {createApp}=await import('./app.ts');
const server=createApp().listen(0,'127.0.0.1');await once(server,'listening');
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
 role='agent';
 for(const [path,method,body] of [['/api/swine-records','POST',{}],['/api/swine-records/record','PUT',{}],['/api/swine-records/record','DELETE',undefined],['/api/swine-records/import','POST',{records:[{}]}],['/api/messages','POST',{body:'Unauthorized broadcast'}]] as const){
  assert.equal((await request(path,method,body)).status,403,`${method} ${path}`);
 }
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
