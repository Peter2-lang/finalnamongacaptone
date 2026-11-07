import {test,expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';
import {routeTabs,canAccessTab} from '../../src/utils/appRoutes';

// Every URL alias is exercised with a fresh, verified session on reload. Shared
// browser context caches source assets but never bypasses the auth/profile API.
for(const role of ['super_admin','admin','focal','agent'])test(`${role}: every authorized route survives refresh`,async({page},info)=>{
 test.skip(info.project.name==='mobile','The full URL matrix runs on desktop; core mobile route flows have separate coverage.');
 test.setTimeout(1200000);
 await fixture(page,role);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  localStorage.setItem('app_language','fil');
  (window as any).landingFlashed=false;
  new MutationObserver(()=>{if(document.querySelector('.public-shell .landing-hero'))(window as any).landingFlashed=true;}).observe(document,{childList:true,subtree:true});
 });
 for(const [path,tab] of Object.entries(routeTabs)){
  if(!canAccessTab(role,tab)||(path.startsWith('/superadmin')&&role!=='super_admin'))continue;
  await test.step(path,async()=>{
   await page.goto(path);await expect(page.locator('.workspace-shell')).toBeVisible();
   await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);
   await page.reload();await expect(page.locator('.workspace-shell')).toBeVisible();
   await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);
   await expect(page).toHaveURL(new RegExp(path.replaceAll('/','\\/')+'$'));
   expect(await page.evaluate(()=>(window as any).landingFlashed)).toBe(false);
   await expect(page.locator('html')).toHaveAttribute('lang','fil');
   await expect(page.locator('[data-access-denied]')).toHaveCount(0);
  });
 }
 expect(errors).toEqual([]);
});

test('Back and Forward keep the URL, rendered page and session aligned',async({page})=>{
 await fixture(page,'admin');await page.goto('/records');await expect(page.locator('main')).toHaveAttribute('data-page','records');
 if((page.viewportSize()?.width || 1280)<1024)await page.getByRole('button',{name:'Toggle navigation menu'}).click();
 await page.getByRole('button',{name:'GIS Swine Map',exact:true}).filter({visible:true}).first().click();
 await expect(page).toHaveURL(/\/gis$/);await expect(page.locator('main')).toHaveAttribute('data-page','gis');
 await page.goBack();await expect(page).toHaveURL(/\/records$/);await expect(page.locator('main')).toHaveAttribute('data-page','records');
 await page.goForward();await expect(page).toHaveURL(/\/gis$/);await expect(page.locator('main')).toHaveAttribute('data-page','gis');
});

test('denied direct routes cannot silently fall through to another feature',async({page})=>{
 await fixture(page,'agent');await page.goto('/records');
 await expect(page.getByRole('heading',{name:'Access Denied',exact:true})).toBeVisible();await expect(page).toHaveURL(/\/records$/);
});

test('an authenticated login deep link closes login and opens the correct role dashboard',async({page})=>{
 await fixture(page,'admin');await page.goto('/login');await expect(page).toHaveURL(/\/dashboard$/);await expect(page.locator('.workspace-shell')).toBeVisible();
});

test('a late profile response cannot restore a signed-out identity',async({page})=>{
 await fixture(page,'admin');let profileRequested=false;
 await page.route('**/api/auth/profile',async route=>{profileRequested=true;await new Promise(resolve=>setTimeout(resolve,700));await route.fallback();});
 await page.goto('/records');await expect.poll(()=>profileRequested).toBe(true);
 await page.evaluate(async()=>{const modulePath='/src/lib/supabase.ts';const {supabase}=await import(/* @vite-ignore */ modulePath);await supabase.auth.signOut();});
 await expect(page).toHaveURL(/\/login$/);await expect(page.locator('.workspace-shell')).toHaveCount(0);
 await page.waitForTimeout(1000);await expect(page.locator('.workspace-shell')).toHaveCount(0);
});
