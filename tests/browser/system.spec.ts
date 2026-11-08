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
  else if(path==='/api/sync/pull')data={swineRecords:state.records,certificates:[],messages:[]};
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
  if(role==='super_admin')routes.push('/kamirani/landing-page-cms','/kamirani/sidebar-configuration','/kamirani/api-configuration','/kamirani/database-configuration','/kamirani/system-appearance');
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
 const scrollBeforeMarker=await page.locator('main').evaluate(node=>node.scrollTop);
 await page.locator('.swine-map-marker > div').first().click();await expect(page.locator('.leaflet-popup')).toContainText('HIN-2026-0001');
 expect(await page.locator('main').evaluate(node=>node.scrollTop)).toBe(scrollBeforeMarker);
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

test('page finder opens records with keyboard and handles no results', async ({page}) => {
 await fixture(page, 'admin');
 await page.goto('/dashboard');
 if ((page.viewportSize()?.width || 1280) < 1024) await page.getByRole('button', {name: 'Toggle navigation menu'}).click();
 const finder = page.getByRole('searchbox', {name: 'Find a page'}).filter({visible: true});
 await finder.fill('no-such-page');
 await expect(page.getByRole('status').filter({hasText: 'No matching pages'})).toBeVisible();
 await finder.fill('records');
 await finder.press('Enter');
 await expect(page).toHaveURL(/\/records$/);
});

test('imported custom columns refresh analytics, persist, filter, edit and export',async({page},info)=>{
 test.skip(info.project.name==='mobile','The import wizard and GIS touch flows have separate mobile coverage.');
 const state:{records:any[]}={records:[]};await fixture(page,'admin',state);
 let schema:any={version:1,sections:[{id:'sec_imported',title:'Imported attributes',visible:true,fields:[]}]};
 let edits=0;
 await page.route('**/api/registry-schema',route=>route.fulfill({json:{success:true,schema,data:schema}}));
 await page.route('**/api/swine-records/import',async route=>{
  const body=route.request().postDataJSON();schema.sections[0].fields=body.newFields;
  state.records=body.records.map((record:any)=>({...record,id:'00000000-0000-4000-8000-000000000099',pigIdTag:'HIN-2026-0099',earTagNo:'HIN-2026-0099',isSynced:true}));
  await route.fulfill({json:{success:true,data:state.records,schema,newFieldsCreated:body.newFields.map((field:any)=>field.fieldKey),failures:[],skipped:[]}});
 });
 await page.route(/\/api\/swine(?:-records)?\/00000000-0000-4000-8000-000000000099$/,async route=>{
  if(route.request().method()==='PUT'){
   state.records[0]={...state.records[0],...route.request().postDataJSON()};edits++;
  }
  await route.fulfill({json:{success:true,data:state.records[0]}});
 });
 await page.goto('/records');
 await page.getByText('More actions',{exact:false}).first().click();
 await page.getByRole('button',{name:'Import JSON / Records File'}).click();
 await page.locator('input[type="file"]').setInputFiles({name:'custom.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{farmer_name:'Isolated Import Farmer',barangay:'Ambacon',swine_type:'Grower',weight:65,age_months:5,latitude:10.4018,longitude:125.1845,feeding_type:'Mixed Feeds',ready_to_sell:true}]))});
 await page.getByRole('button',{name:'Proceed to Data Validation'}).click();
 await page.getByRole('button',{name:'Create Custom Fields & Import'}).click();
 await expect(page.getByRole('heading',{name:'Import Results'})).toBeVisible();
 await page.getByRole('button',{name:'Done & View Records'}).click();
 await expect(page.getByText('Mixed Feeds',{exact:true}).filter({visible:true}).first()).toBeVisible();
 await page.getByText('Advanced filters',{exact:false}).first().click();
 await page.getByRole('searchbox',{name:'Filter Feeding Type'}).fill('missing');
 await expect(page.getByText('Mixed Feeds',{exact:true}).filter({visible:true})).toHaveCount(0);
 await page.getByRole('searchbox',{name:'Filter Feeding Type'}).fill('Mixed');
 await expect(page.getByText('Mixed Feeds',{exact:true}).filter({visible:true}).first()).toBeVisible();
 await page.reload();
 await expect(page.getByText('Mixed Feeds',{exact:true}).filter({visible:true}).first()).toBeVisible();
 await page.getByRole('combobox',{name:'Actions for HIN-2026-0099',exact:true}).filter({visible:true}).first().selectOption('view');
 await expect(page.getByRole('button',{name:'Edit Record',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit Record',exact:true}).click();
 await page.locator('input[value="Mixed Feeds"]').fill('Commercial Feeds');
 await page.getByRole('button',{name:'Update Swine Record',exact:true}).click();
 await expect.poll(()=>edits).toBe(1);
 expect(state.records[0].customFields.feeding_type).toBe('Commercial Feeds');
 await page.goto('/records');
 await page.getByText('More actions',{exact:false}).first().click();
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export Excel (.CSV)',exact:true}).click();
 const download=await downloadPromise;const filePath=(await download.path())!;
 const fs=await import('node:fs');const exported=fs.readFileSync(filePath,'utf8');
 expect(exported).toContain('Feeding Type');expect(exported).toContain('Commercial Feeds');
 await page.getByRole('button',{name:'Dashboard',exact:true}).filter({visible:true}).first().click();
 await expect(page.getByText('Registered Swine',{exact:true}).locator('../..').locator('.text-3xl')).toHaveText('1');
 await page.goto('/gis');
 await expect(page.locator('.swine-map-marker')).toHaveCount(1);
});
