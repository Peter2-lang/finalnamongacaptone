import { expect, test } from '@playwright/test';
import { fixture } from './support/sessionFixture';

test('smart legal import keeps its dialog and actions in the viewport', async ({ page }) => {
  await fixture(page, 'admin');
  await page.goto('/asf-ordinance');
  await page.getByRole('button', { name: /Import Legal Document/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Smart Legal Document Import System' });
  const closeButton = dialog.getByRole('button', { name: 'Close smart legal document import' });
  const cancelButton = dialog.getByRole('button', { name: 'Cancel' });
  const processButton = dialog.getByRole('button', { name: 'Process & Recognize' });

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds, `dialog should fit ${viewport.width}x${viewport.height}`).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await expect(closeButton).toBeInViewport();
    await expect(cancelButton).toBeInViewport();
    await expect(processButton).toBeInViewport();
  }

  await closeButton.click();
  await expect(dialog).toHaveCount(0);
});

test('swine registry import keeps its close and cancel actions visible on small screens', async ({ page }) => {
  await fixture(page, 'admin');
  await page.goto('/records');
  await page.getByText('More actions', { exact: true }).click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Smart Swine Registry Importer' });
  const closeButton = dialog.getByRole('button', { name: 'Close' });
  const cancelButton = dialog.getByRole('button', { name: 'Cancel' });

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 320, height: 640 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds, `dialog should fit ${viewport.width}x${viewport.height}`).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await expect(closeButton).toBeInViewport();
    await expect(cancelButton).toBeInViewport();
  }

  await cancelButton.click();
  await expect(dialog).toHaveCount(0);
});
