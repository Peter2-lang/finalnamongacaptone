import {test,expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';

for(const role of ['super_admin','admin','focal','agent'])test(`${role}: refresh waits for verified profile without landing flash and retains language`,async({page})=>{
 test.setTimeout(300000);
 await fixture(page,role);
 const routes=role==='super_admin'?['/kamirani/dashboard','/gis','/records','/add_swine','/kamirani/system-appearance']:role==='agent'?['/takeoff','/gis','/messages','/account']:['/dashboard','/records','/add_swine','/gis','/biosecurity','/messages','/account'];
 await page.addInitScript(()=>{
  localStorage.setItem('app_language','ceb');
  (window as any).landingFlashed=false;
  new MutationObserver(()=>{if(document.querySelector('.landing-hero'))(window as any).landingFlashed=true;}).observe(document,{subtree:true,childList:true});
 });
 // Delay verified profile: it must show a neutral loader, not public content.
 await page.route('**/api/auth/profile',async route=>{await new Promise(resolve=>setTimeout(resolve,300));await route.fallback();});
 for(const path of routes){
  await page.goto(path);await expect(page.locator('.workspace-shell')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(path.replaceAll('/','\\/')+'$'));
  expect(await page.evaluate(()=>(window as any).landingFlashed)).toBe(false);
  await page.reload();await expect(page.locator('.workspace-shell')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(path.replaceAll('/','\\/')+'$'));
  expect(await page.evaluate(()=>(window as any).landingFlashed)).toBe(false);
  await expect(page.locator('html')).toHaveAttribute('lang','ceb');
 }
});

test('language switch updates open import modal and keeps registration inputs and route',async({page})=>{
 await fixture(page,'admin');await page.goto('/records');
 await page.getByText('More actions',{exact:false}).first().click();
 await page.getByRole('button',{name:'Import JSON / Records File'}).click();
 const selector=page.locator('header select').first();
 // Header remains mounted while a modal is open; use the native select event.
 for(const [language,label] of [['ceb','Kanselahon'],['fil','Kanselahin'],['en','Cancel']]){
  await selector.selectOption(language,{force:true});
  await expect(page.getByRole('button',{name:label,exact:true}).last()).toBeVisible();
  await expect(page).toHaveURL(/\/records$/);
 }
 await page.getByRole('button',{name:'Cancel',exact:true}).last().click();
 await page.goto('/add_swine');await expect(page.locator('.workspace-shell')).toBeVisible();
 const input=page.locator('#registry-fld_farmer_name');
 await input.fill('Retained input');
 await page.locator('header select').first().selectOption('ceb');
 await expect(input).toHaveValue('Retained input');
 await page.reload();await expect(page.locator('.workspace-shell')).toBeVisible();await expect(page.locator('html')).toHaveAttribute('lang','ceb');await expect(page).toHaveURL(/\/add_swine$/);
});

test('chat sends history and language once, clears conversation and handles failed providers',async({page})=>{
 await fixture(page,'admin');const payloads:any[]=[];let fail=false;
 await page.route('**/api/assistant/chat',async route=>{
  payloads.push(route.request().postDataJSON());await route.fulfill({status:fail?503:200,json:fail?{success:false,error:'The AI assistant is temporarily unavailable.'}:{success:true,reply:payloads.length===1?'A pig is a domesticated mammal raised for meat and breeding.':'Adunay 0 ka bag-ong rekord karong adlawa.'}});
 });
 await page.goto('/records');await page.getByRole('button',{name:'Open Biosecurity Assistant',exact:true}).click();
 const input=page.locator('aside textarea').last();await input.fill('What is a pig?');await input.press('Enter');
 await expect(page.getByText('A pig is a domesticated mammal raised for meat and breeding.',{exact:true})).toBeVisible();
 expect(payloads).toHaveLength(1);expect(payloads[0].language).toBe('en');
 await page.locator('header select').first().selectOption('ceb',{force:true});
 await input.fill('Explain in Bisaya.');await input.press('Enter');
 await expect.poll(()=>payloads.length).toBe(2);expect(payloads[1].language).toBe('ceb');expect(payloads[1].history.some((turn:any)=>turn.content==='What is a pig?')).toBe(true);
 await page.reload();
 await page.getByRole('button',{name:'Ablihi ang Biosecurity Assistant',exact:true}).click();
 await expect(page.getByText('What is a pig?',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Bag-ong Panag-istorya / Hawani'}).click();await expect(page.getByText('What is a pig?',{exact:true})).toHaveCount(0);
 fail=true;await input.fill('How many new records today?');await input.press('Enter');
 await expect(page.getByText('The AI assistant is temporarily unavailable.',{exact:true})).toBeVisible();await expect(input).toBeEnabled();
});

test('temporary profile failure keeps the route and token behind a neutral retry screen',async({page})=>{
 await fixture(page,'admin');let unavailable=true;
 await page.route('**/api/auth/profile',async route=>unavailable?route.fulfill({status:503,json:{success:false,error:'Database unavailable'}}):route.fallback());
 await page.goto('/records');
 await expect(page.getByText('Session verification is temporarily unavailable. Please retry.',{exact:false})).toBeVisible();
 await expect(page.locator('.landing-hero')).toHaveCount(0);await expect(page.locator('.workspace-shell')).toHaveCount(0);await expect(page).toHaveURL(/\/records$/);
 expect(await page.evaluate(()=>Boolean(localStorage.getItem('sb-auditfixture-auth-token')))).toBe(true);
 unavailable=false;await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.locator('.workspace-shell')).toBeVisible();await expect(page).toHaveURL(/\/records$/);
});
