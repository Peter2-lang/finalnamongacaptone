import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routeTabs,tabForPath,normalizePath} from './appRoutes';
test('every supported direct URL resolves before session restoration',()=>{
 for(const [path,tab] of Object.entries(routeTabs)){assert.equal(tabForPath(path),tab,path);assert.equal(tabForPath(path+'/'),tab,path);}
 assert.equal(tabForPath('/add_swine'),'add_swine');assert.equal(tabForPath('/superadmin/dashboard'),'dashboard');assert.equal(normalizePath('/GIS/'),'/gis');
});

test('every renderable application tab has a refreshable URL',()=>{
 const source=readFileSync(new URL('../App.tsx',import.meta.url),'utf8');
 for(const match of source.matchAll(/activeTab === '([^']+)'/g))assert.equal(tabForPath('/'+match[1]),match[1],match[1]);
});
