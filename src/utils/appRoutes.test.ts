import {isSuperAdminPath,isLegacySuperAdminPath,legacySuperAdminRedirect,canAccessTab} from './appRoutes';
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


test('legacy Super Admin URLs redirect only for the unchanged verified role',()=>{
 for(const role of ['admin','focal','agent','guest','superadmin','',undefined]) {
  assert.equal(legacySuperAdminRedirect('/superadmin',role),null);
  assert.equal(legacySuperAdminRedirect('/superadmin/layout',role),null);
 }
 assert.equal(legacySuperAdminRedirect('/superadmin','super_admin'),'/kamirani');
 assert.equal(legacySuperAdminRedirect('/SUPERADMIN/typography/','super_admin'),'/kamirani/typography');
 assert.equal(tabForPath('/superadmin/layout'),'layout_config');
 for(const path of ['/kamirani','/kamirani/layout','/superadmin','/superadmin/layout'])assert.equal(isSuperAdminPath(path),true);
 for(const path of ['/kamiranix','/superadministrator','/records'])assert.equal(isSuperAdminPath(path),false);
 assert.equal(isLegacySuperAdminPath('/kamirani'),false);
 assert.equal(legacySuperAdminRedirect('/records','super_admin'),null);
});

test('Vercel SPA fallback serves the renamed portal without an unconditional legacy redirect',()=>{
 const config=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url),'utf8'));
 const fallback=config.rewrites.find((rule:any)=>rule.destination==='/index.html');
 for(const path of ['/kamirani','/kamirani/system-appearance','/superadmin'])assert.match(path,new RegExp('^'+fallback.source+'$'));
 assert.equal(config.redirects?.some((rule:any)=>rule.source.startsWith('/superadmin'))||false,false);
});
