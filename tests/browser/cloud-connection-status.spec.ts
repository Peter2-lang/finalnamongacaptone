import { expect, test } from '@playwright/test';
import { fixture } from './support/sessionFixture';

test('healthy cloud connection does not show a warning after page refresh', async ({ page }) => {
  let healthChecks = 0;
  await fixture(page, 'admin');
  await page.route('**/api/connectivity', async route => {
    healthChecks++;
    await route.fulfill({
      status: 200,
      json: {
        service: 'hinunangan-swine-registry',
        status: 'healthy',
        database: 'connected',
        schema: 'ready',
        cloud: 'online',
        authentication: 'available',
      },
    });
  });

  await page.goto('/dashboard');
  await page.reload();
  await expect.poll(() => healthChecks).toBeGreaterThan(0);
  await page.waitForTimeout(1800);
  await expect(page.getByRole('region', { name: 'Connectivity and synchronization status' })).toHaveCount(0);
});

test('confirmed cloud outage shows a warning and recovery hides it automatically', async ({ page }) => {
  let healthAvailable = false;
  await fixture(page, 'admin');
  await page.route('**/api/connectivity', route => {
    if (healthAvailable) {
      return route.fulfill({
        status: 200,
        json: {
          service: 'hinunangan-swine-registry',
          status: 'healthy',
          database: 'connected',
          schema: 'ready',
          cloud: 'online',
          authentication: 'available',
        },
      });
    }
    return route.fulfill({
      status: 503,
      json: {
        service: 'hinunangan-swine-registry',
        status: 'unhealthy',
        database: 'error',
        database_error_kind: 'connection_refused',
      },
    });
  });

  await page.goto('/dashboard');
  const banner = page.getByRole('region', { name: 'Connectivity and synchronization status' });
  await expect(banner).toContainText('Cloud connection issue', { timeout: 8000 });

  healthAvailable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(banner).toHaveCount(0, { timeout: 8000 });
});
