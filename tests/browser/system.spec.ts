import {readdirSync} from 'node:fs';
import {test,expect,type Page} from '@playwright/test';
import {DEFAULT_MASTER_CONFIG} from '../../src/data/defaultMasterConfig';
import {INITIAL_LANDING_CMS_CONFIG} from '../../src/data/initialLandingCmsData';
const userId='00000000-0000-4000-8000-000000000001';
const jwt=(value:object)=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function fixture(page:Page,role:string,state:{records:any[]}={records:[]}){
 const profile={id:userId,authUserId:userId,username:'audit',email:'audit@example.invalid',name:'Audit fixture',role,assignedBarangay:'Ambacon',active:true,isActive:true,status:'active',permissions:[]};
 const authUser={id:userId,email:profile.email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const token=`${jwt({alg:'HS256',typ:'JWT'})}.${jwt({sub:userId,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})}.fixture`;
 await page.route('https://auditfixture.supabase.co/**',route=>route.fulfill({json:route.request().url().includes('/auth/v1/user')?authUser:{data:[],user:authUser}}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let data:any=[];
  if(path==='/api/swine-records')data=state.records;
  else if(path==='/api/auth/profile'||path==='/api/auth/superadmin-profile')data=profile;
  else if(path==='/api/config/master')data={published:DEFAULT_MASTER_CONFIG,draft:DEFAULT_MASTER_CONFIG};
  else if(path.includes('registry-schema'))data={version:1,sections:[]};
  else if(path==='/api/landing-cms/published'||path.includes('landing-cms/draft'))data=INITIAL_LANDING_CMS_CONFIG;
  else if(path.includes('landing-config')||path.includes('landing/settings'))data={};
  else if(path==='/api/health')return route.fulfill({json:{service:'hinunangan-swine-registry',status:'healthy',database:'connected',schema:'ready',cloud:'online',authentication:'available'}});
  else if(path==='/api/sync/pull')data={swineRecords:[],certificates:[],messages:[]};
  else if(path.startsWith('/api/settings'))data={};
  await route.fulfill({json:{success:true,data,total:0,count:0,schema:path.includes('registry-schema')?{version:1,sections:[]}:undefined,config:path.includes('landing')?INITIAL_LANDING_CMS_CONFIG:undefined,theme:path.includes('sidebar-theme')?{}:undefined}});
 });
 await page.addInitScript(({token,authUser})=>localStorage.setItem('sb-auditfixture-auth-token',JSON.stringify({access_token:token,refresh_token:'isolated-fixture',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:authUser})),{token,authUser});
}
for(const role of ['super_admin','admin','focal','agent']){
 test(`${role}: restore session and render authorized main navigation`,async({page})=>{
  await fixture(page,role);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/dashboard');
  if ((page.viewportSize()?.width || 1280) < 1024) await page.getByRole('button',{name:'Toggle navigation menu'}).click();
  await expect(page.getByText('Audit fixture',{exact:true}).filter({visible:true}).first()).toBeVisible();
  if ((page.viewportSize()?.width || 1280) < 1024) await page.getByRole('button',{name:'Close sidebar drawer'}).click();
  const routes=['/gis','/records','/certificate','/takeoff','/messages','/account'];
  if(role!=='agent')routes.push('/biosecurity');
  if(role==='admin'||role==='super_admin')routes.push('/asf-ordinance','/barangays','/admin/registry-form-customization','/admin/user-accounts');
  if(role==='super_admin')routes.push('/superadmin/landing-page-cms','/superadmin/sidebar-configuration','/superadmin/api-configuration','/superadmin/database-configuration','/superadmin/system-appearance');
  for(const route of routes){
   await page.goto(route);
   if ((page.viewportSize()?.width || 1280) < 1024) await page.getByRole('button',{name:'Toggle navigation menu'}).click();
  await expect(page.getByText('Audit fixture',{exact:true}).filter({visible:true}).first()).toBeVisible();
  if ((page.viewportSize()?.width || 1280) < 1024) await page.getByRole('button',{name:'Close sidebar drawer'}).click();
   await expect(page.getByText('Something went wrong',{exact:false})).toHaveCount(0);
  }
  expect(errors).toEqual([]);
 });
}
test('anonymous deep-link cannot open administrative controls',async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({json:{success:true,data:[]}}));
 await page.goto('/admin/user-accounts');
 await expect(page.getByText('Create Account',{exact:true})).toHaveCount(0);
});
test('all frontend modules evaluate in a browser',async({page})=>{
 test.skip(process.env.PLAYWRIGHT_PRODUCTION==='1','Source-module import coverage is development-only; production routes run above.');
 await fixture(page,'super_admin');await page.goto('/dashboard');
 await expect(page.getByRole('button',{name:'Sign out',exact:true}).first()).toBeVisible();
 await page.waitForLoadState('networkidle');
 const paths=readdirSync('src/components',{recursive:true}).filter(name=>String(name).endsWith('.tsx')).map(name=>`/src/components/${name}`);
 const failures=await page.evaluate(async(paths)=>{
  const failures:string[]=[];
  for(const name of paths)try{await import(/* @vite-ignore */ name);}catch(error){failures.push(`${name}: ${error}`);}
  return failures;
 },paths);
 expect(failures).toEqual([]);
});

test('GIS normal clicks and refresh keep the application in GIS',async({page})=>{
 // Empty-map clicks must not accidentally exercise a marker popup's explicit View action.
 const state:{records:any[]}={records:[]};
 await fixture(page,'admin',state);await page.goto('/gis');
 const map=page.locator('.leaflet-container');await expect(map).toBeVisible();
 const close=page.getByRole('button',{name:'Close map legend'});if(await close.isVisible())await close.click();
 for(let n=0;n<20;n++)await map.click({position:{x:150+n,y:220},force:true});
 await expect(page.getByRole('heading',{name:'Hinunangan Municipal GIS Biosurveillance & Swine Map',exact:true})).toBeVisible();
 state.records.push({id:'fixture-pig',pigIdTag:'HIN-2026-0001',farmerName:'Fixture Farmer',barangay:'Ambacon',latitude:10.39,longitude:125.195,swineType:'piglet',gender:'female',status:'active',registeredAt:'2026-01-01',readyToSell:true});
 await page.reload();await expect(map).toBeVisible();
 await page.waitForLoadState('networkidle');
 const info=page.getByRole('button',{name:'Close barangay information'});if(await info.isVisible())await info.click();
 await page.getByRole('button',{name:'Reset View',exact:true}).click();
 await page.locator('.swine-map-marker').click();await expect(page.locator('.leaflet-popup')).toContainText('HIN-2026-0001');
 await expect(map).toBeVisible();await page.reload();await expect(map).toBeVisible();
});

test('dashboard counters follow populated and empty API snapshots after refresh',async({page})=>{
 const state:{records:any[]}={records:[]};await fixture(page,'admin',state);await page.goto('/dashboard');
 const counter=()=>page.getByText('Registered Swine',{exact:true}).locator('../..').locator('.text-3xl');
 await expect(counter()).toHaveText('0');
 state.records.push({id:'fixture-record',pigIdTag:'HIN-2026-0001',farmerName:'Fixture Farmer',barangay:'Ambacon',swineType:'piglet',status:'active',readyToSell:false,registeredAt:'2026-01-01',latitude:10.4015,longitude:125.195});
 await page.reload();await expect(counter()).toHaveText('1');
 state.records[0].readyToSell=true;await page.reload();await expect(counter()).toHaveText('1');
 state.records.length=0;await page.reload();await expect(counter()).toHaveText('0');
});
