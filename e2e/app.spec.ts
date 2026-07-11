import { expect, test } from '@playwright/test';

test('invalidates export while current geometry is regenerating', async ({ page }) => {
  await page.goto('/');

  const exportStl = page.getByRole('button', { name: 'Export STL', exact: true });
  await expect(exportStl).toBeEnabled({ timeout: 60_000 });

  const heightSlider = page.getByRole('slider').first();
  await heightSlider.press('ArrowRight');
  await expect(exportStl).toBeDisabled();
  await expect(exportStl).toBeEnabled({ timeout: 60_000 });
});

test('does not export an empty layout', async ({ page }) => {
  await page.goto('/');

  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    await page.getByRole('button', { name: `Cell ${x},${y}` }).click();
  }

  await expect(page.getByRole('button', { name: 'Export STL', exact: true })).toBeDisabled();
  await expect(page.getByText('Add at least one grid cell before generating an STL.')).toBeVisible();
});

test('blocks export when the compatibility fallback is active', async ({ page }) => {
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto('/');

  await expect(page.getByText(/compatibility geometry fallback was used/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Export STL', exact: true })).toBeDisabled();
});
