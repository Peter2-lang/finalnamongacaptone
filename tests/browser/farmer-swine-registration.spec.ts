import { expect, test } from '@playwright/test';
import { fixture } from './support/sessionFixture';

const farmer = {
  id: '00000000-0000-4000-8000-000000000072',
  farmerName: 'Registry Test Farmer',
  farmerContact: '+63 912 345 6789',
  farmerAddress: 'Test Farm Location',
  barangay: 'Ambacon',
  farmName: 'Test Farm',
};
const source = {
  ...farmer,
  id: '00000000-0000-4000-8000-000000000071',
  farmerId: farmer.id,
  pigIdTag: 'HIN-2026-0001',
  earTagNo: 'HIN-2026-0001',
  swineType: 'piglet',
  status: 'healthy',
  readyToSell: true,
  isSynced: true,
  registeredAt: '2026-01-01',
};
const endpoint = '**/api/farmers/*/swine-registration';

test('existing farmer action validates, removes drafts, and saves one batch', async ({ page }) => {
  const state = { records: [{ ...source, farmerAddress: 'Old row address' }] };
  await fixture(page, 'admin', state);
  const requests: { farmerId: string; earTagNo: string }[][] = [];
  await page.route(endpoint, async route => {
    expect(route.request().url()).toContain(farmer.id);
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: farmer } });
    const body = route.request().postDataJSON();
    requests.push(body.records);
    for (const [index, record] of body.records.entries()) {
      state.records.push({ ...source, ...record, isSynced: true, pigIdTag: `HIN-2026-000${index + 2}` });
    }
    await route.fulfill({ json: { success: true, count: body.records.length } });
  });

  await page.goto('/records');
  const actions = page.getByRole('button', { name: 'Actions for HIN-2026-0001' }).filter({ visible: true }).first();
  await actions.click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'View Details', 'View Farmer’s Swine', 'Add Swine', 'Edit Record', 'View on GIS Map',
    'Print Record', 'Download PDF', 'Generate Certificate', 'Remove Ready to Sell', 'Mark as Sold', 'Archive Record',
  ]);
  await menu.getByRole('menuitem', { name: 'Add Swine' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Swine to Existing Farmer' });
  await expect(dialog.getByText(farmer.farmerAddress)).toBeVisible();
  await expect(dialog.getByText('Old row address')).toHaveCount(0);
  const modalBounds = (await dialog.boundingBox())!;
  expect(modalBounds.width).toBeLessThanOrEqual(900);
  expect(modalBounds.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) * 0.9 + 1);
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Save Swine' })).toBeInViewport();

  await dialog.getByRole('button', { name: 'Add Another Swine' }).click();
  await dialog.getByRole('button', { name: 'Add Another Swine' }).click();
  await dialog.getByRole('button', { name: 'Remove swine 3' }).click();
  await dialog.getByRole('button', { name: 'Save Swine' }).click();
  await expect(dialog.getByRole('alert').filter({ hasText: 'Review the highlighted fields' })).toBeVisible();
  expect(requests).toHaveLength(0);
  const tags = dialog.getByRole('textbox', { name: 'Ear Tag Number', exact: false });
  await tags.nth(0).fill('Ear-101');
  await tags.nth(1).fill('Ear-102');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog.getByText('Discard unsaved changes?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await dialog.getByRole('button', { name: 'Save Swine' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('2 swine saved to the registry.')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].map(record => [record.farmerId, record.earTagNo])).toEqual([
    [farmer.id, 'Ear-101'], [farmer.id, 'Ear-102'],
  ]);
  await page.getByRole('button', { name: /Actions for HIN-2026-000[123]/ }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: 'View Farmer’s Swine' }).click();
  await expect(page.getByRole('button', { name: 'Actions for HIN-2026-0002' }).filter({ visible: true }).first()).toBeVisible();
});

test('agent has no Add Swine action', async ({ page }) => {
  await fixture(page, 'agent', { records: [source] });
  await page.goto('/records');
  await expect(page.getByRole('heading', { name: 'Access Denied' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add Swine' })).toHaveCount(0);
});

test('offline registration replays the same batch after an unconfirmed response', async ({ page }) => {
  const state = { records: [source] };
  await fixture(page, 'focal', state);
  const bodies: unknown[] = [];
  await page.route(endpoint, async route => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (bodies.length === 1) {
      state.records.push({ ...source, ...body.records[0], pigIdTag: 'HIN-2026-0002' });
      return route.fulfill({ status: 503, json: { success: false } });
    }
    expect(body).toEqual(bodies[0]);
    return route.fulfill({ json: { success: true, count: 1 } });
  });

  await page.goto('/records');
  await expect(page.getByRole('button', { name: 'Actions for HIN-2026-0001' }).filter({ visible: true }).first()).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Actions for HIN-2026-0001' }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: 'Add Swine' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Swine to Existing Farmer' });
  await expect(dialog.getByText('Showing the farmer information saved on this device.')).toBeVisible();
  await dialog.getByRole('textbox', { name: /Ear Tag Number/ }).fill('Ear-offline');
  await dialog.getByRole('button', { name: 'Save Swine' }).click();
  await expect(page.getByText('1 swine · Pending Sync')).toBeVisible();
  expect(bodies).toHaveLength(0);

  await page.context().setOffline(false);
  await expect.poll(() => bodies.length).toBe(1);
  await page.waitForFunction(() => document.body.textContent?.includes('The registry could not confirm the save.'));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => bodies.length).toBe(2);
  await expect(page.getByText('2 Heads', { exact: true })).toBeVisible();
  expect(state.records).toHaveLength(2);
});

test('Actions stays compact and anchors the menu while the records view scrolls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const records = Array.from({ length: 12 }, (_, index) => ({
    ...source,
    id: crypto.randomUUID(),
    farmerId: crypto.randomUUID(),
    farmerName: `Registry Layout Farmer ${index + 1}`,
    pigIdTag: `HIN-2026-${String(index + 1).padStart(4, '0')}`,
    earTagNo: `Ear-layout-${index + 1}`,
  }));
  await fixture(page, 'admin', { records });
  await page.goto('/records');

  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 850 });
    const trigger = page.getByRole('button', { name: 'Actions for HIN-2026-0007' }).filter({ visible: true }).first();
    const menu = page.getByRole('menu', { name: 'Actions for HIN-2026-0007' });
    await expect(trigger).toBeVisible();

    if (width > 600) {
      const column = page.getByRole('columnheader', { name: 'Actions', exact: true });
      const cell = trigger.locator('..');
      const tableScroller = page.locator('.desktop-record-table > .overflow-x-auto');
      expect((await column.boundingBox())?.width).toBeCloseTo(120, 0);
      expect((await cell.boundingBox())?.width).toBeCloseTo(120, 0);
      const { left, scrollLeft } = await tableScroller.evaluate(scroller => {
        scroller.scrollLeft = scroller.scrollWidth;
        return { left: scroller.getBoundingClientRect().left, scrollLeft: scroller.scrollLeft };
      });
      expect(scrollLeft).toBeGreaterThan(0);
      const bounds = (await cell.boundingBox())!;
      const button = (await trigger.boundingBox())!;
      expect(bounds.x).toBeGreaterThan(left);
      expect(button.x + button.width / 2).toBeCloseTo(bounds.x + bounds.width / 2, 0);
    }

    for (const above of [false, true]) {
      await trigger.evaluate((button, placeNearBottom) => {
        const main = button.closest('main')!;
        const header = document.querySelector('.app-header')!.getBoundingClientRect();
        const target = placeNearBottom ? innerHeight - 84 : header.bottom + 60;
        main.scrollTop += button.getBoundingClientRect().top - target;
      }, above);
      await trigger.click();
      await expect(menu).toBeVisible();
      const bounds = (await menu.boundingBox())!;
      const button = (await trigger.boundingBox())!;
      const header = (await page.locator('.app-header').boundingBox())!;
      const gap = above ? button.y - bounds.y - bounds.height : bounds.y - button.y - button.height;
      expect(gap).toBeCloseTo(6, 0);
      expect(bounds.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(850);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await expect(menu.getByRole('menuitem', { name: 'Add Swine', exact: true })).toBeVisible();
      if (above) await page.mouse.click(4, 4);
      else await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      if (!above) await expect(trigger).toBeFocused();
    }
  }

  await page.setViewportSize({ width: 1440, height: 850 });
  const first = page.getByRole('button', { name: 'Actions for HIN-2026-0007' }).filter({ visible: true }).first();
  const second = page.getByRole('button', { name: 'Actions for HIN-2026-0008' }).filter({ visible: true }).first();
  await first.evaluate(button => button.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await expect(second).toBeInViewport();
  await first.click();
  await expect(page.getByRole('menu', { name: 'Actions for HIN-2026-0007' })).toBeVisible();
  await second.dispatchEvent('click');
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menu', { name: 'Actions for HIN-2026-0008' })).toBeVisible();
  expect(errors).toEqual([]);
});
