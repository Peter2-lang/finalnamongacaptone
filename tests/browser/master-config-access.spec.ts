import {test,expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';
import {DEFAULT_MASTER_CONFIG} from '../../src/data/defaultMasterConfig';

for(const role of ['admin','focal','agent','super_admin'])test(`${role}: restricted configuration requests wait for an allowed verified role`,async({page})=>{
 await fixture(page,role);let verified=false;let requests=0;
 await page.route('**/api/auth/profile',async route=>{await new Promise(r=>setTimeout(r,500));verified=true;await route.fallback();});
 await page.route('**/api/config/master',async route=>{requests++;expect(verified).toBe(true);expect(role).toBe('super_admin');await route.fulfill({json:{success:true,config:DEFAULT_MASTER_CONFIG,versions:[],auditLogs:[]}});});
 await page.goto('/dashboard');await expect(page.locator('.workspace-shell')).toBeVisible();
 // Wait for application-owned configuration/record requests rather than a startup timer.
 await expect(page.locator('header')).toBeVisible();
 if(role==='super_admin')await expect.poll(()=>requests).toBe(1);
 else {await page.getByRole('button',{name:'Open Biosecurity Assistant',exact:true}).click();await expect(page.locator('.biosecurity-assistant-panel')).toBeVisible();expect(requests).toBe(0);}
});
