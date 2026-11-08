import {test,expect,type Page} from '@playwright/test';
import {fixture} from './support/sessionFixture';
const project=process.env.PLAYWRIGHT_SUPABASE_PROJECT||'auditfixture';
const sessionKey=`sb-${project}-auth-token`;
async function gateway(page:Page) {
 await expect(page).toHaveURL(/\/kamirani$/);
 await expect(page.getByRole('heading',{name:'Super Administrator Gateway'})).toBeVisible();
 await expect(page.locator('.workspace-shell')).toHaveCount(0);
}

async function loginFixture(page:Page,role:string) {
 await fixture(page,role);
 await page.addInitScript(key=>localStorage.removeItem(key),sessionKey);
 const id='00000000-0000-4000-8000-000000000001';
 const user={id,email:'audit@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const enc=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})}.fixture`;
 await page.route(`https://${project}.supabase.co/auth/v1/token**`,route=>route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user}}));
 await page.route('**/api/auth/login',route=>route.fulfill({json:{success:true,role,token,refreshToken:'fixture-refresh',user:{id,authUserId:id,email:user.email,name:'Audit fixture',username:'audit',role,active:true,isActive:true,status:'active',permissions:[]}}}));
}

test('dedicated login verifies the server profile before opening dashboard and survives refresh',async({page})=>{
 await loginFixture(page,'super_admin');let requested=false;let release!:()=>void;
 const allowed=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/auth/superadmin-profile',async route=>{requested=true;expect(route.request().headers().authorization).toMatch(/^Bearer /);await allowed;await route.fallback();});
 await page.goto('/kamirani');await gateway(page);
 await page.locator('input[type="email"]').fill('audit@example.invalid');await page.locator('input[type="password"]').fill('isolated-fixture-password');
 await page.getByRole('button',{name:'Authorize Super Admin Session'}).click();await expect.poll(()=>requested).toBe(true);
 await expect(page.locator('.workspace-shell')).toHaveCount(0);release();
 await expect(page.locator('main')).toHaveAttribute('data-page','dashboard');await expect(page).toHaveURL(/\/kamirani$/);
 // Keep the SDK-created session for this refresh, rather than clearing it in the test setup.
 await page.evaluate(()=>{(window as any).__savedSession=localStorage.getItem(Object.keys(localStorage).find(k=>/^sb-.*-auth-token$/.test(k))||'');});
 const saved=await page.evaluate(()=>(window as any).__savedSession);
 await page.addInitScript(({sessionKey,saved})=>localStorage.setItem(sessionKey,saved),{sessionKey,saved});
 await page.reload();await expect(page.locator('main')).toHaveAttribute('data-page','dashboard');await expect(page).toHaveURL(/\/kamirani$/);
});

test('rejected Super Admin profile stays at login and return button opens public homepage',async({page})=>{
 await loginFixture(page,'admin');
 await page.route('**/api/auth/superadmin-profile',route=>route.fulfill({status:403,json:{success:false,error:'This account does not have Super Administrator privileges.'}}));
 await page.goto('/kamirani');await gateway(page);
 await page.locator('input[type="email"]').fill('audit@example.invalid');await page.locator('input[type="password"]').fill('isolated-fixture-password');
 await page.getByRole('button',{name:'Authorize Super Admin Session'}).click();
 await expect(page.getByText('This account does not have Super Administrator privileges.',{exact:true})).toBeVisible();await gateway(page);
 await page.getByRole('button',{name:'Return to Public Portal'}).click();await publicHome(page);
});

for(const role of ['admin','focal','agent'])test(`public Official Login preserves ${role} destination`,async({page})=>{
 await loginFixture(page,role);await page.goto('/');await publicHome(page);
 await page.locator('header').getByRole('button',{name:'Official Login',exact:true}).click();
 await page.locator('input[type="text"]').last().fill('audit@example.invalid');await page.locator('input[type="password"]').fill('isolated-fixture-password');
 await page.locator('button[type="submit"]').click();await expect(page.locator('.workspace-shell')).toBeVisible();await expect(page).toHaveURL(role==='agent'?/\/ready_to_sell$/:/\/dashboard$/);
});

async function publicHome(page:Page) {
 await expect(page).toHaveURL(/\/$/);await expect(page.locator('.public-shell .landing-hero')).toBeVisible();
 await expect(page.locator('header')).toBeVisible();await expect(page.locator('footer').last()).toBeAttached();
 await expect(page.locator('[data-access-denied]')).toHaveCount(0);await expect(page.locator('.workspace-shell')).toHaveCount(0);
 await expect(page.getByText('Super Administrator Portal',{exact:false})).toHaveCount(0);
 await expect(page.getByText('/kamirani',{exact:false})).toHaveCount(0);
}

for(const role of ['admin','focal','agent'])test(`${role} goes to the public homepage without losing the session`,async({page})=>{
 await fixture(page,role);
 for(const path of ['/kamirani','/kamirani/layout','/superadmin','/superadmin/layout']) {
  await page.goto(path);await publicHome(page);await page.reload();await publicHome(page);
  expect(await page.evaluate(()=>Boolean(localStorage.getItem(Object.keys(localStorage).find(k=>/^sb-.*-auth-token$/.test(k))||'')))).toBe(true);
 }
 await page.goto('/dashboard');await expect(page.locator('.workspace-shell')).toBeVisible();await expect(page).toHaveURL(/\/dashboard$/);
});

test('verified Super Admin keeps new dashboard/deep links; old URLs always show the public homepage',async({page})=>{
 await fixture(page,'super_admin');let verified=false;
 await page.route('**/api/auth/profile',async route=>{await new Promise(r=>setTimeout(r,300));verified=true;await route.fallback();});
 for(const [path,tab] of [['/kamirani','dashboard'],['/kamirani/layout','layout_config'],['/kamirani/system-appearance','system_appearance']]) {
  await page.goto(path);await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);expect(verified).toBe(true);await expect(page).toHaveURL(new RegExp(path+'$'));
  await page.reload();await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);await expect(page).toHaveURL(new RegExp(path+'$'));
 }
 for(const path of ['/superadmin','/superadmin/layout']){await page.goto(path);await publicHome(page);}
 await page.goto('/kamirani');await expect(page.locator('.workspace-shell')).toBeVisible();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await publicHome(page);
 await page.addInitScript(key=>localStorage.removeItem(key),sessionKey);await page.goto('/kamirani');await gateway(page);
});

test('anonymous entry opens login on direct access and refresh; public and nested restricted routes keep their policy',async({page})=>{
 await fixture(page,'super_admin');await page.addInitScript(key=>{
  localStorage.removeItem(key);(window as any).restrictedFlash=false;
  new MutationObserver(()=>{if(document.querySelector('.workspace-shell,[data-access-denied]'))(window as any).restrictedFlash=true;}).observe(document,{childList:true,subtree:true});
 },sessionKey);
 for(const path of ['/','/superadmin','/superadmin/layout','/kamirani','/kamirani/layout']) {
  await page.goto(path);if(path==='/kamirani')await gateway(page);else await publicHome(page);expect(await page.evaluate(()=>(window as any).restrictedFlash)).toBe(false);
  await page.reload();if(path==='/kamirani')await gateway(page);else await publicHome(page);
 }
 await page.goto('/');await expect(page.locator('header').getByRole('link',{name:/super admin/i})).toHaveCount(0);await expect(page.locator('header a[href*="kamirani"]')).toHaveCount(0);
});

test('Official Login accepts the existing verified Super Admin role without a new public login page',async({page})=>{
 await fixture(page,'super_admin');await page.addInitScript(key=>localStorage.removeItem(key),sessionKey);
 const id='00000000-0000-4000-8000-000000000001';const user={id,email:'audit@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const enc=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})}.fixture`;
 await page.route('**/api/auth/login',route=>route.fulfill({json:{success:true,role:'super_admin',token,refreshToken:'fixture-refresh',user:{id,authUserId:id,email:user.email,name:'Audit fixture',username:'audit',role:'super_admin',active:true,isActive:true,status:'active',permissions:[]}}}));
 await page.route(`https://${project}.supabase.co/auth/v1/token**`,route=>route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user}}));
 await page.goto('/');await publicHome(page);
 await page.locator('header').getByRole('button',{name:'Official Login',exact:true}).click();
 await page.locator('input[type="text"]').last().fill('audit@example.invalid');await page.locator('input[type="password"]').fill('isolated-fixture-password');
 await page.locator('button[type="submit"]').click();await expect(page.locator('.workspace-shell')).toBeVisible();await expect(page).toHaveURL(/\/kamirani$/);
});
