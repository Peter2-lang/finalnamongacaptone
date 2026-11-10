import {test, expect} from '@playwright/test';
import {fixture} from './support/sessionFixture';

// Exercise the real application against an isolated authoritative API fixture.
// This does not assert that any external Supabase publication is configured.
test('GIS fallback polls backend snapshots and reconciles offline/reconnect without duplicate pins', async ({page}) => {
  const state:{records:any[]}={records:[]};
  await fixture(page,'admin',state);
  await page.clock.install();
  await page.goto('/gis');
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.locator('.custom-swine-marker-div')).toHaveCount(0);
  state.records=[{id:'00000000-0000-4000-8000-000000000099',pigIdTag:'HIN-2026-0099',farmerName:'Isolated GIS fixture',barangay:'Ambacon',latitude:10.401804141,longitude:125.18452409,swineType:'grower',status:'healthy',isArchived:false,registeredAt:new Date().toISOString()}];
  await page.clock.fastForward(31000);
  await expect(page.locator('.custom-swine-marker-div')).toHaveCount(1);
  await page.clock.fastForward(31000);
  await expect(page.locator('.custom-swine-marker-div')).toHaveCount(1);
  await page.evaluate(async()=>{
    const path='/src/services/storageService.ts';
    const {storageService}=await import(/* @vite-ignore */ path);
    storageService.setSimulatedOffline(true);
  });
  await page.clock.fastForward(500);
  await expect(page.getByRole('status').filter({hasText:'OFFLINE/CACHED'})).toBeVisible();
  await expect(page.locator('.custom-swine-marker-div')).toHaveCount(1);
  state.records=[{...state.records[0],isArchived:true}];
  await page.evaluate(async()=>{
    const path='/src/services/storageService.ts';
    const {storageService}=await import(/* @vite-ignore */ path);
    storageService.setSimulatedOffline(false);
    window.dispatchEvent(new Event('online'));
  });
  await page.clock.fastForward(1000);
  await expect(page.locator('.custom-swine-marker-div')).toHaveCount(0);
  await expect(page).toHaveURL(/\/gis$/);
});
