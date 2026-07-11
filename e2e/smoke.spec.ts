import { expect, test } from '@playwright/test';

test('edits, regenerates, previews, and exports a printable bin', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');

  await expect(page.getByRole('tab', { name: 'Shape' })).toBeVisible();
  await page.getByRole('tab', { name: 'Walls' }).click();
  await expect(page.getByRole('button', { name: 'Reset grid walls' })).toBeVisible();
  await page.getByRole('tab', { name: 'Split' }).click();
  await expect(page.getByLabel('Split mode for bin 1')).toBeVisible();
  await page.getByRole('tab', { name: 'Shape' }).click();

  const settings = page.getByRole('complementary');
  await expect(settings.getByRole('combobox', { name: 'Printer' })).toBeVisible();
  await expect(settings.getByText('Dimensions', { exact: true })).toBeVisible();
  await expect(settings.getByRole('switch', { name: /Magnet holes/ })).toBeVisible();

  const exportButton = page.getByRole('button', { name: /^Export STL/ });
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });

  const initialCellCount = await page.locator('.cell[aria-pressed="true"]').count();
  await page.locator('.cell[aria-pressed="false"]').first().click();
  await expect(page.locator('.cell[aria-pressed="true"]')).toHaveCount(initialCellCount + 1);
  await expect(page.getByText(`${initialCellCount + 1} cells`, { exact: true })).toBeVisible();
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });

  await page.getByRole('switch', { name: /Magnet holes/ }).check();
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });

  const canvas = page.locator('canvas.viewer-canvas');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(canvas).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.stl$/i);
  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += chunk.length;
  expect(bytes).toBeGreaterThan(84);
  expect(errors).toEqual([]);
});
