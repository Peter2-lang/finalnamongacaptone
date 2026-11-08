import {test,expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';

for(const role of ['admin','focal','agent'])test(`${role} cannot open or redirect either Super Admin URL`,async({page})=>{
 await fixture(page,role);
 for(const path of ['/kamirani','/kamirani/layout','/superadmin','/superadmin/layout']) {
  await page.goto(path);await expect(page.locator('[data-access-denied]')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(path+'$'));await expect(page.locator('.workspace-shell')).toHaveCount(0);
 }
});

test('verified Super Admin root and deep links survive refresh; legacy redirects preserve subpage',async({page})=>{
 await fixture(page,'super_admin');let verified=false;
 await page.route('**/api/auth/profile',async route=>{await new Promise(r=>setTimeout(r,300));verified=true;await route.fallback();});
 for(const [path,tab] of [['/kamirani','dashboard'],['/kamirani/layout','layout_config'],['/kamirani/system-appearance','system_appearance']]) {
  await page.goto(path);await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);await expect(page).toHaveURL(new RegExp(path+'$'));
  await page.reload();await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);await expect(page).toHaveURL(new RegExp(path+'$'));
 }
 for(const [path,target,tab] of [['/superadmin','/kamirani','dashboard'],['/superadmin/layout?from=bookmark#editor','/kamirani/layout?from=bookmark#editor','layout_config']]) {
  verified=false;await page.goto(path);await expect(page).toHaveURL('http://127.0.0.1:'+(process.env.PLAYWRIGHT_PORT||'4173')+target);expect(verified).toBe(true);
  await expect(page.locator('main#main-content')).toHaveAttribute('data-page',tab);
 }
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/kamirani$/);
 await expect(page.getByPlaceholder('superadmin@example.com')).toBeVisible();await expect(page.locator('.workspace-shell')).toHaveCount(0);
 await page.addInitScript(()=>localStorage.removeItem('sb-auditfixture-auth-token'));
 await page.reload();await expect(page.getByPlaceholder('superadmin@example.com')).toBeVisible();await expect(page).toHaveURL(/\/kamirani$/);
});

test('anonymous legacy links do not redirect; new portal provides the dedicated sign-in',async({page})=>{
 await fixture(page,'super_admin');await page.addInitScript(()=>localStorage.removeItem('sb-auditfixture-auth-token'));
 await page.goto('/superadmin');await expect(page.locator('[data-access-denied]')).toBeVisible();await expect(page).toHaveURL(/\/superadmin$/);
 await expect(page.getByPlaceholder('superadmin@example.com')).toHaveCount(0);
 await page.goto('/kamirani');await expect(page.getByPlaceholder('superadmin@example.com')).toBeVisible();await expect(page.locator('.workspace-shell')).toHaveCount(0);
 await page.reload();await expect(page.getByPlaceholder('superadmin@example.com')).toBeVisible();await expect(page).toHaveURL(/\/kamirani$/);
});

test('dedicated login verifies the existing Super Admin role and restores a new deep link',async({page})=>{
 await fixture(page,'super_admin');await page.addInitScript(()=>localStorage.removeItem('sb-auditfixture-auth-token'));
 const id='00000000-0000-4000-8000-000000000001';const user={id,email:'audit@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
 const enc=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({sub:id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})}.fixture`;
 await page.route('https://auditfixture.supabase.co/auth/v1/token**',route=>route.fulfill({json:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user}}));
 await page.route('**/api/auth/superadmin-profile',route=>route.fulfill({json:{success:true,role:'super_admin',data:{id,authUserId:id,email:user.email,name:'Audit fixture',username:'audit',role:'super_admin',active:true,isActive:true,status:'active',permissions:[]}}}));
 await page.goto('/kamirani/layout');await page.getByPlaceholder('superadmin@example.com').fill('audit@example.invalid');await page.getByPlaceholder('Enter your Supabase Auth password').fill('isolated-fixture-password');
 await page.locator('button[type="submit"]').click();await expect(page.locator('main#main-content')).toHaveAttribute('data-page','layout_config');await expect(page).toHaveURL(/\/kamirani\/layout$/);
});
