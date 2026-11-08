import {test,expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';

test('assistant preserves messages through minimize and refresh, retries without duplicates, and fits the viewport',async({page})=>{
 await fixture(page,'admin');let fail=true;const requests:any[]=[];
 await page.route('**/api/assistant/chat',async route=>{requests.push(route.request().postDataJSON());await new Promise(r=>setTimeout(r,200));await route.fulfill({status:fail?503:200,json:fail?{success:false,error:'Live registry data is unavailable. Please retry.'}:{success:true,reply:'Currently, there are 0 registered swine records.'}});});
 await page.goto('/records');
 const launch=page.getByRole('button',{name:'Open Biosecurity Assistant',exact:true});await launch.click();
 const panel=page.locator('.biosecurity-assistant-panel');const input=panel.locator('textarea');
 await input.fill('How many swine are registered?');await input.press('Shift+Enter');await expect(input).toHaveValue('How many swine are registered?\n');expect(requests).toHaveLength(0);
 await input.press('Enter');await expect(panel.getByRole('alert')).toContainText('Live registry data is unavailable');
 fail=false;await panel.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(panel.getByText('Currently, there are 0 registered swine records.',{exact:true})).toBeVisible();
 expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
 await expect(panel.getByText('How many swine are registered?',{exact:true})).toHaveCount(1);
 await panel.getByRole('button',{name:'Close assistant',exact:true}).click();await expect(panel).toHaveCount(0);await expect(launch).toBeVisible();await expect(page).toHaveURL(/\/records$/);
 await launch.click();await expect(panel.getByText('Currently, there are 0 registered swine records.',{exact:true})).toBeVisible();
 const box=await panel.boundingBox();const viewport=page.viewportSize()!;expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height);if(viewport.width>=640)expect(box!.width).toBeLessThanOrEqual(401);
 await panel.getByRole('button',{name:'Minimize assistant',exact:true}).click();await expect(launch).toBeVisible();
 await page.reload();await launch.click();await expect(panel.getByText('How many swine are registered?',{exact:true})).toHaveCount(1);
 await input.fill('What is a pig?');await panel.getByRole('button',{name:'Send query',exact:true}).dblclick();await expect.poll(()=>requests.length).toBe(3);
 await expect(input).toBeEnabled();
});

test('HTML API fallback yields a recoverable error and safe text',async({page})=>{
 await fixture(page,'admin');await page.route('**/api/assistant/chat',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html>shell</html>'}));
 await page.goto('/certificate');await page.getByRole('button',{name:'Open Biosecurity Assistant',exact:true}).click();
 const panel=page.locator('.biosecurity-assistant-panel');await panel.locator('textarea').fill('What is a pig?');await panel.getByRole('button',{name:'Send query'}).click();
 await expect(panel.getByRole('alert')).toContainText('invalid response');await expect(panel.getByRole('button',{name:'Retry',exact:true})).toBeEnabled();
 await panel.getByRole('button',{name:'Close assistant',exact:true}).click();await expect(page).toHaveURL(/\/certificate$/);await expect(page.getByText('Something went wrong',{exact:false})).toHaveCount(0);
});
