import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
process.env.DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:5432/fixture';
const {app}=await import('./app.ts');
const {pool}=await import('../db/index.ts');
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});
test('every inventoried protected API rejects anonymous requests and spoofed role headers',async()=>{
 const inventory=JSON.parse(readFileSync('docs/audit/system-inventory.json','utf8'));
 const publicGet=new Set(['/api/health','/api/landing-cms/published','/api/landing-config','/api/landing/settings','/api/legal-documents','/api/barangays']);
 const publicPost=new Set(['/api/auth/login','/api/auth/superadmin-login','/api/public/assistant/chat']);
 let count=0;
 for(const route of inventory.routes){
  if(!route.path.startsWith('/api/') || (route.method==='GET'&&publicGet.has(route.path)) || (route.method==='POST'&&publicPost.has(route.path)))continue;
  const path=route.path.replace(/:[\w]+/g,'fixture');
  const response=await fetch(base+path,{method:route.method,headers:{'x-user-role':'super_admin','Content-Type':'application/json'},...(['POST','PUT','PATCH'].includes(route.method)?{body:'{}'}:{})});
  assert.equal(response.status,401,`${route.method} ${path}`);count++;
 }
 assert.ok(count>0,'Inventory must contain protected routes.');
});
