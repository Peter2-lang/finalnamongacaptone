import { expect, test } from '@playwright/test';
import { jsPDF } from 'jspdf';
import { fixture } from './support/sessionFixture';

test('certificate import keeps actions visible and persists the reviewed PDF template', async ({ page }) => {
  const savedTemplates: Array<Record<string, any>> = [];
  let sourceUploadCompleted = false;
  await fixture(page, 'admin');

  await page.route('https://auditfixture.supabase.co/storage/v1/object/upload/sign/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'fixture-upload' }) }),
  );
  await page.route('**/api/module-data/certificate_templates', async route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { success: true, data: savedTemplates } });
    }
    if (route.request().method() === 'PUT') {
      const { data } = route.request().postDataJSON();
      const saved = {
        ...data,
        updatedAt: new Date().toISOString(),
        sourceDocument: data.sourceDocument
          ? { ...data.sourceDocument, url: 'https://auditfixture.supabase.co/private-source' }
          : undefined,
      };
      savedTemplates.splice(0, savedTemplates.length, saved);
      return route.fulfill({ json: { success: true, data: saved } });
    }
    return route.fallback();
  });
  await page.route('**/api/storage/upload-url', route =>
    route.fulfill({
      json: {
        success: true,
        bucket: 'certificates',
        filePath: 'shared/certificate-imports/123e4567-e89b-12d3-a456-426614174000-source.pdf',
        token: 'fixture-token',
      },
    }),
  );
  await page.route('**/api/certificate-template-sources/complete', async route => {
    sourceUploadCompleted = true;
    const body = route.request().postDataJSON();
    return route.fulfill({
      status: 201,
      json: {
        success: true,
        filePath: body.filePath,
        fileUrl: 'https://auditfixture.supabase.co/private-source',
        fileSize: 1024,
      },
    });
  });

  await page.goto('/certificate');
  await page.getByText('Template actions').click();
  await page.getByRole('button', { name: 'Create new template' }).click();
  await page.getByRole('button', { name: 'Import Certificate', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import Certificate Template' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close import dialog' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Save Template' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Certificate Template & Layout Customizer')).toBeVisible();

  await page.getByRole('button', { name: 'Import Certificate', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close import dialog' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Import Certificate', exact: true }).click();
  await expect(dialog).toBeVisible();

  const pdf = new jsPDF();
  pdf.text('BARANGAY CERTIFICATION', 20, 25);
  pdf.text('Farmer Name: Example Farmer', 20, 45);
  pdf.text('Barangay: Ambacon', 20, 55);
  await dialog.getByLabel('Choose a certificate template file').setInputFiles({
    name: 'sample-certificate.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(pdf.output('arraybuffer')),
  });
  await expect(dialog.getByText('Ready to review')).toBeVisible();
  await dialog.getByLabel('Template name').fill('Imported browser fixture');

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ]) {
    await page.setViewportSize(viewport);
    const modalBounds = await dialog.boundingBox();
    expect(modalBounds, `dialog should fit ${viewport.width}x${viewport.height}`).not.toBeNull();
    expect(modalBounds!.x).toBeGreaterThanOrEqual(0);
    expect(modalBounds!.y).toBeGreaterThanOrEqual(0);
    expect(modalBounds!.x + modalBounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(modalBounds!.y + modalBounds!.height).toBeLessThanOrEqual(viewport.height);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Save Template' })).toBeInViewport();
    const scrollBody = dialog.locator('.overflow-y-auto.overscroll-contain');
    await scrollBody.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await expect(dialog.getByRole('button', { name: 'Save Template' })).toBeInViewport();
  }

  await dialog.getByRole('button', { name: 'Save Template', exact: true }).click();
  await expect.poll(() => savedTemplates.length).toBe(1);
  expect(sourceUploadCompleted).toBe(true);
  expect(savedTemplates[0].sourceDocument.storagePath).toContain('certificate-imports/');
  expect(savedTemplates[0].reviewStatus).toBe('draft');
  await expect(dialog).toHaveCount(0);

  await page.reload();
  const reloadApplication = page.getByRole('button', { name: 'Reload application' });
  if (await reloadApplication.isVisible().catch(() => false)) await reloadApplication.click();
  await expect(page.getByRole('option', { name: /Imported browser fixture/ })).toHaveCount(1);
});
