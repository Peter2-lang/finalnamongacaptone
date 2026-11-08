import {isSuperAdminPath,isLegacySuperAdminPath,superAdminRouteRedirect,canAccessTab} from './appRoutes';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTabs,tabForPath,normalizePath} from './appRoutes';
test('every supported direct URL resolves before session restoration',()=>{
 for(const [path,tab] of Object.entries(routeTabs)){assert.equal(tabForPath(path),tab,path);assert.equal(tabForPath(path+'/'),tab,path);}
 assert.equal(tabForPath('/add_swine'),'add_swine');assert.equal(tabForPath('/kamirani/dashboard'),'dashboard');assert.equal(normalizePath('/GIS/'),'/gis');
});

test('every renderable application tab has a refreshable URL',()=>{
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 for(const match of source.matchAll(/activeTab === '([^']+)'/g))assert.equal(tabForPath('/'+match[1]),match[1],match[1]);
});

test('every role has explicit route permissions and denied tabs cannot fall through to the catalog',()=>{
 for(const tab of new Set(Object.values(routeTabs))){
  assert.equal(canAccessTab('super_admin',tab),true,tab);
  assert.equal(canAccessTab('guest',tab),false,tab);
 }
 assert.equal(canAccessTab('agent','records'),false);
 assert.equal(canAccessTab('agent','gis'),true);
 assert.equal(canAccessTab('focal','asf_ordinance'),false);
 assert.equal(canAccessTab('focal','form_customizer'),false);
 assert.equal(canAccessTab('admin','form_customizer'),true);
 assert.equal(canAccessTab('admin','api_config'),false);
});


test('legacy URLs are always public and new portal access requires the existing verified role',()=>{
 for(const role of ['super_admin','admin','focal','agent','guest','superadmin','',undefined]) {
  assert.equal(superAdminRouteRedirect('/superadmin',role),'/');
  assert.equal(superAdminRouteRedirect('/SUPERADMIN/layout/',role),'/');
  assert.equal(superAdminRouteRedirect('/kamirani',role),role==='super_admin'?null:'/');
  assert.equal(superAdminRouteRedirect('/kamirani/layout',role),role==='super_admin'?null:'/');
  assert.equal(superAdminRouteRedirect('/records',role),null);
 }
 for(const path of ['/kamirani','/kamirani/layout','/superadmin','/superadmin/layout'])assert.equal(isSuperAdminPath(path),true);
 for(const path of ['/kamiranix','/superadministrator','/records'])assert.equal(isSuperAdminPath(path),false);
 assert.equal(isLegacySuperAdminPath('/kamirani'),false);
});

test('Vercel redirects legacy portal documents to the homepage without changing API routing',()=>{
 const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(config.redirects,[{source:'/superadmin',destination:'/',permanent:false},{source:'/superadmin/:path*',destination:'/',permanent:false}]);
 const fallback=config.rewrites.find((rule:any)=>rule.destination==='/index.html');
 for(const path of ['/kamirani','/kamirani/system-appearance'])assert.match(path,new RegExp('^'+fallback.source+'$'));
 assert.ok(config.rewrites.some((r:any)=>r.source==='/api/(.*)'&&r.destination==='/api/index'));
});
