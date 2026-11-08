import {test,expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';
const id='00000000-0000-4000-8000-000000000099';
const record={id,pigIdTag:'HIN-2026-0099',computedPigId:'HIN-2026-0099',earTagNo:'HIN-2026-0099',farmerName:'Isolated fixture farmer',barangay:'Ambacon',swineType:'piglet',status:'healthy',readyToSell:false,registeredAt:'2026-01-01',isArchived:false,isSynced:true};

test('dashboard, Records, GIS, Certificates and authorized nested portal restore their exact URL and module',async({page})=>{
 test.setTimeout(240000);await fixture(page,'super_admin');
 await page.addInitScript(()=>{(window as any).landingFlash=false;new MutationObserver(()=>{if(document.querySelector('.landing-hero'))(window as any).landingFlash=true;}).observe(document,{childList:true,subtree:true});});
 for(const [path,tab] of [['/dashboard?ui_graph=bar&ui_dimension=barangay','dashboard'],['/records?ui_barangay=Ambacon','records'],['/gis?ui_barangay=Ambacon','gis'],['/certificate?ui_reportCertTypeFilter=transport','certificate'],['/kamirani','dashboard'],['/kamirani/layout','layout_config']]) {
  await page.goto(path);await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);await expect(page.getByText('Loading module...',{exact:true})).toHaveCount(0,{timeout:30000});
  const before=page.url();await page.reload();await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);await expect(page.getByText('Loading module...',{exact:true})).toHaveCount(0,{timeout:30000});
  expect(page.url()).toBe(before);expect(await page.evaluate(()=>(window as any).landingFlash)).toBe(false);
 }
});

test('Records restores safe filters, pagination and only a freshly authorized record reference',async({page})=>{
 await fixture(page,'admin',{records:[record]});
 await page.goto(`/records?ui_barangay=Ambacon&ui_search=HIN-2026&ui_pageSize=10&ui_record=${id}`);
 await expect(page.getByRole('button',{name:'Close record details'})).toBeVisible();await page.reload();
 await expect(page.getByRole('button',{name:'Close record details'})).toBeVisible();
 await page.getByRole('button',{name:'Close record details'}).click();await expect(page).not.toHaveURL(/ui_record=/);
 await expect(page.getByPlaceholder('Search by Pig ID Tag or Farmer Name')).toHaveValue('HIN-2026');
 const stored=await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('da_ui_v1:')).map(k=>sessionStorage.getItem(k)).join(' '));expect(stored).not.toContain('Isolated fixture farmer');expect(stored).not.toContain('access_token');
 await page.goto('/records?ui_record=00000000-0000-4000-8000-000000000123');await expect(page.getByPlaceholder('Search by Pig ID Tag or Farmer Name')).toBeVisible();await expect(page.getByRole('button',{name:'Close record details'})).toHaveCount(0);
});

test('module failure offers recovery and retains route/search through a reload',async({page})=>{
 await fixture(page,'admin');let fail=true;
 await page.route(/(?:PigsRecords[^/]*\.js|\/src\/components\/records\/PigsRecords\.tsx)(?:\?.*)?$/,async route=>{if(fail)await route.abort('failed');else await route.continue();});
 await page.goto('/records?ui_barangay=Ambacon');await expect(page.getByRole('heading',{name:'This page could not be loaded'})).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Retry module',exact:true})).toBeVisible();fail=false;
 await page.getByRole('button',{name:'Reload current page',exact:true}).click();await expect(page.locator('main')).toHaveAttribute('data-page','records');
 await expect(page.getByPlaceholder('Search by Pig ID Tag or Farmer Name')).toBeVisible({timeout:30000});await expect(page).toHaveURL(/\/records\?ui_barangay=Ambacon/);
});

test('a stalled chunk stops spinning and can retry without a landing redirect',async({page})=>{
 await fixture(page,'admin');let stall=true;
 await page.route(/(?:PigsRecords[^/]*\.js|\/src\/components\/records\/PigsRecords\.tsx)(?:\?.*)?$/,async route=>{if(stall){stall=false;await new Promise(r=>setTimeout(r,25000));}await route.continue().catch(()=>{});});
 await page.goto('/records');await expect(page.getByRole('heading',{name:'This page could not be loaded'})).toBeVisible({timeout:30000});
 await expect(page.getByText('Loading module...',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Retry module',exact:true}).click();
 await expect(page.getByPlaceholder('Search by Pig ID Tag or Farmer Name')).toBeVisible({timeout:30000});await expect(page).toHaveURL(/\/records$/);
});

test('Back/Forward restores modules and an expired ordinary session opens login with its destination preserved',async({page})=>{
 await fixture(page,'admin');await page.goto('/records?ui_barangay=Ambacon');await expect(page.locator('.workspace-shell')).toBeVisible();
 if((page.viewportSize()?.width||1280)<1024)await page.getByRole('button',{name:'Toggle navigation menu'}).click();
 await page.getByRole('button',{name:'GIS Swine Map',exact:true}).filter({visible:true}).first().click();await expect(page).toHaveURL(/\/gis/);
 await page.goBack();await expect(page).toHaveURL(/\/records\?ui_barangay=Ambacon/);await expect(page.locator('main')).toHaveAttribute('data-page','records');
 await page.goForward();await expect(page.locator('main')).toHaveAttribute('data-page','gis');
 await page.route('**/api/auth/profile',route=>route.fulfill({status:401,json:{success:false,error:'Authentication required.'}}));
 await page.goto('/records?ui_barangay=Ambacon');await expect(page).toHaveURL(/\/login$/);await expect(page.getByText('Please sign in to return to your requested page.',{exact:false})).toBeVisible();
 await expect(page.locator('.workspace-shell')).toHaveCount(0);
});


test('Records retains a real second page and tag search after refresh',async({page})=>{
 const records=Array.from({length:30},(_,i)=>({...record,id:`00000000-0000-4000-8000-${(i+1).toString(16).padStart(12,'0')}`,farmerId:`00000000-0000-4000-8000-${(i+100).toString(16).padStart(12,'0')}`,farmerName:`Isolated farmer ${i+1}`,pigIdTag:`HIN-2026-${String(i+1).padStart(4,'0')}`}));
 await fixture(page,'admin',{records});await page.goto('/records?ui_page=2&ui_pageSize=10&ui_search=HIN-2026');
 const pager=page.getByText(/Page\s+2\s+of\s+3/).filter({visible:true}).first();await expect(pager).toBeVisible();await page.reload();await expect(pager).toBeVisible();
 await expect(page.getByPlaceholder('Search by Pig ID Tag or Farmer Name')).toHaveValue('HIN-2026');await expect(page).toHaveURL(/ui_page=2/);
});
